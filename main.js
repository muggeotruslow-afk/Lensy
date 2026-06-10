const { app, BrowserWindow, globalShortcut, ipcMain, screen, desktopCapturer, Tray, Menu, nativeImage, clipboard, dialog, shell } = require('electron')
const path = require('path')
const { execFile, spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const OpenAI = require('openai')
const { createWorker, PSM } = require('tesseract.js')
const { Jimp } = require('jimp')

const LOG_PATH = path.join(os.tmpdir(), 'lensy.log')
// Rotate log if it grows beyond 1 MB
try {
  if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > 1024 * 1024) {
    fs.writeFileSync(LOG_PATH, '')
  }
} catch {}
fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] === App start ===\n`)
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}\n`
  fs.appendFileSync(LOG_PATH, line)
  console.log(...args)
}

// ── Settings & Vocab persistence ──────────────────────────────────────
const USER_DATA  = app.getPath('userData')
const CFG_PATH   = path.join(USER_DATA, 'config.json')
const VOCAB_PATH = path.join(USER_DATA, 'vocab.json')

// Migrate from old ocr-translator app data dir (if user upgraded from v0.1.0)
try {
  const oldDir = path.join(path.dirname(USER_DATA), 'ocr-translator')
  if (fs.existsSync(oldDir) && !fs.existsSync(CFG_PATH)) {
    fs.mkdirSync(USER_DATA, { recursive: true })
    for (const f of ['config.json', 'vocab.json']) {
      const src = path.join(oldDir, f)
      const dst = path.join(USER_DATA, f)
      if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst)
    }
  }
} catch (e) { /* best-effort migration */ }

const DEFAULT_SETTINGS = {
  deepseek_api_key: '',
  hotkey_capture:   'Alt+Shift+T',
  hotkey_clipboard: 'Alt+Shift+D',
  auto_translate:   true,
  enable_clipboard_mode: false,
  model:            'deepseek-chat',
  ocr_engine:       'tesseract',          // 'tesseract' | 'umi' | 'windows'
  umi_endpoint:     'http://127.0.0.1:1224',
  umi_language:     ''                    // empty = use Umi default; e.g. 'models/config_chinese.txt'
}

function loadSettings() {
  try {
    fs.mkdirSync(USER_DATA, { recursive: true })
    if (fs.existsSync(CFG_PATH)) {
      const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'))
      return { ...DEFAULT_SETTINGS, ...cfg }
    } else {
      fs.writeFileSync(CFG_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2))
    }
  } catch (e) { log('loadSettings error:', e.message) }
  return { ...DEFAULT_SETTINGS }
}

function saveSettings(s) {
  try {
    fs.writeFileSync(CFG_PATH, JSON.stringify(s, null, 2))
    return true
  } catch (e) { log('saveSettings error:', e.message); return false }
}

let settings = loadSettings()
if (process.env.DEEPSEEK_API_KEY) settings.deepseek_api_key = process.env.DEEPSEEK_API_KEY
const API_KEY = settings.deepseek_api_key
log('Settings loaded. API key length:', API_KEY.length, 'auto-translate:', settings.auto_translate)

function loadVocab() {
  try {
    if (fs.existsSync(VOCAB_PATH)) {
      return JSON.parse(fs.readFileSync(VOCAB_PATH, 'utf8'))
    }
  } catch (e) { log('loadVocab error:', e.message) }
  return { version: 1, words: [] }
}

function saveVocab(v) {
  try { fs.writeFileSync(VOCAB_PATH, JSON.stringify(v, null, 2)); return true }
  catch (e) { log('saveVocab error:', e.message); return false }
}

process.on('uncaughtException', (err) => {
  log('!!! uncaughtException:', err.message, err.stack)
})
process.on('unhandledRejection', (reason) => {
  log('!!! unhandledRejection:', reason)
})

function resolveOcrScript() {
  const candidates = [
    path.join(process.resourcesPath || '', 'ocr.ps1'),
    path.join(__dirname, 'ocr.ps1')
  ]
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p
  }
  return path.join(__dirname, 'ocr.ps1')
}
const OCR_SCRIPT_SRC = resolveOcrScript()
const OCR_SCRIPT_DST = path.join(os.tmpdir(), 'lensy-ocr.ps1')
try {
  fs.copyFileSync(OCR_SCRIPT_SRC, OCR_SCRIPT_DST)
  log('Copied OCR script from:', OCR_SCRIPT_SRC, 'to:', OCR_SCRIPT_DST)
} catch (e) {
  log('Failed to copy OCR script:', e.message)
}

