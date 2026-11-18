// utils.js

// from 'test/setup.js'
/*   global isInTestEnv */

// default exclude list for auto-save
const defaultAutoExcludeList = [
  'archive.org*',
  'web.archive.org*',
  'google.com*',
  '*.google.com*',
  'mail.yahoo.com*',
  'duckduckgo.com/?q=*',
  '*.discord.com/api/webhooks/*',
  '*.proton.me*'
]

const newshosts = new Set([
  'apnews.com',
  'www.factcheck.org',
  'www.forbes.com',
  'www.huffpost.com',
  'www.nytimes.com',
  'www.politico.com',
  'www.politifact.com',
  'www.snopes.com',
  'www.theverge.com',
  'www.usatoday.com',
  'www.vox.com',
  'www.washingtonpost.com',
  'edition.cnn.com'
])

let isArray = (a) => (!!a) && (a.constructor === Array)
let isObject = (a) => (!!a) && (a.constructor === Object)

// Use this instead of encodeURIComponent()
function fixedEncodeURIComponent(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, function(c) {
    return '%' + c.charCodeAt(0).toString(16)
  })
}

/* * * Browser Detection * * */

function getBrowser() {
  // the order of these is important!
  if (navigator.brave) { return 'brave' }
  else if (navigator.userAgent.indexOf('Edg') !== -1) { return 'edge' }
  else if (navigator.userAgent.indexOf('OPR') !== -1) { return 'opera' }
  else if (navigator.userAgent.indexOf('Firefox') !== -1) { return 'firefox' }
  else if (navigator.userAgent.indexOf('Chromium') !== -1) { return 'chromium' }
  else if (navigator.userAgent.indexOf('Chrome') !== -1) { return 'chrome' }
  else if (navigator.userAgent.indexOf('Safari') !== -1) { return 'safari' }
  else if ((navigator.userAgent.indexOf('Trident') !== -1) || (navigator.userAgent.indexOf('MSIE'))) { return 'ie' }
  else { return '' }
}

const hostURLs = {
  chrome: 'https://chrome-api.archive.org/',
  chromium: 'https://chrome-api.archive.org/',
  firefox: 'https://firefox-api.archive.org/',
  safari: 'https://safari-api.archive.org/',
  brave: 'https://brave-api.archive.org/',
  edge: 'https://edge-api.archive.org/',
  ie: 'https://edge-api.archive.org/',
  opera: 'https://opera-api.archive.org/'
}

const feedbackURLs = {
  chrome: 'https://chromewebstore.google.com/detail/wayback-machine/fpnmgdkabkmnadcjpehmlllkndpkmiak/reviews',
  chromium: 'https://chromewebstore.google.com/detail/wayback-machine/fpnmgdkabkmnadcjpehmlllkndpkmiak/reviews',
  firefox: 'https://addons.mozilla.org/en-US/firefox/addon/wayback-machine_new/',
  safari: 'https://apps.apple.com/us/app/wayback-machine/id1472432422',
  brave: 'https://chromewebstore.google.com/detail/wayback-machine/fpnmgdkabkmnadcjpehmlllkndpkmiak/reviews',
  edge: 'https://microsoftedge.microsoft.com/addons/detail/wayback-machine/kjmickeoogghaimmomagaghnogelpcpn',
  opera: 'https://chromewebstore.google.com/detail/wayback-machine/fpnmgdkabkmnadcjpehmlllkndpkmiak/reviews'
}

const gBrowser = getBrowser()
const isChrome = (gBrowser === 'chrome') || (gBrowser === 'chromium')
const isFirefox = (gBrowser === 'firefox')
const isEdge = (gBrowser === 'edge')
const isSafari = (gBrowser === 'safari')

const hostURL = hostURLs[gBrowser] || hostURLs['chrome']
const feedbackURL = feedbackURLs[gBrowser] || '#'

let gVersion = ''
function getManifestVersion() {
  let ver = ''
  const manifest = chrome.runtime.getManifest()
  if (manifest) {
    ver = manifest.version
  }
  return ver
}

let gCustomUserAgent = ''
function getCustomUserAgent() {
  let uAgent = ''
  const manifest = chrome.runtime.getManifest()
  if (manifest) {
    uAgent = 'Wayback_Machine_' + gBrowser.charAt(0).toUpperCase() + gBrowser.slice(1) + '/' + manifest.version
  }
  return uAgent
}

