function registerConfiguredHotkeys(settings, register, handlers) {
  const configured = []
  if (settings.hotkey_capture) {
    configured.push({ kind: 'capture', accelerator: settings.hotkey_capture, callback: handlers.capture })
  }
  if (settings.enable_clipboard_mode && settings.hotkey_clipboard) {
    configured.push({ kind: 'clipboard', accelerator: settings.hotkey_clipboard, callback: handlers.clipboard })
  }

  const registered = []
  const failures = []
  for (const hotkey of configured) {
    try {
      if (register(hotkey.accelerator, hotkey.callback)) {
        registered.push(hotkey.accelerator)
      } else {
        failures.push({
          kind: hotkey.kind,
          accelerator: hotkey.accelerator,
          reason: '快捷键已被其他程序占用'
        })
      }
    } catch (error) {
      failures.push({
        kind: hotkey.kind,
        accelerator: hotkey.accelerator,
        reason: error?.message || '无效的快捷键格式'
      })
    }
  }

  return { registered, failures }
}

module.exports = { registerConfiguredHotkeys }