// ── Tesseract.js worker (pre-warmed) ──────────────────────────────────
function resolveTessdataPath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'tessdata'),
    path.join(__dirname, 'assets', 'tessdata')
  ]
  for (const p of candidates) {
    if (p && fs.existsSync(path.join(p, 'eng.traineddata'))) return p
  }
  return path.join(__dirname, 'assets', 'tessdata')
}
const TESSDATA_PATH = resolveTessdataPath()
log('Tessdata path:', TESSDATA_PATH, 'has eng?',
    fs.existsSync(path.join(TESSDATA_PATH, 'eng.traineddata')))

let tessWorker = null
let tessReady = false
let tessInitPromise = null

async function initTesseract() {
  if (tessReady) return tessWorker
  if (tessInitPromise) return tessInitPromise
  tessInitPromise = (async () => {
    try {
      log('Tesseract: creating worker...')
      const t0 = Date.now()
      tessWorker = await createWorker('eng', 1, {
        langPath: TESSDATA_PATH,
        cachePath: TESSDATA_PATH,
        gzip: false,
        logger: m => { if (m.status === 'recognizing text') {} } // silence
      })
      tessReady = true
      log('Tesseract: ready in', Date.now() - t0, 'ms')
      return tessWorker
    } catch (e) {
      log('Tesseract init error:', e.message)
      tessInitPromise = null
      throw e
    }
  })()
  return tessInitPromise
}

// Preprocess image: greyscale + adaptive threshold, plus inverted variant.
// Returns array of variant file paths to try in order.
async function preprocessForOCR(srcPath) {
  const variants = []
  try {
    const img = await Jimp.read(srcPath)
    const { width, height } = img.bitmap

    // Heuristic: if image is wide-short (subtitle-like), prefer single-line
    // 1) greyscale + threshold (normal)
    const v1 = img.clone().greyscale().contrast(0.3)
    // simple global threshold around mean
    let sum = 0, count = 0
    v1.scan(0, 0, width, height, function (x, y, idx) {
      sum += this.bitmap.data[idx]; count++
    })
    const mean = sum / count
    const thresh = mean
    const v1Bin = v1.clone().scan(0, 0, width, height, function (x, y, idx) {
      const v = this.bitmap.data[idx] >= thresh ? 255 : 0
      this.bitmap.data[idx]   = v
      this.bitmap.data[idx+1] = v
      this.bitmap.data[idx+2] = v
    })
    const p1 = srcPath.replace(/\.png$/, '_pp1.png')
    await v1Bin.write(p1)
    variants.push(p1)

    // 2) inverted threshold (for white-text-on-dark, like subtitles)
    const v2Bin = v1.clone().scan(0, 0, width, height, function (x, y, idx) {
      const v = this.bitmap.data[idx] >= thresh ? 0 : 255
      this.bitmap.data[idx]   = v
      this.bitmap.data[idx+1] = v
      this.bitmap.data[idx+2] = v
    })
    const p2 = srcPath.replace(/\.png$/, '_pp2.png')
    await v2Bin.write(p2)
    variants.push(p2)
  } catch (e) {
    log('preprocess error:', e.message)
  }
  return variants
}

// ── Umi-OCR (HTTP API) ────────────────────────────────────────────────
async function runUmiOCR(imagePath) {
  const endpoint = (settings.umi_endpoint || 'http://127.0.0.1:1224').replace(/\/$/, '')
  const url = endpoint + '/api/ocr'
  const imgBuf = fs.readFileSync(imagePath)
  const base64 = imgBuf.toString('base64')

  const body = { base64 }
  if (settings.umi_language) body.options = { 'ocr.language': settings.umi_language }

  const t0 = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  let res
  try {
    res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctrl.signal
    })
  } catch (e) {
    throw new Error('Umi-OCR 服务未响应（请确认已启动并启用 HTTP 服务）')
  } finally { clearTimeout(timer) }
  if (!res.ok) throw new Error(`Umi-OCR HTTP ${res.status}`)
  const json = await res.json()
  log('Umi-OCR responded in', Date.now() - t0, 'ms, code:', json.code)

  if (json.code === 101) return { words: [], lines: [], fullText: '', error: 'no text' }
  if (json.code !== 100) throw new Error(json.data || ('Umi-OCR error code ' + json.code))

  const items = Array.isArray(json.data) ? json.data : []
  const lines = []
  for (const item of items) {
    const text = (item.text || '').trim()
    if (!text) continue
    const box = item.box || []
    const xs = box.map(p => p[0]), ys = box.map(p => p[1])
    const x = Math.min(...xs), y = Math.min(...ys)
    const w = Math.max(...xs) - x, h = Math.max(...ys) - y
    lines.push({
      text, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h),
      conf: Math.round((item.score || 0) * 100)
    })
  }
  return { words: [], lines, fullText: lines.map(l => l.text).join('\n') }
}