let hostHeaders = new Headers({
  'Accept': 'application/json'
})

// will not run during mocha testing
if (typeof isInTestEnv === 'undefined') {
  gVersion = getManifestVersion()
  gCustomUserAgent = getCustomUserAgent()
  // Chrome ignores this being set. Works in Firefox & Safari.
  hostHeaders.set('User-Agent', navigator.userAgent + ' ' + gCustomUserAgent)
}

/* * * Archive APIs * * */

/**
 * Get User info 'whoami'.
 * Requires cookies of logged-in user are set.
 * @return {Promise}
 */
function getUserInfo() {
  const apiPromise = new Promise((resolve, reject) => {
    setTimeout(() => {
      reject(new Error('timeout'))
    }, 5000)
    let headers = new Headers(hostHeaders)
    headers.set('Content-Type', 'application/json')
    fetch('https://archive.org/services/user.php?op=whoami', {
      method: 'GET',
      headers: headers
    })
    .then(resolve, reject)
  })
  return apiPromise
  .then(response => response.json())
  .then((res) => {
    if (res?.success && ('value' in res)) {
      // success
      return res.value
    } else {
      console.log('getUserInfo failed')
    }
  })
  .catch((e) => {
    console.log('getUserInfo ERROR: ', e)
  })
}

/**
 * Check if user is logged in by checking cookies.
 * Will retrieve auth cookies from storage and restore cookies if missing.
 * @param callback(result) : returns object { auth_check: bool } where auth_check == true if logged in, false if not.
 */
function checkAuthentication(acallback) {
  chrome.cookies.getAll({ url: 'https://archive.org' }, (cookies) => {
    let loggedIn = false, ia_auth = false
    cookies?.forEach(cookie => {
      if (cookie.name === 'logged-in-sig' && cookie.value?.length > 0) { loggedIn = true }
      else if (cookie.name === 'ia-auth' && cookie.value?.length > 0) { ia_auth = true }
    })
    if (loggedIn) {
      // store auth cookies in storage
      chrome.storage.local.set({ auth_cookies: cookies })
      acallback({ 'auth_check': true })
    } else {
      // if cookies not set but found in storage, then restore cookies from storage,
      // but if user previously logged out of archive.org on the web (ia_auth == true), then don't restore cookies from storage.
      chrome.storage.local.get(['auth_cookies'], (items) => {
        if (items.auth_cookies && !ia_auth) {
          items.auth_cookies.forEach(authCookie => {
            // set only a subset of keys to avoid TypeErrors
            const newCookie = Object.fromEntries(
              ['domain', 'expirationDate', 'httpOnly', 'name', 'path', 'sameSite', 'secure', 'storeId', 'url', 'value']
              .filter(k => k in authCookie).map(k => [k, authCookie[k]])
            )
            newCookie.url = 'https://archive.org'
            chrome.cookies.set(newCookie)
            if (authCookie.name === 'logged-in-sig' && authCookie.value?.length > 0) { loggedIn = true }
          })
        }
        acallback({ 'auth_check': loggedIn })
      })
    }
  })
}

/* * * Storage functions * * */

function getTabKey(tab) {
  return Number.isInteger(tab?.id) && tab.id >= 0 &&
    Number.isInteger(tab?.windowId) && tab.windowId >= 0
    ? `${tab.windowId}i${tab.id}` : ''
}

const tabDataUpdates = new Map()

function queueTabData(tab, run) {
  const id = getTabKey(tab)
  if (!id) { return Promise.resolve() }
  const key = 'tab_' + id
  const previous = tabDataUpdates.get(key) || Promise.resolve()
  const pending = previous.catch(() => {}).then(() => run(key))
  tabDataUpdates.set(key, pending)
  return pending.catch(error => {
    console.warn('Could not update Wayback tab state', error)
  }).finally(() => {
    if (tabDataUpdates.get(key) === pending) { tabDataUpdates.delete(key) }
  })
}

function mutateTabData(tab, change, afterChange) {
  return queueTabData(tab, async key => {
    const liveTab = await new Promise(resolve => {
      chrome.tabs.get(tab.id, result => {
        resolve(chrome.runtime.lastError ? null : result)
      })
    })
    if (!liveTab || liveTab.windowId !== tab.windowId ||
      (tab.url && liveTab.url && tab.url !== liveTab.url)) { return }
    const data = (await chrome.storage.session.get(key))[key] || {}
    const result = change(data)
    if (result !== false) { await chrome.storage.session.set({ [key]: data }) }
    if (afterChange) { afterChange(data) }
  })
}

