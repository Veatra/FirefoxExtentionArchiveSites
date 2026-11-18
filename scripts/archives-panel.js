// Archive controls and lookup. Wayback requests run only while the panel is open.
{
  const panel = document.getElementById('archives-panel')
  const limit = document.getElementById('archive-capture-limit')
  const status = document.getElementById('archive-capture-status')
  const list = document.getElementById('archive-capture-list')
  const api = globalThis.browser || chrome
  const storage = api.storage
  const enabled = document.getElementById('archive-today-enabled')
  const mirror = document.getElementById('archive-today-mirror')
  const selectedTarget = document.getElementById('archive-target')
  const todayStatus = document.getElementById('archive-today-status')
  const browse = document.getElementById('archive-today-browse')
  const save = document.getElementById('archive-today-save')
  const saveBoth = document.getElementById('archive-save-both')
  const actions = document.getElementById('archive-today-actions')
  const actionStatus = document.getElementById('archive-action-status')
  const actionHelp = document.getElementById('archive-action-help')
  const keys = [
    'archive_today_enabled', 'archive_today_mirror', 'archive_capture_limit',
    'private_mode_setting', 'auto_exclude_list'
  ]
  const cache = new Map()
  const ttl = 2 * 60 * 1000
  let pending
  let settings = {}
  let opening = false

  function targetFor(url, preferences) {
    if (preferences.private_mode_setting !== false) { return null }
    return archiveTargetUrl(url, preferences.auto_exclude_list || defaultAutoExcludeList)
  }

  function updateActions() {
    const active = settings.archive_today_enabled === true
    const privateMode = settings.private_mode_setting !== false
    const target = targetFor(activeURL, settings)
    const address = archiveTargetUrl(isArchiveUrl(activeURL) ? getCleanUrl(activeURL) : activeURL)
    selectedTarget.textContent = address ? 'Page: ' + address : ''
    selectedTarget.title = address || ''
    actions.hidden = !active
    browse.disabled = !active || !target || opening
    save.disabled = browse.disabled
    saveBoth.disabled = browse.disabled || waybackSaving
    actionHelp.textContent = privateMode
      ? 'Turn off Private Mode to use Archive.today.'
      : !target ? 'This URL is unsupported or excluded.'
        : 'Archive.today opens a tab and may publish the URL.'
    todayStatus.textContent = !active ? 'Enable Archive.today in Settings to use it.'
      : privateMode ? 'Private Mode is on.'
        : !target ? 'This URL is unsupported or excluded.'
          : 'Availability unknown. Open the provider to check for copies.'
  }

  async function openArchiveToday(action) {
    if (opening) { return }
    const selected = activeURL
    opening = true
    updateActions()
    actionStatus.textContent = ''
    let waybackStarted = false
    try {
      const current = await storage.local.get(keys)
      const target = selected === activeURL && targetFor(selected, current)
      if (!target || current.archive_today_enabled !== true) {
        actionStatus.textContent = 'Archive.today is disabled or the URL is excluded.'
        return
      }
      const host = archiveTodayMirrors.includes(current.archive_today_mirror)
        ? current.archive_today_mirror : archiveTodayMirrors[0]
      const url = archiveTodayActionUrl(host, target, action === 'search' ? 'search' : 'save')
      if (action === 'both') {
        waybackStarted = startWaybackSave(target)
        if (!waybackStarted) {
          actionStatus.textContent = 'A Wayback save is already in progress.'
          return
        }
      }
      await api.tabs.create({ url })
    } catch (error) {
      actionStatus.textContent = waybackStarted
        ? 'Wayback save requested. The Archive.today tab could not open.'
        : 'Could not open the Archive.today tab.'
    } finally {
      opening = false
      updateActions()
    }
  }

  function applySettings(current) {
    settings = current
    limit.value = archiveCaptureLimit(current.archive_capture_limit)
    enabled.checked = current.archive_today_enabled === true
    mirror.value = archiveTodayMirrors.includes(current.archive_today_mirror)
      ? current.archive_today_mirror : archiveTodayMirrors[0]
    mirror.disabled = !enabled.checked
    updateActions()
  }

  function saveSetting(values) {
    storage.local.set(values).catch(() => {
      actionStatus.textContent = 'Could not save archive settings.'
      storage.local.get(keys).then(applySettings).catch(console.warn)
    })
  }

  function parseCaptures(payload) {
    if (!Array.isArray(payload)) { throw new Error('Invalid Wayback capture response') }
    if (!payload.length) { return [] }
    const [header, ...rows] = payload
    if (!Array.isArray(header) || header.join(',') !== 'timestamp,original,statuscode') {
      throw new Error('Invalid Wayback capture columns')
    }

    const captures = rows.flatMap(row => {
      const [timestamp, original, code] = Array.isArray(row) ? row : []
      if (!/^\d{14}$/.test(timestamp) || !isNotExcludedUrl(original)) { return [] }
      const date = timestampToDate(timestamp)
      if (!date || dateToTimestamp(date) !== timestamp) { return [] }
      return [{ date, timestamp, code: /^\d{3}$/.test(code) ? code : '', original }]
    })
    if (rows.length && !captures.length) { throw new Error('No readable Wayback capture rows') }
    return captures.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  }

  async function getCaptures(url, count, signal) {
    const request = new URL('https://web.archive.org/cdx/search/cdx')
    request.search = new URLSearchParams({
      url,
      matchType: 'exact',
      output: 'json',
      fl: 'timestamp,original,statuscode',
      limit: '-' + count
    })
    return fetchWithTimeout(request.href, { signal, credentials: 'omit' }, async response => {
      if (!response.ok) { throw new Error('Wayback CDX HTTP ' + response.status) }
      return parseCaptures(await response.json())
    })
  }

  function renderStatus({ count, captures }) {
    const hasRows = captures.status === 'fulfilled' && captures.value.length > 0
    let availability
    if (count.status === 'pending') {
      availability = hasRows ? 'Copies found · checking total…' : 'Checking total…'
    } else if (count.status === 'rejected' || (count.value.total === 0 && hasRows)) {
      availability = hasRows ? 'Copies found · total unavailable' : 'Total unavailable'
    } else if (count.value.total < 0) {
      availability = 'Capture count blocked'
    } else {
      const total = count.value.total
      availability = total.toLocaleString() + (total === 1 ? ' Wayback capture' : ' Wayback captures')
    }
    let detail = ''
    if (captures.status === 'pending') { detail = ' · Checking recent captures…' }
    if (captures.status === 'rejected') { detail = ' · Recent captures unavailable' }
    if (captures.status === 'fulfilled' && !hasRows) { detail = ' · No recent captures found' }
    status.textContent = availability + detail
  }

  function renderCaptures(captures) {
    for (const capture of captures) {
      const url = 'https://web.archive.org/web/' + capture.timestamp + '/' + capture.original
      const row = document.createElement('li')
      const link = document.createElement('a')
      const copy = document.createElement('button')
      link.href = url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      const day = capture.date.toISOString().slice(0, 10)
      const time = capture.date.toISOString().slice(11, 16)
      link.textContent = day + ' ' + time + (capture.code ? ' · ' + capture.code : '')
      link.title = 'Open capture at ' + time + ' UTC'
      copy.type = 'button'
      copy.className = 'archive-action'
      copy.textContent = 'Copy'
      copy.setAttribute('aria-label', 'Copy capture from ' + day + ' at ' + time + ' UTC')
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(url)
          status.textContent = 'Capture link copied'
        } catch (error) {
          status.textContent = 'Could not copy the capture link'
        }
      })
      row.append(link, copy)
      list.append(row)
    }
  }

  async function refresh() {
    pending?.abort()
    list.replaceChildren()
    if (!panel.open) { return }

    const controller = new AbortController()
    pending = controller
    status.textContent = 'Checking Wayback…'
    try {
      const preferences = await storage.local.get(keys)
      if (controller.signal.aborted || !panel.open) { return }
      const original = isArchiveUrl(activeURL) ? getCleanUrl(activeURL) : activeURL
      if (preferences.private_mode_setting !== false) {
        status.textContent = 'Turn off Private Mode to look up captures.'
        return
      }
      const url = targetFor(original, preferences)
      if (!url) {
        status.textContent = 'This URL is unsupported or excluded.'
        return
      }
      const countLimit = archiveCaptureLimit(preferences.archive_capture_limit)
      const key = JSON.stringify([url, countLimit])
      const saved = cache.get(key)
      if (saved && Date.now() - saved.at < ttl) {
        renderStatus(saved.result)
        renderCaptures(saved.result.captures.value)
        return
      }
      const result = { count: { status: 'pending' }, captures: { status: 'pending' } }
      async function load(key, request) {
        try {
          result[key] = { status: 'fulfilled', value: await request }
        } catch (error) {
          result[key] = { status: 'rejected' }
        }
        if (controller.signal.aborted || !panel.open) { return }
        if (key === 'captures' && result[key].status === 'fulfilled') { renderCaptures(result[key].value) }
        renderStatus(result)
      }
      await Promise.all([
        load('count', getWaybackSparkline(url, controller.signal)),
        load('captures', getCaptures(url, countLimit, controller.signal))
      ])
      if (controller.signal.aborted || !panel.open) { return }
      if (result.count.status === 'fulfilled' && result.captures.status === 'fulfilled') {
        if (cache.size >= 10) { cache.delete(cache.keys().next().value) }
        cache.set(key, { at: Date.now(), result })
      }
    } catch (error) {
      if (!controller.signal.aborted) { status.textContent = 'Wayback lookup unavailable.' }
    }
  }

  panel.addEventListener('toggle', refresh)
  browse.addEventListener('click', () => openArchiveToday('search'))
  save.addEventListener('click', () => openArchiveToday('save'))
  saveBoth.addEventListener('click', () => openArchiveToday('both'))
  enabled.addEventListener('change', () => saveSetting({ archive_today_enabled: enabled.checked }))
  mirror.addEventListener('change', () => saveSetting({ archive_today_mirror: mirror.value }))
  limit.addEventListener('change', () => {
    limit.value = archiveCaptureLimit(limit.value)
    saveSetting({ archive_capture_limit: limit.value })
  })
  storage.local.get(keys).then(applySettings).catch(console.warn)
  storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !keys.some(key => key in changes)) { return }
    if (changes.private_mode_setting || changes.auto_exclude_list) {
      panel.open = false
      pending?.abort()
      cache.clear()
    }
    storage.local.get(keys).then(applySettings).catch(console.warn)
  })
  document.addEventListener('archive-target-changed', () => {
    actionStatus.textContent = ''
    updateActions()
    if (panel.open) { refresh() }
  })
  document.addEventListener('archive-save-state-changed', updateActions)
  window.addEventListener('pagehide', () => pending?.abort())
}