async function runTesseract(imagePath) {
  const worker = await initTesseract()

  // PSM SINGLE_BLOCK (6) preserves spaces better than SINGLE_LINE (7)
  let psm = PSM.AUTO
  try {
    const img = await Jimp.read(imagePath)
    const { width, height } = img.bitmap
    const ratio = width / height
    // Always prefer SINGLE_BLOCK for wide images — keeps interword spaces
    if (ratio > 2) psm = PSM.SINGLE_BLOCK
    log('image dims:', width, 'x', height, 'ratio:', ratio.toFixed(2), 'PSM:', psm)
  } catch {}

  await worker.setParameters({
    tessedit_pageseg_mode: psm,
    preserve_interword_spaces: '1'
  })

  // Run on original + preprocessed variants, pick best by avg confidence
  const variants = [imagePath, ...await preprocessForOCR(imagePath)]
  let best = null
  for (const p of variants) {
    try {
      const t0 = Date.now()
      const { data } = await worker.recognize(p, {}, { blocks: true, text: true })
      const text = (data.text || '').trim()
      const conf = data.confidence || 0
      log(`  variant ${path.basename(p)}: ${Date.now()-t0}ms conf=${conf.toFixed(1)} text="${text.substring(0,60)}"`)
      if (!best || conf > best.conf || (conf === best.conf && text.length > best.text.length)) {
        best = { data, text, conf, path: p }
      }
    } catch (e) {
      log(`  variant ${path.basename(p)} failed:`, e.message)
    }
  }
  if (!best) return { words: [], lines: [], fullText: '', error: 'all variants failed' }
  log('Best variant:', path.basename(best.path), 'conf:', best.conf.toFixed(1))
  const data = best.data
  const words = []
  const lines = []
  for (const block of (data.blocks || [])) {
    for (const para of (block.paragraphs || [])) {
      for (const line of (para.lines || [])) {
        const lineWords = []
        for (const w of (line.words || [])) {
          if (!w.text || !w.text.trim()) continue
          const b = w.bbox || {}
          const word = {
            text: w.text,
            x: b.x0 || 0, y: b.y0 || 0,
            w: (b.x1 || 0) - (b.x0 || 0),
            h: (b.y1 || 0) - (b.y0 || 0),
            conf: w.confidence
          }
          words.push(word)
          lineWords.push(word)
        }
        if (lineWords.length) {
          const lb = line.bbox || {}
          lines.push({
            text: (line.text || lineWords.map(w => w.text).join(' ')).trim(),
            x: lb.x0 || 0, y: lb.y0 || 0,
            w: (lb.x1 || 0) - (lb.x0 || 0),
            h: (lb.y1 || 0) - (lb.y0 || 0),
            conf: line.confidence
          })
        }
      }
    }
  }
  return { words, lines, fullText: (data.text || '').trim() }
}

const client = new OpenAI({
  apiKey: API_KEY || 'placeholder-set-in-settings',
  baseURL: 'https://api.deepseek.com'
})

let overlayWin = null
let resultWin = null
let settingsWin = null
let vocabWin = null
let quickWin = null
let tray = null
let frozenScreenshot = null
let frozenScale = 1

app.disableHardwareAcceleration()

const APP_ICON = path.join(__dirname, 'assets', 'icon.png')

// Force a window to the very top, even against fullscreen apps (B站/OBS/games).
// Re-attempts a few times to beat z-order racing. Keeps alwaysOnTop until window closes.
function forceShowOnTop(win) {
  if (!win || win.isDestroyed()) return
  const bring = () => {
    if (win.isDestroyed()) return
    try {
      if (win.isMinimized()) win.restore()
      win.show()
      win.setAlwaysOnTop(true, 'screen-saver')
      win.moveTop()
      win.focus()
    } catch (e) { log('forceShowOnTop error:', e.message) }
  }
  bring()
  setTimeout(bring, 100)
  setTimeout(bring, 500)
  try { win.flashFrame(true) } catch {}
  setTimeout(() => { try { win.flashFrame(false) } catch {} }, 3000)
}

// In-app toast (right-bottom floating card, ~1.5s auto-dismiss)
let toastWin = null
function showToast(title, body) {
  try {
    if (toastWin && !toastWin.isDestroyed()) { try { toastWin.close() } catch {} toastWin = null }
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
    const w = 360, h = 90
    toastWin = new BrowserWindow({
      width: w, height: h,
      x: sw - w - 16, y: sh - h - 16,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: false,
      hasShadow: false,
      show: false,
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    })
    toastWin.setIgnoreMouseEvents(true)
    toastWin.loadFile('toast.html')
    toastWin.webContents.once('did-finish-load', () => {
      toastWin.webContents.send('toast-data', { title, body })
      toastWin.showInactive()
    })
    setTimeout(() => {
      if (toastWin && !toastWin.isDestroyed()) { try { toastWin.close() } catch {}; toastWin = null }
    }, 2200)
  } catch (e) { log('showToast error:', e.message) }
}

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  log('Another instance is running, quitting this one')
  app.quit()
  process.exit(0)
}
app.on('second-instance', () => {
  // Another instance tried to launch — bring tray menu attention
  log('Second instance attempted, focusing existing')
  if (tray) tray.displayBalloon({ title: 'Lensy', content: 'Lensy 已在后台运行（系统托盘）' })
})