function saveTabData(tab, data) {
  return mutateTabData(tab, previous => Object.assign(previous, data))
}

function clearTabData(tab, afterChange) {
  return queueTabData(tab, async key => {
    await chrome.storage.session.remove(key)
    if (afterChange) { afterChange() }
  })
}

async function readTabData(tab) {
  const id = getTabKey(tab)
  if (!id) { return }
  const key = 'tab_' + id
  await tabDataUpdates.get(key)?.catch(() => {})
  return (await chrome.storage.session.get(key))[key]
}

/* * * Toolbar icon functions * * */

/**
 * Return true if version has 4 numbers, which means it's a development build not for release.
 */
function isDevVersion() {
  return gVersion?.split('.').length === 4
}

/**
 * Return true if toolbar badge position is along top of icon, false or undefined if along bottom.
 */
function isBadgeOnTop() {
  // TODO: check other browsers
  const badgeOnTop = { firefox: true, safari: true, chrome: false, edge: false }
  return badgeOnTop[gBrowser]
}

/* * * Wayback functions * * */

/**
 * Convert given int to a string with metric suffix, separators localized.
 * Used for toolbar button badge.
 * @param count {int}
 * @return {string}
 */
function badgeCountText(count) {
  let text = ''
  if (count < 1000) {
    text = count.toLocaleString()
  } else if (count < 10000) {
    text = (Math.round(count / 100) / 10.0).toLocaleString() + 'K'
  } else if (count < 1000000) {
    text = Math.round(count / 1000).toLocaleString() + 'K'
  } else if (count >= 1000000) {
    text = Math.round(count / 1000000).toLocaleString() + 'M'
  }
  return text
}

/**
 * Retrieves total count of snapshots stored in the Wayback Machine for given url.
 * Includes first and last timestamp.
 * @param url {string}
 * @return Promise
 * onSuccess is an object { "total": int, "first_ts": string, "last_ts": string }
 * onFail is an Error object or null.
 */
async function fetchWithTimeout(url, options = {}, read = response => response.json(), timeout = 10000) {
  const { signal, ...request } = options
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) { abort() }
  signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, timeout)
  try {
    const response = await fetch(url, { headers: hostHeaders, ...request, signal: controller.signal })
    return await read(response)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

function getWaybackSparkline(url, signal) {
  if (!isNotExcludedUrl(url)) { return Promise.reject(new Error('Unsupported URL')) }
  const requestUrl = hostURL + '__wb/sparkline?collection=web&output=json&url=' + fixedEncodeURIComponent(url)
  return fetchWithTimeout(requestUrl, { signal, credentials: 'omit' }, async response => {
    if (!response.ok) { throw new Error('Wayback sparkline HTTP ' + response.status) }
    const json = await response.json()
    if (json?.error?.type === 'blocked') { return { total: -1 } }
    if (!isObject(json?.years) || json.error) { throw new Error('Invalid Wayback count response') }
    const counts = Object.values(json.years).flat()
    if (!counts.every(count => Number.isInteger(count) && count >= 0)) {
      throw new Error('Invalid Wayback capture counts')
    }
    return {
      total: counts.reduce((sum, count) => sum + count, 0),
      first_ts: json.first_ts,
      last_ts: json.last_ts
    }
  })
}

function getWaybackCount(url, onSuccess, onFail) {
  return getWaybackSparkline(url).then(onSuccess).catch(error => {
    console.warn('Could not get Wayback count', error)
    if (onFail) { onFail(error) }
  })
}

/**
 * Checks Wayback Machine API for url snapshot
 */
function wmAvailabilityCheck(url, onsuccess, onfail) {
  const requestUrl = hostURL + 'wayback/available?url=' + fixedEncodeURIComponent(url)
  fetchWithTimeout(requestUrl)
  .then((json) => {
    let wayback_url = getWaybackUrlFromResponse(json)
    let timestamp = getWaybackTimestampFromResponse(json)
    if (wayback_url !== null) {
      onsuccess(wayback_url, url, timestamp)
    } else if (onfail) {
      onfail()
    }
  })
  .catch((err) => {
    // catch the error in case of api failure
    console.log('wmAvailabilityCheck ERROR: ', err)
  })
}

/**
 * Checks that url isn't an archive.org domain.
 * @param url {string}
 * @return {bool}
 */
function isArchiveUrl(url) {
  if (typeof url !== 'string') { return false }
  try {
    const hostname = new URL(url).hostname
    return (hostname === 'web.archive.org')
  } catch (e) {
    // url not formated correctly
    return false
  }
}

/**
 * Makes sure response is a valid URL to prevent code injection
 * @param url {string}
 * @return {bool}
 */
function parseWebUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) { return null }
  try {
    return new URL(value)
  } catch (error) {
    return null
  }
}

