// Wayback Archives panel. Requests run only while the user has the panel open.
{
  const panel = document.getElementById('archives-panel')
  const limit = document.getElementById('archive-capture-limit')
  const status = document.getElementById('archive-capture-status')
  const list = document.getElementById('archive-capture-list')
  const storage = globalThis.browser?.storage || chrome.storage
  const limits = ['5', '10', '20']
  const cache = new Map()
  const ttl = 2 * 60 * 1000
  let pending

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

  function render({ count, captures }) {
    const availability = count.status !== 'fulfilled' ? 'Total unavailable' :
      count.value.total < 0 ? 'Capture count blocked' : count.value.total === 1 ?
        '1 Wayback capture' : count.value.total.toLocaleString() + ' Wayback captures'

    status.textContent = captures.status !== 'fulfilled' ? availability + ' · Recent captures unavailable' :
      !captures.value.length ? availability + ' · No recent captures found' : availability

    for (const capture of captures.status === 'fulfilled' ? captures.value : []) {
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
      const keys = ['private_mode_setting', 'auto_exclude_list']
      const settings = await storage.local.get(keys)
      if (controller.signal.aborted) { return }
      const original = getCleanUrl(activeURL)
      if (settings.private_mode_setting !== false) {
        status.textContent = 'Turn off Private Mode to look up captures.'
        return
      }
      if (!isNotExcludedUrl(original) || isUrlInList(original, settings.auto_exclude_list || defaultAutoExcludeList)) {
        status.textContent = 'This URL is unsupported or excluded.'
        return
      }
      const url = new URL(original)
      url.hash = ''
      const key = JSON.stringify([url.href, limit.value])
      const saved = cache.get(key)
      if (saved && Date.now() - saved.at < ttl) {
        render(saved.result)
        return
      }
      const [count, captures] = await Promise.allSettled([
        getWaybackSparkline(url.href, controller.signal),
        getCaptures(url.href, limit.value, controller.signal)
      ])
      if (controller.signal.aborted) { return }
      const result = { count, captures }
      if (count.status === 'fulfilled' && captures.status === 'fulfilled') {
        if (cache.size >= 10) { cache.delete(cache.keys().next().value) }
        cache.set(key, { at: Date.now(), result })
      }
      render(result)
    } catch (error) {
      if (!controller.signal.aborted) { status.textContent = 'Wayback lookup unavailable.' }
    }
  }

  panel.addEventListener('toggle', refresh)
  limit.addEventListener('change', () => {
    storage.local.set({ archive_capture_limit: limit.value }).catch(console.warn)
    refresh()
  })
  storage.local.get('archive_capture_limit').then(settings => {
    if (limits.includes(settings.archive_capture_limit) && !panel.open) {
      limit.value = settings.archive_capture_limit
    }
  }).catch(console.warn)
  storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.private_mode_setting || changes.auto_exclude_list)) {
      panel.open = false
      pending?.abort()
      cache.clear()
    }
  })
  window.addEventListener('pagehide', () => pending?.abort())
}