function registerHotkeys() {
  globalShortcut.unregisterAll()
  try {
    if (settings.hotkey_capture) {
      globalShortcut.register(settings.hotkey_capture, () => {
        log('>>> capture hotkey fired'); openOverlay()
      })
    }
    if (settings.enable_clipboard_mode && settings.hotkey_clipboard) {
      globalShortcut.register(settings.hotkey_clipboard, () => {
        log('>>> clipboard hotkey fired'); openQuickTranslate()
      })
    }
    log('Hotkeys registered. capture:', settings.hotkey_capture,
        'clipboard:', settings.enable_clipboard_mode ? settings.hotkey_clipboard : '(off)')
  } catch (e) {
    log('registerHotkeys error:', e.message)
  }
}

// Small orange tray icon (16x16 solid)
function makeTrayIcon() {
  // Prefer real PNG icon; fall back to procedural pixel icon
  const candidates = [
    path.join(process.resourcesPath || '', 'icon.png'),
    path.join(__dirname, 'assets', 'icon.png')
  ]
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return img.resize({ width: 16, height: 16 })
    }
  }
  // Fallback: procedural orange square
  const w = 16, h = 16
  const buf = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const edge = x === 0 || y === 0 || x === w-1 || y === h-1
      buf[i]   = edge ? 0xB0 : 0xC9
      buf[i+1] = edge ? 0x55 : 0x64
      buf[i+2] = edge ? 0x3A : 0x42
      buf[i+3] = 0xFF
    }
  }
  return nativeImage.createFromBitmap(buf, { width: w, height: h })
}

function buildTray() {
  if (tray) return
  try {
    tray = new Tray(makeTrayIcon())
    tray.setToolTip('Lensy — 截图翻译 + 单词查询')
    const ctx = Menu.buildFromTemplate([
      { label: '📷 截图翻译', click: () => openOverlay() },
      { label: '📋 剪贴板翻译', click: () => openQuickTranslate() },
      { type: 'separator' },
      { label: '📖 生词本',  click: () => openVocabWindow() },
      { label: '⚙ 设置',    click: () => openSettingsWindow() },
      { type: 'separator' },
      { label: '查看日志',   click: () => shell.openPath(LOG_PATH) },
      { label: '退出',       click: () => { app.isQuitting = true; app.exit(0) } }
    ])
    tray.setContextMenu(ctx)
    tray.on('click', () => openOverlay())
    log('Tray built')
  } catch (e) {
    log('buildTray error:', e.message)
  }
}

app.whenReady().then(async () => {
  buildTray()
  registerHotkeys()
  log('Lensy ready.')

  // pre-warm Tesseract in background so first OCR is fast
  initTesseract().catch(e => log('Tesseract pre-warm failed:', e.message))

  // Pre-create overlay window so first hotkey is instant
  setTimeout(() => precreateOverlay().catch(()=>{}), 500)
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

// Critical: keep app alive when all windows closed (we run as background hotkey daemon)
app.on('window-all-closed', (e) => {
  e.preventDefault()
  log('window-all-closed - keeping app alive')
})

// Pre-warmed overlay window — hidden, HTML loaded, ready to flash on hotkey
let prewarmOverlay = null
let prewarmReady = false

async function precreateOverlay() {
  if (prewarmOverlay && !prewarmOverlay.isDestroyed()) return
  try {
    const display = screen.getPrimaryDisplay()
    const { width, height } = display.bounds
    const win = new BrowserWindow({
      width, height,
      x: 0, y: 0,
      frame: false,
      transparent: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      show: false,
      backgroundColor: '#000',
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    })
    win.loadFile('overlay.html')
    await new Promise(r => win.webContents.once('did-finish-load', r))
    win.on('closed', () => {
      if (prewarmOverlay === win) {
        prewarmOverlay = null
        prewarmReady = false
      }
    })
    prewarmOverlay = win
    prewarmReady = true
    log('overlay pre-warmed')
  } catch (e) { log('precreateOverlay error:', e.message) }
}

async function openOverlay() {
  log('openOverlay called. existing overlay?', !!overlayWin, 'result win?', !!resultWin)
  if (overlayWin) { overlayWin.close(); overlayWin = null; return }

  try {
    // Use pre-warmed overlay if available — saves ~150-200ms
    if (!prewarmReady) await precreateOverlay()
    overlayWin = prewarmOverlay
    prewarmOverlay = null
    prewarmReady = false

    const display = screen.getPrimaryDisplay()
    const { width, height } = display.bounds
    frozenScale = display.scaleFactor

    // Must capture BEFORE showing overlay, otherwise we capture the overlay itself
    log('capturing screen for freeze:', { width, height, scale: frozenScale })
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width:  Math.round(width  * frozenScale),
        height: Math.round(height * frozenScale)
      }
    })
    frozenScreenshot = sources[0].thumbnail
    const fsSize = frozenScreenshot.getSize()
    log('frozen screenshot size:', fsSize)

    // Send the frozen image to pre-warmed overlay, then show
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.setFullScreen(true)
      overlayWin.webContents.send('frozen-image', {
        dataUrl: frozenScreenshot.toDataURL(),
        naturalWidth: fsSize.width,
        naturalHeight: fsSize.height
      })
      // overlay.html will send 'overlay-ready' after image renders → triggers show()
    }
    overlayWin.on('closed', () => {
      overlayWin = null
      log('overlay closed event')
      // Pre-warm the next one in background
      setTimeout(() => precreateOverlay().catch(()=>{}), 200)
    })
  } catch (err) {
    log('openOverlay error:', err.message)
  }
}

