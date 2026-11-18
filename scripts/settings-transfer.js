// Only the listed preferences can appear in a settings backup.
const backupDefaults = {
  spn_outlinks: false,
  spn_screenshot: false,
  email_results_setting: false,
  my_archive_setting: false,
  not_found_setting: false,
  embed_popup_setting: false,
  wm_count_setting: false,
  fact_check_setting: false,
  wiki_setting: false,
  amazon_setting: false,
  tvnews_setting: false,
  resource_list_setting: false,
  notify_setting: false,
  view_setting: 'tab',
  auto_archive_age: '99999',
  auto_archive_custom_value: 1,
  auto_archive_custom_unit: 'days',
  archive_capture_limit: '5',
  archive_today_mirror: 'archive.today'
}
const backupKeys = [...Object.keys(backupDefaults), 'auto_exclude_list']
const maxBackupBytes = 64 * 1024

function validateBackupSettings(settings, defaults, validateInterval) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('The backup has no settings object.')
  }
  const clean = {}
  for (const key of backupKeys) {
    if (!Object.hasOwn(settings, key)) { continue }
    const value = settings[key]
    let valid = false
    if (typeof backupDefaults[key] === 'boolean') {
      valid = typeof value === 'boolean'
    } else {
      switch (key) {
        case 'view_setting': valid = ['tab', 'replace', 'window'].includes(value); break
        case 'auto_archive_age': valid = ['99999', '365', '90', '30', '7', '1', 'custom'].includes(value); break
        case 'auto_archive_custom_unit': valid = ['hours', 'days'].includes(value); break
        case 'auto_archive_custom_value': valid = Number.isInteger(value) && value >= 1 && value <= 8760; break
        case 'archive_today_mirror': valid = ['archive.today', 'archive.is'].includes(value); break
        case 'archive_capture_limit': valid = typeof value === 'string' && /^(?:[1-9]|[12][0-9]|30)$/.test(value); break
        case 'auto_exclude_list':
          valid = Array.isArray(value) && value.length <= 200 &&
            value.every(pattern => typeof pattern === 'string' && pattern.length <= 512 && pattern.trim() !== '')
          break
      }
    }
    if (!valid) { throw new Error('Invalid backup value for ' + key + '.') }
    clean[key] = value
  }
  const merged = { ...defaults, ...clean }
  if (validateInterval(merged.auto_archive_custom_value, merged.auto_archive_custom_unit) === null) {
    throw new Error('The custom interval is outside the supported range.')
  }
  return clean
}

function backupImport(payload, current, replace, defaults, validateInterval) {
  if (!payload || payload.version !== 1) { throw new Error('Unsupported settings backup version.') }
  const clean = validateBackupSettings(payload.settings, replace ? defaults : current, validateInterval)
  if (!Object.keys(clean).length) { throw new Error('The backup contains no supported settings.') }
  const values = replace ? { ...defaults, ...clean } : clean
  if (!replace && clean.auto_exclude_list) {
    values.auto_exclude_list = Array.from(new Set([...(current.auto_exclude_list || defaults.auto_exclude_list), ...clean.auto_exclude_list]))
    if (values.auto_exclude_list.length > 200) { throw new Error('The merged list exceeds 200 exclusions.') }
  }
  // Importing an age or different exclusions must never start sending URLs.
  return { ...values, auto_archive_setting: false, auto_bookmark_setting: false }
}

function downloadArchiveJson(filename, data) {
  const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

if (typeof module !== 'undefined') {
  module.exports = { backupImport, validateBackupSettings }
} else {
  const api = globalThis.browser || chrome
  const defaults = { ...backupDefaults, auto_exclude_list: defaultAutoExcludeList }
  const status = document.getElementById('settings-backup-status')
  const fileInput = document.getElementById('settings-backup-file')
  const importButton = document.getElementById('settings-backup-import')
  const exportButton = document.getElementById('settings-backup-export')

  exportButton.addEventListener('click', async () => {
    try {
      const stored = await api.storage.local.get(backupKeys)
      const settings = validateBackupSettings({ ...defaults, ...stored }, defaults, customAutoSaveHours)
      const payload = { version: 1, settings }
      if (new Blob([JSON.stringify(payload, null, 2)]).size > maxBackupBytes) {
        throw new Error('The export exceeds 64 KiB.')
      }
      downloadArchiveJson('web-archives-settings.json', payload)
      status.textContent = 'Settings exported.'
    } catch (error) {
      status.textContent = error.message || 'Could not export settings.'
    }
  })
  importButton.addEventListener('click', async () => {
    const file = fileInput.files[0]
    if (!file) { status.textContent = 'Choose a settings backup first.'; return }
    if (file.size > maxBackupBytes) { status.textContent = 'The backup exceeds 64 KiB.'; return }
    importButton.disabled = true
    try {
      const replace = document.getElementById('settings-backup-mode').value === 'replace'
      const payload = JSON.parse(await file.text())
      const current = await api.storage.local.get(backupKeys)
      const values = backupImport(payload, { ...defaults, ...current }, replace, defaults, customAutoSaveHours)
      await api.storage.local.set(values)
      initSettings()
      status.textContent = 'Settings imported. Automatic saves are paused.'
      fileInput.value = ''
    } catch (error) {
      status.textContent = error.message || 'Could not import settings.'
    } finally {
      importButton.disabled = false
    }
  })
}