function isValidUrl(url) {
  return parseWebUrl(url) !== null
}

/**
 * Returns a URL, adding 'https' if schema part missing, else null.
 * @param url {string}
 * @return {string} or null
 */
function makeValidURL(url) {
  return isValidUrl(url) ? url : (url.includes('.') ? 'https://' + url : null)
}

// Returns substring of URL after :// not including "www." if present.
// Also crops trailing slash.
// Returns null if match not found, or if url is not a string.
function cropPrefix(url) {
  if (typeof url === 'string') {
    if (url.slice(-1) === '/') { url = url.slice(0, -1) }
    let re = /^(?:[a-z]+:\/\/)?(?:www\.)?(.*)$/
    let match = re.exec(url)
    return match[1]
  }
  return null
}

// Returns substring of url after :// only, or null if url is not a string.
function cropScheme(url) {
  if (typeof url === 'string') {
    let re = /^(?:[a-z]+:\/\/)?(.*)$/
    let match = re.exec(url)
    return match[1]
  }
  return null
}

// Classify the URL literal locally. DNS names may still resolve to private addresses.
function isNotExcludedUrl(url) {
  const parsed = parseWebUrl(url)
  if (!parsed || parsed.username || parsed.password) { return false }
  const host = parsed.hostname.replace(/\.$/, '')
  if (host.startsWith('[')) {
    // Accept global unicast only, excluding transition, protocol and documentation blocks.
    const [first, second] = host.slice(1, -1).split(':').map(part => parseInt(part || '0', 16))
    return first >= 0x2000 && first <= 0x3fff &&
      !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) &&
      first !== 0x2002 && first !== 0x3fff
  }

  if (/^\d+(?:\.\d+){3}$/.test(host)) {
    // URL normalizes alternate IPv4 representations before this check.
    const [a, b, c] = host.split('.').map(Number)
    return a !== 0 && a !== 10 && a !== 127 && a < 224 &&
      !(a === 100 && b >= 64 && b <= 127) &&
      !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) &&
      !(a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) ||
        (b === 88 && c === 99))) &&
      !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) &&
      !(a === 203 && b === 0 && c === 113)
  }

  return host.includes('.') && !/\.(?:localhost|local|internal|lan|home|corp|onion|test|invalid|example|localdomain)$/.test(host) &&
    !host.endsWith('.home.arpa')
}

function remove_port(url) {
  if (url.substr(-4) === ':80/') {
    url = url.substring(0, url.length - 4)
  }
  return url
}

function remove_wbm(url) {
  let pos = url.indexOf('/http')
  let new_url = ''
  if (pos !== -1) {
    new_url = url.substring(pos + 1)
  } else {
    pos = url.indexOf('/www')
    new_url = url.substring(pos + 1)
  }
  return remove_port(new_url)
}

/**
* Extracts URL from web.archive.org or extension page, otherwise the url passed in.
* @param url {string}
* @return {string}
*/
function getCleanUrl(url) {
  let rurl = url || ''
  if (rurl.includes('extension:')) {
    // return url param from extension page
    const url_param = new URL(url)
    rurl = url_param.searchParams.get('url')
  } else if (rurl.includes('web.archive.org')) {
    // return url from archive.org page
    rurl = remove_wbm(url)
  }
  return rurl
}

/**
 * Extracts the latest saved Wayback URL from wmAvailabilityCheck() response.
 * @param json {object}
 * @return {string or null}
 */
function getWaybackUrlFromResponse(json) {
  const url = json?.archived_snapshots?.closest?.url
  const status = json?.archived_snapshots?.closest?.status
  const available = json?.archived_snapshots?.closest?.available

  if (!available || !status?.startsWith('2') || !isValidUrl(url)) {
    return null
  }

  // Preserve https preference if needed
  return url.replace(/^http:/, 'https:')
}