ipcMain.on('cancel-overlay', () => {
  if (overlayWin) { overlayWin.close(); overlayWin = null }
})

ipcMain.on('overlay-ready', () => {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.show()
    overlayWin.focus()
  }
})

ipcMain.on('capture-region', async (event, region) => {
  log('capture-region received (image-space):', region)

  try {
    if (!frozenScreenshot) throw new Error('No frozen screenshot available')

    const fsSize = frozenScreenshot.getSize()
    const cropRegion = {
      x:      Math.max(0, Math.min(Math.round(region.x), fsSize.width - 1)),
      y:      Math.max(0, Math.min(Math.round(region.y), fsSize.height - 1)),
      width:  Math.max(1, Math.round(region.w)),
      height: Math.max(1, Math.round(region.h))
    }
    // clamp to image bounds
    if (cropRegion.x + cropRegion.width  > fsSize.width)  cropRegion.width  = fsSize.width  - cropRegion.x
    if (cropRegion.y + cropRegion.height > fsSize.height) cropRegion.height = fsSize.height - cropRegion.y
    log('crop region (clamped):', cropRegion, 'frozen size:', fsSize)

    const cropped = frozenScreenshot.crop(cropRegion)
    const croppedSize = cropped.getSize()
    log('cropped size:', croppedSize)

    // Upscale small crops — both Tesseract and Win OCR benefit
    let ocrInput = cropped
    let ocrScale = 1
    if (croppedSize.height < 200) {
      ocrScale = croppedSize.height < 60 ? 3 : 2
      ocrInput = cropped.resize({
        width:  croppedSize.width  * ocrScale,
        height: croppedSize.height * ocrScale,
        quality: 'best'
      })
      log('upscaled for OCR ×' + ocrScale + ':', ocrInput.getSize())
    }

    const tmpImg = path.join(os.tmpdir(), 'ocr_input.png')
    fs.writeFileSync(tmpImg, ocrInput.toPNG())
    log('wrote image to:', tmpImg)

    const croppedDataUrl = cropped.toDataURL()
    log('toDataURL ok, length:', croppedDataUrl.length)

    if (overlayWin) {
      log('hiding overlay')
      try { overlayWin.hide() } catch (e) { log('overlay hide error:', e.message) }
    }

    const engine = settings.ocr_engine || 'tesseract'
    log('running OCR engine:', engine)
    let ocrResult
    try {
      const t0 = Date.now()
      if (engine === 'umi') {
        ocrResult = await runUmiOCR(tmpImg)
      } else if (engine === 'windows') {
        ocrResult = await runWindowsOCR(tmpImg)
      } else {
        ocrResult = await runTesseract(tmpImg)
      }
      log(engine, 'done in', Date.now() - t0, 'ms, words:', ocrResult.words?.length)
    } catch (e) {
      log(engine, 'failed, falling back to Tesseract:', e.message)
      if (tray && engine !== 'tesseract') {
        try {
          tray.displayBalloon({
            title: 'OCR 引擎切换',
            content: `${engine} 不可用：${e.message}\n已临时降级到 Tesseract。`
          })
        } catch {}
      }
      try {
        ocrResult = await runTesseract(tmpImg)
        log('Tesseract fallback words:', ocrResult.words?.length)
      } catch (e2) {
        log('Tesseract fallback also failed, trying Windows OCR:', e2.message)
        ocrResult = await runWindowsOCR(tmpImg)
      }
    }

    // Convert coords back to ORIGINAL (non-upscaled) image space
    const scaleBox = (b) => ({
      ...b,
      x: Math.round(b.x / ocrScale),
      y: Math.round(b.y / ocrScale),
      w: Math.round(b.w / ocrScale),
      h: Math.round(b.h / ocrScale)
    })
    if (ocrScale !== 1) {
      if (ocrResult.words) ocrResult.words = ocrResult.words.map(scaleBox)
      if (ocrResult.lines) ocrResult.lines = ocrResult.lines.map(scaleBox)
    }
    log('OCR done. words:', ocrResult.words?.length, 'err:', ocrResult.error)

    if (overlayWin) {
      log('closing overlay')
      try { overlayWin.close() } catch (e) { log('overlay close error:', e.message) }
      overlayWin = null
    }

    // Short-circuit when OCR returned nothing — show in-app toast instead of empty window
    const w_n = ocrResult.words?.length || 0
    const l_n = ocrResult.lines?.length || 0
    const txt = (ocrResult.fullText || '').trim()
    log('OCR short-circuit check: words=' + w_n + ' lines=' + l_n + ' textLen=' + txt.length + ' textPreview="' + txt.substring(0, 50) + '"')
    if (w_n === 0 && l_n === 0 && txt.length === 0) {
      log('→ OCR 0 results, showing toast')
      showToast('未识别到文字', '框选区域里没识别到文字。建议框选完整文字行（上下留余地，宽度 ≥ 200px）')
      return
    }

    log('opening result window')
    openResultWindow(croppedDataUrl, ocrResult, region)
    log('result window opened')

  } catch (err) {
    log('Capture error:', err.message, err.stack)
    if (overlayWin) {
      try { overlayWin.close() } catch {}
      overlayWin = null
    }
  }
})

