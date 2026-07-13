const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const rendererFiles = ['overlay.html', 'result.html', 'settings.html', 'vocab.html', 'quick.html', 'toast.html']

test('renderer pages cannot import Electron or access raw IPC', () => {
  for (const file of rendererFiles) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    assert.doesNotMatch(source, /require\s*\(\s*['"]electron['"]\s*\)/, file)
    assert.doesNotMatch(source, /\bipcRenderer\b/, file)
    assert.match(source, /Content-Security-Policy/, file)
  }
})

test('main process contains no window with Node integration enabled', () => {
  const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8')
  assert.doesNotMatch(source, /nodeIntegration\s*:\s*true/)
  assert.doesNotMatch(source, /contextIsolation\s*:\s*false/)
})

test('preload exposes named capabilities instead of a generic IPC escape hatch', () => {
  const source = fs.readFileSync(path.join(root, 'preload.js'), 'utf8')
  assert.match(source, /contextBridge\.exposeInMainWorld\('lensy'/)
  assert.doesNotMatch(source, /invoke\s*:\s*ipcRenderer\.invoke/)
  assert.doesNotMatch(source, /send\s*:\s*ipcRenderer\.send/)
})