/**
 * Extracts latest saved timestamp from wmAvailabilityCheck() response.
 * @param json {object}
 * @return {string or null} as "yyyyMMddHHmmss"
 */
function getWaybackTimestampFromResponse(json) {
  const closest = json?.archived_snapshots?.closest
  if (!closest?.available || !closest.status?.startsWith('2') || !isValidUrl(closest.url)) {
    return null
  }
  return closest.timestamp
}

/**
 * Converts a Wayback timestamp string into a Date object.
 * @param timestamp {string} as "yyyyMMddHHmmss" in UTC time zone.
 * @return {Date or null}
 */
function timestampToDate(timestamp) {
  let date = null
  if (timestamp?.length >= 4) {
    date = new Date(Date.UTC(
      Number(timestamp.substring(0, 4)), // year
      (Number(timestamp.substring(4, 6)) || 1) - 1, // month
      (Number(timestamp.substring(6, 8)) || 1), // day
      Number(timestamp.substring(8, 10)), // hours
      Number(timestamp.substring(10, 12)), // min
      Number(timestamp.substring(12, 14)) // sec
    ))
    if (isNaN(date)) { return null }
  }
  return date
}

/**
 * Converts a Date object into a Wayback timestamp string.
 * @param {Date}
 * @return timestamp {string} as "yyyyMMddHHmmss" in UTC time zone, or null.
 */
function dateToTimestamp(date) {
  let timestamp = null
  function pad(num) {
    return (num < 10) ? ('0' + num) : ('' + num)
  }
  if (date instanceof Date) {
    let yyyy = date.getUTCFullYear()
    let MM = date.getUTCMonth() + 1
    let dd = date.getUTCDate()
    let HH = date.getUTCHours()
    let mm = date.getUTCMinutes()
    let ss = date.getUTCSeconds()
    timestamp = yyyy + pad(MM) + pad(dd) + pad(HH) + pad(mm) + pad(ss)
  }
  return timestamp
}

/**
 * Return localized date string, or time if within last 24 hours.
 * @param timestamp {string} as "yyyyMMddHHmmss" in UTC time zone.
 * @return string or ''
 */
function viewableTimestamp(timestamp) {
  let date = timestampToDate(timestamp)
  let text = ''
  if (date) {
    if ((Date.now() - date.getTime()) > 86400000) {
      // over 24 hours
      text = date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) // e.g.'Mar 5, 2021'
    } else {
      // under 24 hours
      text = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) // e.g.'7:00 PM'
    }
  }
  return text
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Match literal segments in order. Stars can match zero or more characters.
function matchWildcard(text, pattern) {
  if (typeof text !== 'string' || typeof pattern !== 'string') { return false }
  text = text.toLowerCase()
  const parts = pattern.toLowerCase().split('*')
  const first = parts.shift()
  if (!parts.length) { return text === first }
  const last = parts.pop()
  if (!text.startsWith(first) || !text.endsWith(last)) { return false }

  let cursor = first.length
  const end = text.length - last.length
  if (cursor > end) { return false }
  for (const part of parts) {
    if (!part) { continue }
    const index = text.indexOf(part, cursor)
    if (index < 0 || index + part.length > end) { return false }
    cursor = index + part.length
  }
  return true
}

function normalizeExcludePattern(pattern) {
  if (typeof pattern !== 'string') { return '' }
  return cropPrefix(pattern.trim().toLowerCase())
}

