function createSecureWebPreferences(preloadPath) {
  if (typeof preloadPath !== 'string' || !preloadPath) {
    throw new Error('A preload path is required for secure renderer windows')
  }
  return {
    preload: preloadPath,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false
  }
}

module.exports = { createSecureWebPreferences }