function runWindowsOCR(imagePath) {
  return new Promise((resolve) => {
    const outPath = path.join(os.tmpdir(), `ocr_result_${Date.now()}.json`)
    const doneMarker = outPath + '.done'
    const batPath = path.join(os.tmpdir(), `ocr_run_${Date.now()}.bat`)
    try { fs.unlinkSync(outPath) } catch {}
    try { fs.unlinkSync(doneMarker) } catch {}

    const batContent =
      `@echo off\r\n` +
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${OCR_SCRIPT_DST}" "${imagePath}" "${outPath}"\r\n` +
      `echo done> "${doneMarker}"\r\n`
    fs.writeFileSync(batPath, batContent)
    log('OCR running via .bat:', batPath)

    const child = spawn('cmd.exe', ['/c', batPath], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore'],
      env: process.env
    })
    child.on('error', (e) => log('OCR spawn error:', e.message))
    child.on('exit', (code) => log('OCR bat exited, code:', code))
    log('OCR bat spawned, pid:', child.pid)

    const startedAt = Date.now()
    let resolved = false
    const finish = (data) => {
      if (resolved) return
      resolved = true
      clearInterval(poll)
      try { fs.unlinkSync(batPath) } catch {}
      resolve(data)
    }

    let attempt = 0
    const poll = setInterval(() => {
      attempt++
      const elapsed = Date.now() - startedAt
      try {
        if (fs.existsSync(outPath)) {
          const content = fs.readFileSync(outPath, 'utf8')
          if (content.length > 0) {
            log(`OCR poll #${attempt} got content (${content.length} bytes)`)
            try {
              const data = JSON.parse(content)
              log('OCR parsed OK, words:', data.words?.length)
              finish(data)
            } catch (pe) {
              log('OCR JSON parse error:', pe.message, 'snippet:', content.substring(0, 200))
              finish({ words: [], fullText: content, error: 'JSON parse: ' + pe.message })
            }
            return
          }
        }
      } catch (e) {
        log('OCR poll error:', e.message)
      }
      if (elapsed > 40000) {
        log('OCR timed out after 40s, attempt:', attempt)
        try { process.kill(child.pid) } catch {}
        finish({ words: [], fullText: '', error: 'OCR timeout' })
      }
    }, 300)
  })
}