function isUrlInList(url, patterns) {
  if (typeof url !== 'string' || !Array.isArray(patterns)) { return false }
  const parsed = parseWebUrl(url)
  const candidate = parsed
    ? cropPrefix((parsed.hostname.replace(/\.$/, '') + (parsed.port ? ':' + parsed.port : '') +
      parsed.pathname + parsed.search + parsed.hash).toLowerCase())
    : cropPrefix(url.toLowerCase())
  return patterns.some(pattern => {
    const normalized = normalizeExcludePattern(pattern)
    if (!normalized) { return false }
    if (normalized === '*.discord.com/api/webhooks/*') {
      return /^(?:[^/:]+\.)?discord\.com(?::\d+)?\/api\/webhooks(?:\/|$)/.test(candidate)
    }
    if (normalized === '*.proton.me*') {
      return /^(?:[^/:]+\.)?proton\.me(?=[:/?#]|$)/.test(candidate)
    }
    return matchWildcard(candidate, normalized)
  })
}

/**
 * Customizes error handling
 * @param status {string}
 * @return {string}
 */
function getErrorMessage(req) {
  return 'The requested service ' + req.url + ' failed: ' + req.status + ', ' + req.statusText
}

function getUrlByParameter(name) {
  const url = new URL(window.location.href)
  return url.searchParams.get(name)
}

function openByWindowSetting(url, op = null, cb) {
  if (op === null) {
    chrome.storage.local.get(['view_setting'], (settings) => {
      checkLastError()
      if (settings) { // OK if view_setting undefined
        opener(url, settings.view_setting, cb)
      }
    })
  } else {
    opener(url, op, cb)
  }
}

function opener(url, option, callback) {
  if (option === 'tab' || option === undefined) {
    chrome.tabs.create({ url }, (tab) => {
      if (callback) { callback(tab.id) }
    })
  } else if (option === 'replace') {
    // Back button may not work due to a bug in Chrome, but works fine in Firefox.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs?.[0]) {
        chrome.tabs.update(tabs[0].id, { active: true, url }, (tab) => {
          if (callback) { callback(tab.id) }
        })
      }
    })
  } else {
    chrome.windows.getCurrent({ populate: true }, (window) => {
      // Access window properties
      let w = window?.width;
      let h = window?.height;
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
        chrome.windows.create({ url, type: 'popup' }, (created) => {
          if (callback && created?.tabs?.[0]) { callback(created.tabs[0].id) }
        })
        return
      }
      if (w > h) {
        // landscape screen
        const maxW = 1200
        w = Math.floor(((w > maxW) ? maxW : w) * 0.666)
        h = Math.floor(w * 0.75)
      } else { // option === 'window'
        // portrait screen (likely mobile)
        w = Math.floor(w * 0.9)
        h = Math.floor(h * 0.9)
      }
      chrome.windows.create({ url: url, width: w, height: h, type: 'popup' }, (window) => {
        if (callback && window?.tabs?.[0]) { callback(window.tabs[0].id) }
      })
    });
  }
}

// Displays a notification by the OS.
// Unless Disable Notificaions setting is true.
// Safari doesn't support notifications so this will do nothing.
//
function notifyMsg(msg, callback) {
  if (chrome.notifications) {
    chrome.storage.local.get(['notify_setting'], (settings) => {
      if (settings && !settings.notify_setting) {
        const options = {
          type: 'basic',
          title: 'Wayback Machine',
          message: msg,
          iconUrl: chrome.runtime.getURL('images/app-icon/app-icon96.png')
        }
        chrome.notifications.create(options, callback)
      }
    })
  }
}

// Pop up an alert message.
//   Chrome & Edge: Popup alert modal.
//   Firefox: Errors on alert(), so show notification instead.
//   Safari: Ignores alert()
//
function alertMsg(msg) {
  if (isFirefox) { notifyMsg(msg) } else { alert(msg) }
}

function checkLastError() {
  if (chrome.runtime.lastError) {
    if (chrome.runtime.lastError.message.startsWith('No tab with id:')) {
      // Skip
    } else {
      console.log('checkLastError: ', chrome.runtime.lastError.message)
      // console.trace() // uncomment while debugging
    }
  } else {
    // No error occurred
  }
}

function attachTooltip (anchor, tooltip, pos = 'right', time = 200) {
  // Modified code from https://embed.plnkr.co/plunk/HLqrJ6 to get tooltip to stay
  // Note: Bootstrap 5 changed data-toggle to data-bs-toggle, but jQuery plugin API still works
  return anchor.attr({
    'data-bs-toggle': 'tooltip',
    'title': tooltip
  })
  .tooltip({
    // animated option removed in Bootstrap 5, but jQuery plugin API should handle it
    placement: pos,
    html: true,
    trigger: 'manual'
  })
  // Handles staying open
  .on('mouseenter click', () => {
    $(anchor).tooltip('show')
    $('.popup_box').off('mouseleave.waybackTooltip').one('mouseleave.waybackTooltip', () => {
      setTimeout(() => {
        if (!$(`.${anchor.attr('class')}[href*="${anchor.attr('href')}"]:hover`).length) {
          $(anchor).tooltip('hide')
        }
      }, time)
    })
  })
  .on('mouseleave blur', () => {
    setTimeout(() => {
      if (!$('.popup_box:hover').length) {
        $(anchor).tooltip('hide')
      }
    }, time)
  })
}

