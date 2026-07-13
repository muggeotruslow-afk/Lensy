const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const PROBE_IMAGE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'dist'])

function findExecutableInRoot(root, readdirSync, maxDepth = 4, depth = 0) {
  if (!root || depth > maxDepth) return ''
  let entries
  try { entries = readdirSync(root, { withFileTypes: true }) } catch { return '' }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase() === 'umi-ocr.exe') {
      return path.join(root, entry.name)
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRECTORIES.has(entry.name)) continue
    const found = findExecutableInRoot(path.join(root, entry.name), readdirSync, maxDepth, depth + 1)
    if (found) return found
  }
  return ''
}

function createUmiManager(options = {}) {
  const getSettings = options.getSettings || (() => ({}))
  const getCandidatePaths = options.getCandidatePaths || (() => [])
  const getSearchRoots = options.getSearchRoots || (() => [])
  const existsSync = options.existsSync || fs.existsSync
  const readdirSync = options.readdirSync || fs.readdirSync
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const spawnImpl = options.spawnImpl || spawn
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const onExecutableResolved = options.onExecutableResolved || (() => {})
  const log = options.log || (() => {})

  function discoverExecutable() {
    const configured = getSettings().umi_executable_path || ''
    const candidates = [configured, ...getCandidatePaths()].filter(Boolean)
    for (const candidate of candidates) {
      if (path.win32.basename(candidate).toLowerCase() === 'umi-ocr.exe' && existsSync(candidate)) {
        return candidate
      }
    }
    for (const root of getSearchRoots().filter(Boolean)) {
      const found = findExecutableInRoot(root, readdirSync)
      if (found && existsSync(found)) return found
    }
    return ''
  }

  async function probe() {
    const endpoint = (getSettings().umi_endpoint || 'http://127.0.0.1:1224').replace(/\/$/, '')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    try {
      const response = await fetchImpl(endpoint + '/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64: PROBE_IMAGE }),
        signal: controller.signal
      })
      if (!response.ok) return false
      const body = await response.json()
      return body?.code === 100 || body?.code === 101
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  async function check() {
    const executablePath = discoverExecutable()
    const online = await probe()
    return {
      ok: online,
      status: online ? 'online' : (executablePath ? 'offline' : 'missing'),
      online,
      executablePath,
      message: online
        ? 'Umi-OCR 服务已连接'
        : executablePath
          ? '已找到 Umi-OCR，服务尚未启动'
          : '未找到 Umi-OCR，请选择 Umi-OCR.exe'
    }
  }

  async function launch(executablePath, args = ['--hide']) {
    await new Promise((resolve, reject) => {
      const child = spawnImpl(executablePath, args, {
        cwd: path.win32.dirname(executablePath),
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
        shell: false
      })
      child.once('error', reject)
      child.once('spawn', () => {
        try { child.unref() } catch {}
        resolve()
      })
    })
  }

  async function waitUntilOnline() {
    // Paddle builds can need 15-20 seconds for a cold start on Windows.
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await probe()) return true
      await sleep(500)
    }
    return false
  }

  async function start() {
    const current = await check()
    if (current.online) return { ...current, started: false }
    if (!current.executablePath) return { ...current, started: false }

    try {
      onExecutableResolved(current.executablePath)
      await launch(current.executablePath)
      log('Umi-OCR process launched:', current.executablePath)
    } catch (error) {
      return {
        ok: false,
        status: 'launch_failed',
        online: false,
        started: false,
        executablePath: current.executablePath,
        message: `Umi-OCR 启动失败：${error.message}`
      }
    }

    let retried = false
    let online = await waitUntilOnline()
    if (!online) {
      retried = true
      log('Umi-OCR hidden cold start timed out; retrying with a normal launch')
      try {
        await launch(current.executablePath, [])
      } catch (error) {
        return {
          ok: false,
          status: 'launch_failed',
          online: false,
          started: true,
          retried,
          executablePath: current.executablePath,
          message: `Umi-OCR 重试启动失败：${error.message}`
        }
      }
      online = await waitUntilOnline()
    }

    if (online) {
      // A cold start may create the Umi window before processing --hide. Send
      // the command again after its local HTTP service is ready.
      try {
        await launch(current.executablePath)
        await sleep(200)
      } catch (error) {
        log('Umi-OCR post-start hide command failed:', error.message)
      }
      return {
        ok: true,
        status: 'online',
        online: true,
        started: true,
        retried,
        executablePath: current.executablePath,
        message: 'Umi-OCR 已启动并连接'
      }
    }

    return {
      ok: false,
      status: 'unavailable',
      online: false,
      started: true,
      retried,
      executablePath: current.executablePath,
      message: 'Umi-OCR 已启动，但 HTTP 服务未响应。请确认 Umi 全局设置中的 HTTP 服务已开启。'
    }
  }

  return { check, start }
}

module.exports = { createUmiManager }
