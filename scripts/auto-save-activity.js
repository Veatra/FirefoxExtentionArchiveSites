// Local auto-save activity controls. The background serializes all log updates.
{
  const api = globalThis.browser || chrome
  const panel = document.getElementById('auto-save-activity')
  const enabled = document.getElementById('auto-save-activity-enabled')
  const status = document.getElementById('auto-save-activity-status')
  const list = document.getElementById('auto-save-activity-list')
  const exportButton = document.getElementById('auto-save-activity-export')
  const clearButton = document.getElementById('auto-save-activity-clear')
  const keys = ['auto_save_activity_enabled', 'auto_save_activity']

  async function refresh() {
    try {
      const settings = await api.storage.local.get(keys)
      const events = Array.isArray(settings.auto_save_activity) ? settings.auto_save_activity : []
      enabled.checked = settings.auto_save_activity_enabled === true
      list.replaceChildren()
      for (const event of events) {
        const item = document.createElement('li')
        item.textContent = new Date(event.at).toLocaleString() + ' · ' + event.site + ' · ' + event.outcome
        list.append(item)
      }
      exportButton.disabled = clearButton.disabled = events.length === 0
      status.textContent = events.length ? '' : 'No activity recorded yet.'
    } catch (error) {
      status.textContent = 'Could not read auto-save activity.'
    }
  }

  panel.addEventListener('toggle', () => { if (panel.open) { refresh() } })
  api.storage.onChanged.addListener((changes, area) => {
    if (panel.open && area === 'local' && keys.some(key => key in changes)) { refresh() }
  })
  enabled.addEventListener('change', async () => {
    try {
      await api.storage.local.set({ auto_save_activity_enabled: enabled.checked })
    } catch (error) {
      enabled.checked = !enabled.checked
      status.textContent = 'Could not change the activity setting.'
    }
  })
  exportButton.addEventListener('click', async () => {
    try {
      const { auto_save_activity = [] } = await api.storage.local.get('auto_save_activity')
      downloadArchiveJson('web-archives-auto-save-activity.json', { version: 1, events: auto_save_activity })
    } catch (error) {
      status.textContent = 'Could not export activity.'
    }
  })
  clearButton.addEventListener('click', async () => {
    clearButton.disabled = true
    try {
      const response = await api.runtime.sendMessage({ message: 'clearAutoSaveActivity' })
      if (!response?.cleared) { throw new Error('Clear failed') }
      await refresh()
    } catch (error) {
      clearButton.disabled = false
      status.textContent = 'Could not clear activity.'
    }
  })
}