// Saves the defaultAutoExcludeList[] to storage if 'auto_exclude_list' hasn't been set.
function initAutoExcludeList() {
  chrome.storage.local.get(['auto_exclude_list'], (items) => {
    if (('auto_exclude_list' in items) === false) {
      chrome.storage.local.set({ 'auto_exclude_list': defaultAutoExcludeList })
    }
  })
}

function setupContextMenus(enabled) {
  chrome.contextMenus.removeAll(() => {
    if (enabled) {
      chrome.contextMenus.create({
        'id': 'save',
        'title': 'Save Page Now',
        'contexts': ['page', 'frame', 'link'],
        'documentUrlPatterns': ['*://*/*', 'ftp://*/*']
      }, checkLastError)
      chrome.contextMenus.create({
        'id': 'first',
        'title': 'Oldest Version',
        'contexts': ['page', 'frame', 'link'],
        'documentUrlPatterns': ['*://*/*', 'ftp://*/*']
      }, checkLastError)
      chrome.contextMenus.create({
        'id': 'recent',
        'title': 'Newest Version',
        'contexts': ['page', 'frame', 'link'],
        'documentUrlPatterns': ['*://*/*', 'ftp://*/*']
      }, checkLastError)
      chrome.contextMenus.create({
        'id': 'all',
        'title': 'All Versions',
        'contexts': ['page', 'frame', 'link'],
        'documentUrlPatterns': ['*://*/*', 'ftp://*/*']
      }, checkLastError)
    } else {
      chrome.contextMenus.create({
        'id': 'welcome',
        'title': 'Welcome to the Wayback Machine',
        'contexts': ['page', 'frame', 'link'],
        'documentUrlPatterns': ['*://*/*', 'ftp://*/*']
      }, checkLastError)
    }
  })
}

// Default Settings prior to accepting terms.
function initDefaultOptions () {
  chrome.storage.local.set({
    agreement: false, // needed for firefox
    spn_outlinks: false,
    spn_screenshot: false,
    selectedFeature: null,
    /* Features */
    private_mode_setting: true,
    not_found_setting: false,
    embed_popup_setting: false,
    wm_count_setting: false,
    wiki_setting: false,
    amazon_setting: false,
    tvnews_setting: false,
    auto_archive_setting: false,
    auto_archive_age: '99999',
    fact_check_setting: false,
    /* General */
    resource_list_setting: false,
    email_results_setting: false,
    my_archive_setting: false,
    view_setting: 'tab',
    show_settings_tab_tip: true
  })
}

// Turn on these Settings and toolbar popup after accepting terms.
function afterAcceptTerms () {
  chrome.storage.local.set({
    agreement: true,
    private_mode_setting: false,
    not_found_setting: true
  })
  chrome.action.setPopup({ popup: chrome.runtime.getURL('index.html') }, checkLastError)
  setupContextMenus(true)
}

if (typeof module !== 'undefined') {
  module.exports = {
    isArray,
    isObject,
    getErrorMessage,
    getUrlByParameter,
    getWaybackUrlFromResponse,
    isArchiveUrl,
    isValidUrl,
    isUrlInList,
    normalizeExcludePattern,
    matchWildcard,
    makeValidURL,
    cropPrefix,
    cropScheme,
    isNotExcludedUrl,
    getCleanUrl,
    wmAvailabilityCheck,
    openByWindowSetting,
    sleep,
    notifyMsg,
    alertMsg,
    attachTooltip,
    getUserInfo,
    checkAuthentication,
    getTabKey,
    saveTabData,
    clearTabData,
    mutateTabData,
    readTabData,
    getWaybackCount,
    getWaybackSparkline,
    fetchWithTimeout,
    badgeCountText,
    isBadgeOnTop,
    isDevVersion,
    isChrome,
    isFirefox,
    isEdge,
    isSafari,
    hostURL,
    hostHeaders,
    getCustomUserAgent,
    gCustomUserAgent,
    timestampToDate,
    dateToTimestamp,
    viewableTimestamp,
    initAutoExcludeList,
    initDefaultOptions,
    afterAcceptTerms,
    feedbackURL,
    newshosts,
    fixedEncodeURIComponent,
    isInTestEnv,
    checkLastError
  }
}
