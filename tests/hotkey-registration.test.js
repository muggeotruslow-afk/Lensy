const test = require('node:test')
const assert = require('node:assert/strict')

const { registerConfiguredHotkeys } = require('../lib/hotkey-registration')

const settings = {
  hotkey_capture: 'Alt+Shift+T',
  enable_clipboard_mode: true,
  hotkey_clipboard: 'Alt+Shift+D'
}

test('returns both successful hotkey registrations', () => {
  const calls = []
  const result = registerConfiguredHotkeys(settings, (accelerator, callback) => {
    calls.push({ accelerator, callback })
    return true
  }, { capture: () => {}, clipboard: () => {} })

  assert.deepEqual(result.failures, [])
  assert.deepEqual(result.registered, ['Alt+Shift+T', 'Alt+Shift+D'])
  assert.equal(calls.length, 2)
})

test('reports false return values as registration failures', () => {
  const result = registerConfiguredHotkeys(settings, accelerator => accelerator !== 'Alt+Shift+T', {
    capture: () => {}, clipboard: () => {}
  })

  assert.deepEqual(result.registered, ['Alt+Shift+D'])
  assert.deepEqual(result.failures, [{
    kind: 'capture',
    accelerator: 'Alt+Shift+T',
    reason: '快捷键已被其他程序占用'
  }])
})

test('reports invalid accelerators that throw', () => {
  const result = registerConfiguredHotkeys(
    { ...settings, enable_clipboard_mode: false, hotkey_capture: 'not a hotkey' },
    () => { throw new Error('Invalid accelerator') },
    { capture: () => {}, clipboard: () => {} }
  )

  assert.deepEqual(result.registered, [])
  assert.deepEqual(result.failures, [{
    kind: 'capture',
    accelerator: 'not a hotkey',
    reason: 'Invalid accelerator'
  }])
})
