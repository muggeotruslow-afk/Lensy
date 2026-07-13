const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

const { createUmiManager } = require('../lib/umi-manager')

function onlineResponse() {
  return { ok: true, json: async () => ({ code: 101 }) }
}

test('reports an already-online Umi service without spawning another process', async () => {
  let spawnCount = 0
  const manager = createUmiManager({
    getSettings: () => ({
      umi_endpoint: 'http://127.0.0.1:1224',
      umi_executable_path: 'C:\\Tools\\Umi-OCR.exe'
    }),
    existsSync: () => true,
    fetchImpl: async () => onlineResponse(),
    spawnImpl: () => { spawnCount++; throw new Error('must not spawn') }
  })

  const result = await manager.start()
  assert.equal(result.ok, true)
  assert.equal(result.started, false)
  assert.equal(result.status, 'online')
  assert.equal(spawnCount, 0)
})

test('starts Umi and sends a second hide command after its HTTP service is ready', async () => {
  const executablePath = 'C:\\Tools\\Umi-OCR.exe'
  const spawnCalls = []
  let fetchCount = 0
  let resolvedPath = ''

  const manager = createUmiManager({
    getSettings: () => ({ umi_endpoint: 'http://127.0.0.1:1224', umi_executable_path: '' }),
    getCandidatePaths: () => [executablePath],
    existsSync: candidate => candidate === executablePath,
    fetchImpl: async () => {
      fetchCount++
      if (fetchCount === 1) throw new Error('offline')
      return onlineResponse()
    },
    spawnImpl: (file, args, options) => {
      spawnCalls.push({ file, args, options })
      const child = new EventEmitter()
      child.unref = () => {}
      queueMicrotask(() => child.emit('spawn'))
      return child
    },
    sleep: async () => {},
    onExecutableResolved: value => { resolvedPath = value }
  })

  const result = await manager.start()
  assert.equal(result.ok, true)
  assert.equal(result.started, true)
  assert.equal(result.status, 'online')
  assert.equal(resolvedPath, executablePath)
  const expectedLaunch = {
    file: executablePath,
    args: ['--hide'],
    options: {
      cwd: 'C:\\Tools',
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
      shell: false
    }
  }
  assert.deepEqual(spawnCalls, [expectedLaunch, expectedLaunch])
})

test('returns a setup action when Umi-OCR.exe cannot be found', async () => {
  const manager = createUmiManager({
    getSettings: () => ({ umi_endpoint: 'http://127.0.0.1:1224', umi_executable_path: '' }),
    getCandidatePaths: () => [],
    getSearchRoots: () => [],
    existsSync: () => false,
    fetchImpl: async () => { throw new Error('offline') }
  })

  const result = await manager.start()
  assert.equal(result.ok, false)
  assert.equal(result.status, 'missing')
  assert.match(result.message, /选择 Umi-OCR\.exe/)
})

test('retries with a normal launch when the hidden cold start never opens HTTP', async () => {
  const executablePath = 'C:\\Tools\\Umi-OCR.exe'
  const spawnCalls = []
  let fetchCount = 0
  const manager = createUmiManager({
    getSettings: () => ({ umi_endpoint: 'http://127.0.0.1:1224', umi_executable_path: executablePath }),
    existsSync: candidate => candidate === executablePath,
    fetchImpl: async () => {
      fetchCount++
      if (fetchCount < 62) throw new Error('offline')
      return onlineResponse()
    },
    spawnImpl: (file, args) => {
      spawnCalls.push({ file, args })
      const child = new EventEmitter()
      child.unref = () => {}
      queueMicrotask(() => child.emit('spawn'))
      return child
    },
    sleep: async () => {}
  })

  const result = await manager.start()
  assert.equal(result.ok, true)
  assert.equal(result.retried, true)
  assert.deepEqual(spawnCalls.map(call => call.args), [['--hide'], [], ['--hide']])
})
