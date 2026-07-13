const path = require('path')

const MODELS = new Set(['deepseek-chat', 'deepseek-reasoner'])
const OCR_ENGINES = new Set(['umi', 'tesseract', 'windows'])
const LOCAL_UMI_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

function requireString(value, label, maxLength) {
  if (typeof value !== 'string') throw new Error(`${label}必须是文本`)
  const normalized = value.trim()
  if (normalized.length > maxLength) throw new Error(`${label}过长`)
  return normalized
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label}必须是开关值`)
  return value
}

function normalizeLocalUmiEndpoint(value) {
  const raw = requireString(value, 'Umi-OCR 服务地址', 200).replace(/\/$/, '')
  let url
  try { url = new URL(raw) } catch { throw new Error('Umi-OCR 服务地址格式无效') }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (url.protocol !== 'http:' || !LOCAL_UMI_HOSTS.has(hostname)) {
    throw new Error('Umi-OCR 仅允许本机地址（localhost / 127.0.0.1 / ::1）')
  }
  if (url.username || url.password || (url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw new Error('Umi-OCR 服务地址只能包含本机主机名和端口')
  }
  return url.origin
}

function normalizeUmiExecutablePath(value) {
  const executablePath = requireString(value, 'Umi-OCR 程序路径', 1024)
  if (!executablePath) return ''
  if (path.win32.basename(executablePath).toLowerCase() !== 'umi-ocr.exe') {
    throw new Error('请选择 Umi-OCR.exe')
  }
  return executablePath
}

function sanitizeSettingsPatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('设置数据格式无效')
  }

  const output = {}
  if ('deepseek_api_key' in input) output.deepseek_api_key = requireString(input.deepseek_api_key, 'API Key', 512)
  if ('hotkey_capture' in input) output.hotkey_capture = requireString(input.hotkey_capture, '截图热键', 64)
  if ('hotkey_clipboard' in input) output.hotkey_clipboard = requireString(input.hotkey_clipboard, '剪贴板热键', 64)
  if ('auto_translate' in input) output.auto_translate = requireBoolean(input.auto_translate, '自动翻译')
  if ('enable_clipboard_mode' in input) output.enable_clipboard_mode = requireBoolean(input.enable_clipboard_mode, '剪贴板模式')
  if ('umi_auto_start' in input) output.umi_auto_start = requireBoolean(input.umi_auto_start, 'Umi-OCR 自动启动')

  if ('model' in input) {
    const model = requireString(input.model, '模型', 64)
    if (!MODELS.has(model)) throw new Error('不支持的翻译模型')
    output.model = model
  }
  if ('ocr_engine' in input) {
    const engine = requireString(input.ocr_engine, 'OCR 引擎', 32)
    if (!OCR_ENGINES.has(engine)) throw new Error('不支持的 OCR 引擎')
    output.ocr_engine = engine
  }
  if ('umi_endpoint' in input) output.umi_endpoint = normalizeLocalUmiEndpoint(input.umi_endpoint)
  if ('umi_executable_path' in input) output.umi_executable_path = normalizeUmiExecutablePath(input.umi_executable_path)
  if ('umi_language' in input) output.umi_language = requireString(input.umi_language, 'Umi-OCR 语言配置', 256)

  return output
}

module.exports = {
  normalizeLocalUmiEndpoint,
  normalizeUmiExecutablePath,
  sanitizeSettingsPatch
}