function openResultWindow(dataUrl, ocrResult, region) {
  const prevWin = resultWin
  resultWin = null
  if (prevWin && !prevWin.isDestroyed()) {
    try { prevWin.removeAllListeners('closed') } catch {}
    try { prevWin.destroy() } catch {}
  }

  // Default to a comfortable size; user can still resize
  const dispW = Math.round(region.w / frozenScale)
  const dispH = Math.round(region.h / frozenScale)
  const winW = Math.min(Math.max(dispW + 380, 900), 1400)
  const winH = Math.min(Math.max(dispH + 260, 560), 950)

  // Place window near top-center so it's never off-screen / behind anything
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  const x = Math.max(0, Math.round((sw - winW) / 2))
  const y = Math.max(20, Math.round(sh * 0.15))

  const myWin = new BrowserWindow({
    width: winW,
    height: winH,
    x, y,
    frame: true,
    alwaysOnTop: true,
    title: 'Lensy',
    icon: APP_ICON,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  resultWin = myWin

  myWin.loadFile('result.html')
  myWin.on('closed', () => {
    log('result window closed event')
    if (resultWin === myWin) resultWin = null
  })

  // Force window to the very top and grab focus when ready
  myWin.once('ready-to-show', () => {
    log('result window ready-to-show')
    forceShowOnTop(myWin)
  })

  myWin.webContents.once('did-finish-load', () => {
    log('result window did-finish-load, sending init')
    if (!myWin.isDestroyed()) {
      myWin.webContents.send('init', { dataUrl, ocrResult, region })
    } else {
      log('result window already destroyed before init')
    }
  })
}

// In-memory word meaning cache (1h TTL)
const wordCache = new Map()
const CACHE_TTL = 60 * 60 * 1000

ipcMain.handle('get-word-meaning', async (event, word, context) => {
  const key = word.toLowerCase().trim()
  const cached = wordCache.get(key)
  if (cached && Date.now() - cached.t < CACHE_TTL) return cached.v

  const keyErr = ensureApiKey()
  if (keyErr) return { word, meaning_cn: keyErr }

  try {
    const res = await client.chat.completions.create({
      model: settings.model || 'deepseek-chat',
      max_tokens: 700,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: `请为单词或短语 "${word}" 提供详细词义解释（上下文："${context}"）。
返回严格的 JSON：
{
  "word": "原词",
  "phonetic": "音标（IPA）",
  "pos": "词性，如 n./v./adj.",
  "meaning_cn": "中文释义（在该上下文中的含义）",
  "meaning_en": "英文释义（简短）",
  "examples": ["例句1", "例句2"],
  "synonyms": ["近义词1", "近义词2", "近义词3"],
  "root": "词根词缀拆解，如 'epi-(over) + hemera(day) = lasting only a day'",
  "frequency": "词频等级，从这几个选一个: 高中, CET4, CET6, 考研, GRE, 雅思, TOEFL, 口语, 罕见",
  "note": "记忆技巧或文化背景（一句话，可选）"
}
只返回 JSON。`
      }]
    })
    const data = JSON.parse(res.choices[0].message.content)
    wordCache.set(key, { t: Date.now(), v: data })
    return data
  } catch (e) {
    return { word, meaning_cn: '查询失败: ' + e.message }
  }
})

// ── Vocab IPC ──────────────────────────────────────────────────────────
ipcMain.handle('vocab-add', (event, entry) => {
  const v = loadVocab()
  const existing = v.words.findIndex(w => w.word?.toLowerCase() === entry.word?.toLowerCase())
  const record = {
    id: 'w_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    added_at: new Date().toISOString(),
    review_count: 0,
    familiarity: 0,
    ...entry
  }
  if (existing >= 0) v.words[existing] = { ...v.words[existing], ...record, id: v.words[existing].id }
  else v.words.unshift(record)
  saveVocab(v)
  return { ok: true, total: v.words.length, duplicate: existing >= 0 }
})

ipcMain.handle('vocab-list',   () => loadVocab())
ipcMain.handle('vocab-remove', (event, id) => {
  const v = loadVocab()
  v.words = v.words.filter(w => w.id !== id)
  saveVocab(v)
  return v
})
ipcMain.handle('vocab-clear', () => { saveVocab({ version: 1, words: [] }); return true })

