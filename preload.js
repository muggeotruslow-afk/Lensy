const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('Listener must be a function')
  const listener = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('lensy', {
  capture: {
    cancel: () => ipcRenderer.send('cancel-overlay'),
    ready: () => ipcRenderer.send('overlay-ready'),
    submitRegion: region => ipcRenderer.send('capture-region', region),
    onFrozenImage: callback => subscribe('frozen-image', callback)
  },
  translation: {
    translateAll: text => ipcRenderer.invoke('translate-all', text),
    getWordMeaning: (word, context) => ipcRenderer.invoke('get-word-meaning', word, context),
    onResultInit: callback => subscribe('init', callback),
    onQuickText: callback => subscribe('quick-text', callback)
  },
  vocab: {
    add: entry => ipcRenderer.invoke('vocab-add', entry),
    list: () => ipcRenderer.invoke('vocab-list'),
    remove: id => ipcRenderer.invoke('vocab-remove', id),
    clear: () => ipcRenderer.invoke('vocab-clear'),
    exportCsv: () => ipcRenderer.invoke('vocab-export-csv'),
    open: () => ipcRenderer.send('open-vocab')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings-get'),
    save: patch => ipcRenderer.invoke('settings-set', patch),
    testApi: () => ipcRenderer.invoke('test-api'),
    open: () => ipcRenderer.send('open-settings')
  },
  umi: {
    status: () => ipcRenderer.invoke('umi-status'),
    start: () => ipcRenderer.invoke('umi-start'),
    chooseExecutable: () => ipcRenderer.invoke('umi-select-executable'),
    openHomepage: () => ipcRenderer.send('open-umi-homepage')
  },
  toast: {
    onData: callback => subscribe('toast-data', callback)
  }
})
