const test = require('node:test')
const assert = require('node:assert/strict')

const { createSecureWebPreferences } = require('../lib/window-security')

test('creates isolated sandboxed renderer preferences with a preload interface', () => {
  assert.deepEqual(createSecureWebPreferences('C:\\Lensy\\preload.js'), {
    preload: 'C:\\Lensy\\preload.js',
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false
  })
})

test('requires an explicit preload path', () => {
  assert.throws(() => createSecureWebPreferences(''), /preload/i)
})