ipcMain.handle('vocab-export-csv', async () => {
  const v = loadVocab()
  if (!v.words.length) return { ok: false, msg: '生词本为空' }

  const escape = s => `"${String(s ?? '').replace(/"/g, '""').replace(/\r?\n/g, '<br>')}"`
  const lines = ['Front,Back,Tags']
  for (const w of v.words) {
    const back = [
      `${w.phonetic || ''} ${w.pos || ''}`.trim(),
      w.meaning_cn || '',
      w.meaning_en ? `<i>${w.meaning_en}</i>` : '',
      (w.examples || []).map(e => `• ${e}`).join('<br>'),
      w.synonyms?.length ? `近义: ${w.synonyms.join(', ')}` : '',
      w.root ? `词根: ${w.root}` : '',
      w.frequency ? `[${w.frequency}]` : ''
    ].filter(Boolean).join('<br><br>')
    const tags = ['lensy', w.frequency].filter(Boolean).join(' ')
    lines.push([escape(w.word), escape(back), escape(tags)].join(','))
  }

  const result = await dialog.showSaveDialog({
    title: '导出 Anki CSV',
    defaultPath: `vocab_${new Date().toISOString().slice(0,10)}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  })
  if (result.canceled || !result.filePath) return { ok: false, msg: '已取消' }

  // BOM for Excel UTF-8 friendliness
  fs.writeFileSync(result.filePath, '﻿' + lines.join('\r\n'), 'utf8')
  return { ok: true, path: result.filePath, count: v.words.length }
})

// ── Settings IPC ───────────────────────────────────────────────────────
ipcMain.handle('settings-get', () => settings)
ipcMain.handle('settings-set', (event, newSettings) => {
  settings = { ...settings, ...newSettings }
  saveSettings(settings)
  // re-init API client if key changed
  if (newSettings.deepseek_api_key !== undefined) {
    client.apiKey = settings.deepseek_api_key
  }
  registerHotkeys()
  return settings
})

ipcMain.handle('test-umi', async () => {
  try {
    const endpoint = (settings.umi_endpoint || 'http://127.0.0.1:1224').replace(/\/$/, '')
    const res = await fetch(endpoint + '/api/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // 1x1 transparent PNG
      body: JSON.stringify({ base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' })
    })
    if (!res.ok) return { ok: false, msg: 'HTTP ' + res.status }
    const j = await res.json()
    if (j.code === 100 || j.code === 101) return { ok: true, msg: 'Umi-OCR 服务可用' }
    return { ok: false, msg: 'Umi 返回 code=' + j.code + ' ' + (j.data || '') }
  } catch (e) {
    return { ok: false, msg: '连接失败: ' + e.message + '。请确认 Umi-OCR 已启动且服务端口开启。' }
  }
})

ipcMain.handle('test-api', async () => {
  try {
    const r = await client.chat.completions.create({
      model: settings.model || 'deepseek-chat',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'say "ok"' }]
    })
    return { ok: true, msg: r.choices[0].message.content }
  } catch (e) {
    return { ok: false, msg: e.message }
  }
})

// ── Quick translate (clipboard) ────────────────────────────────────────
async function openQuickTranslate() {
  const text = clipboard.readText().trim()
  if (!text) {
    if (tray) tray.displayBalloon({ title: 'Lensy', content: '剪贴板为空，请先复制文字' })
    return
  }

  if (quickWin && !quickWin.isDestroyed()) {
    forceShowOnTop(quickWin)
    quickWin.webContents.send('quick-text', text)
    return
  }

  quickWin = new BrowserWindow({
    width: 520, height: 380,
    title: 'Lensy — 剪贴板翻译',
    alwaysOnTop: true,
    icon: APP_ICON,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  quickWin.loadFile('quick.html')
  quickWin.on('closed', () => { quickWin = null })
  quickWin.once('ready-to-show', () => forceShowOnTop(quickWin))
  quickWin.webContents.once('did-finish-load', () => {
    quickWin.webContents.send('quick-text', text)
  })
}

// ── Settings / Vocab windows ───────────────────────────────────────────
function openSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) { forceShowOnTop(settingsWin); return }
  settingsWin = new BrowserWindow({
    width: 560, height: 580,
    title: 'Lensy — 设置',
    resizable: false,
    alwaysOnTop: true,
    icon: APP_ICON,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  settingsWin.loadFile('settings.html')
  settingsWin.on('closed', () => { settingsWin = null })
  settingsWin.once('ready-to-show', () => forceShowOnTop(settingsWin))
}

ipcMain.on('open-settings', () => openSettingsWindow())
ipcMain.on('open-vocab',    () => openVocabWindow())

function openVocabWindow() {
  if (vocabWin && !vocabWin.isDestroyed()) { forceShowOnTop(vocabWin); return }
  vocabWin = new BrowserWindow({
    width: 800, height: 600,
    title: 'Lensy — 生词本',
    alwaysOnTop: true,
    icon: APP_ICON,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  vocabWin.loadFile('vocab.html')
  vocabWin.on('closed', () => { vocabWin = null })
  vocabWin.once('ready-to-show', () => forceShowOnTop(vocabWin))
}

function ensureApiKey() {
  if (!settings.deepseek_api_key || settings.deepseek_api_key.length < 10) {
    return '⚠ 未配置 DeepSeek API Key。请右键托盘图标 → 设置 → 填写 API Key。'
  }
  return null
}

ipcMain.handle('translate-all', async (event, text) => {
  const keyErr = ensureApiKey()
  if (keyErr) return keyErr
  try {
    const res = await client.chat.completions.create({
      model: settings.model || 'deepseek-chat',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `将以下文本翻译成中文，只返回翻译结果：\n\n${text}`
      }]
    })
    return res.choices[0].message.content
  } catch (e) {
    return '翻译失败: ' + e.message
  }
})
