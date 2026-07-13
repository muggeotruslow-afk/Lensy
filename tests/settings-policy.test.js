const test = require('node:test')
const assert = require('node:assert/strict')

const { sanitizeSettingsPatch } = require('../lib/settings-policy')

test('accepts supported Lensy settings and normalizes the local Umi endpoint', () => {
  assert.deepEqual(sanitizeSettingsPatch({
    hotkey_capture: ' Alt+Shift+T ',
    ocr_engine: 'umi',
    umi_endpoint: 'http://127.0.0.1:1224/',
    umi_executable_path: 'C:\\Tools\\Umi-OCR.exe',
    umi_auto_start: true
  }), {
    hotkey_capture: 'Alt+Shift+T',
    ocr_engine: 'umi',
    umi_endpoint: 'http://127.0.0.1:1224',
    umi_executable_path: 'C:\\Tools\\Umi-OCR.exe',
    umi_auto_start: true
  })
})

test('rejects non-local Umi endpoints', () => {
  assert.throws(
    () => sanitizeSettingsPatch({ umi_endpoint: 'https://example.com/ocr' }),
    /仅允许本机地址/
  )
})

test('rejects executable paths that are not Umi-OCR.exe', () => {
  assert.throws(
    () => sanitizeSettingsPatch({ umi_executable_path: 'C:\\Tools\\something.exe' }),
    /Umi-OCR\.exe/
  )
})

test('drops unknown renderer-supplied settings fields', () => {
  assert.deepEqual(sanitizeSettingsPatch({
    ocr_engine: 'windows',
    arbitrary_main_process_option: true
  }), { ocr_engine: 'windows' })
})

test('rejects unsupported model and OCR engine values', () => {
  assert.throws(() => sanitizeSettingsPatch({ model: 'unknown-model' }), /模型/)
  assert.throws(() => sanitizeSettingsPatch({ ocr_engine: 'remote-shell' }), /OCR/)
})
