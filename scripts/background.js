// background.js
//
// License: AGPL-3
// Copyright 2016-2020, Internet Archive

if (typeof importScripts === 'function') {
  importScripts('utils.js')
}

// from 'utils.js'
/*   global isNotExcludedUrl, getCleanUrl, isArchiveUrl, isValidUrl, notifyMsg, openByWindowSetting, sleep, wmAvailabilityCheck, hostURL, fetchWithTimeout */
/*   global initDefaultOptions, badgeCountText, getWaybackCount, newshosts, dateToTimestamp, fixedEncodeURIComponent, checkLastError */
/*   global hostHeaders, timestampToDate, isBadgeOnTop, isUrlInList, defaultAutoExcludeList, saveTabData, clearTabData, mutateTabData, readTabData, initAutoExcludeList */
/*   global isDevVersion, checkAuthentication, setupContextMenus, cropPrefix, alertMsg */

let globalAPICache = new Map()
const API_CACHE_SIZE = 5
const API_LOADING = 'LOADING'
const API_TIMEOUT = 10000
const API_RETRY = 1000
const SPN_RETRY = 6000
const spnJobPrefix = 'spn_job_'
const activeSpnJobs = new Set()
let tabIdPromise

// not required because in manifest v3, we use different subdomain of hostURLs for different browsers
// updates User-Agent header in Chrome & Firefox, but not in Safari
// function rewriteUserAgentHeader(e) {
//   for (let header of e.requestHeaders) {
//     if (header.name.toLowerCase() === 'user-agent') {
//       const customUA = gCustomUserAgent
//       const statusUA = 'Status-code/' + gStatusCode
//       // add customUA only if not yet present in user-agent
//       header.value += ((header.value.indexOf(customUA) === -1) ? ' ' + customUA : '') + (gStatusCode ? ' ' + statusUA : '')
//     }
//   }
//   return { requestHeaders: e.requestHeaders }
// }

/* * * API Calls * * */

// First checks for login state before calling savePageNow()
//
function savePageNowChecked(atab, pageUrl, silent, options) {
  checkAuthentication((results) => {
    savePageNow(atab, pageUrl, silent, options, results?.auth_check || false)
  })
}

let autoSaveActivityWrites = Promise.resolve()

function queueAutoSaveActivity(update) {
  const pending = autoSaveActivityWrites.then(update)
  autoSaveActivityWrites = pending.catch(error => console.warn('Auto-save activity update failed', error))
  return pending
}

function recordAutoSaveActivity(silent, url, outcome) {
  if (!silent || !isNotExcludedUrl(url)) { return }
  const site = new URL(url).origin
  queueAutoSaveActivity(async () => {
    const settings = await chrome.storage.local.get([
      'auto_save_activity_enabled', 'auto_save_activity', 'private_mode_setting'
    ])
    if (settings?.auto_save_activity_enabled !== true || settings.private_mode_setting !== false) { return }
    const entries = Array.isArray(settings.auto_save_activity) ? settings.auto_save_activity : []
    const entry = { site, outcome, at: new Date().toISOString() }
    await chrome.storage.local.set({ auto_save_activity: [entry, ...entries].slice(0, 50) })
  })
}

/**
 * Calls Save Page Now API.
 * If response OK, calls SPN Status API after a delay.
 * @param atab {Tab}: Current tab used to update toolbar icon.
 * @param pageUrl {string}: URL to save.
 * @param silent {bool}: if false, include notify popup if supported by browser/OS, and open Resource List window if setting is on.
 * @param options {Object}: key/value pairs to send in POST data. See SPN API spec.
 */
function savePageNow(atab, pageUrl, silent = false, options = {}, loggedInFlag = true) {

  if (!(isValidUrl(pageUrl) && isNotExcludedUrl(pageUrl))) {
    console.log('savePageNow URL excluded')
    return
  }

  // setup api
  const postData = new URLSearchParams(options)
  postData.set('url', pageUrl)
  // const queryParams = '?url=' + fixedEncodeURIComponent(pageUrl) // log URL only
  const queryParams = '?' + postData.toString() // log URL + all options
  let headers = new Headers(hostHeaders)
  headers.set('Content-Type', 'application/x-www-form-urlencoded')
  if (!loggedInFlag) {
    headers.set('Accept', 'text/html,application/xhtml+xml,application/xml') // required when logged-out
  } // else Accept: application/json
  fetchWithTimeout(hostURL + 'save/' + queryParams, {
    credentials: 'include',
    method: 'POST',
    body: postData,
    headers
  }, response => loggedInFlag ? response.json() : response.text(), API_TIMEOUT)
    .then(async (data) => {
      // get response info
      const errMsg = (loggedInFlag && data?.message) || 'Please Try Again'
      const jobId = loggedInFlag ? data?.job_id : extractJobIdFromHTML(data)
      // notifications depending on status
      if (jobId) {
        const recentlySaved = errMsg.includes('same snapshot')
        recordAutoSaveActivity(silent, pageUrl, recentlySaved ? 'Already saved' : 'Accepted by Wayback')
        if (recentlySaved) {
          // snapshot already archived within timeframe
          chrome.runtime.sendMessage({ message: 'save_archived', error: errMsg, url: pageUrl, atab }, checkLastError)
          if (!silent) { notifyMsg(errMsg) }
        }
        else if (errMsg.includes('capture will start')) {
          chrome.runtime.sendMessage({ message: 'slow_archive_msg', error: errMsg, url: pageUrl, atab }, checkLastError)
          if (!silent) { notifyMsg(errMsg) }
        } else {
          // update UI
          await addToolbarState(atab, 'S')
          updateWaybackCountBadge(atab, null)
          chrome.runtime.sendMessage({ message: 'save_start', atab, url: pageUrl }, checkLastError)
          // show resources during save
          if (!silent) {
            notifyMsg('Saving ' + pageUrl)
            chrome.storage.local.get(['resource_list_setting'], (settings) => {
              if (settings?.resource_list_setting) {
                const resource_list_url = chrome.runtime.getURL('resource-list.html') + '?url=' + pageUrl + '&job_id=' + jobId + '#not_refreshed'
                openByWindowSetting(resource_list_url, 'windows')
              }
            })
          }
        }
        if (!recentlySaved) {
          const started = Date.now()
          savePageStatus({
            id: String(jobId), atab, pageUrl, silent, attempt: 0,
            nextCheckAt: started + SPN_RETRY, deadline: started + 5 * 60 * 1000
          })
        }
      } else {
        // missing jobId error
        recordAutoSaveActivity(silent, pageUrl, 'Submission unconfirmed')
        chrome.runtime.sendMessage({ message: 'save_error', error: errMsg, url: pageUrl, atab }, checkLastError)
        if (!silent) { notifyMsg('Error: ' + errMsg) }
      }
    })
    .catch((err) => {
      // http error
      recordAutoSaveActivity(silent, pageUrl, 'Submission unconfirmed')
      console.log(err)
      chrome.runtime.sendMessage({ message: 'save_error', error: 'Save Error', url: pageUrl, atab }, checkLastError)
    })
}

// Parse HTML text and return job id string. Returns null if not found.
//
function extractJobIdFromHTML(html) {
  // match the spn id pattern
  const jobRegex = /spn2-[a-z0-9-]*/g
  const jobIds = html.match(jobRegex)
  return jobIds?.[0] || null;
}

/**
 * Calls SPN Status API.
 * If 'pending' status response, recursevely calls itself after a delay.
 * @param atab {Tab}: Current tab used to update toolbar icon.
 * @param pageUrl {string}: URL to save.
 * @param silent {bool}: to pass to statusSuccess() or statusFailed().
 * @param jobId {string}: job_id returned by SPN response, passed to Status API.
 */
function resumeSaveJobs(reconcile = false) {
  chrome.storage.session.get(null).then(entries => {
    if (reconcile) {
      reconcileTabData(entries).catch(error => console.warn('Could not reconcile tab data', error))
    }
    for (const [key, job] of Object.entries(entries)) {
      if (key.startsWith(spnJobPrefix) && job?.id && typeof job.nextCheckAt === 'number') {
        savePageStatus(job)
      }
    }
  }).catch(error => console.warn('Could not resume Wayback jobs', error))
}

async function savePageStatus(job) {
  const { id, atab, pageUrl, silent, deadline } = job
  if (activeSpnJobs.has(id)) { return }
  activeSpnJobs.add(id)
  const key = spnJobPrefix + id
  const headers = new Headers(hostHeaders)
  headers.set('Accept', 'text/html,application/xhtml+xml,application/xml')
  try {
    while (job.attempt < 30 && job.nextCheckAt < deadline && Date.now() < deadline) {
      await chrome.storage.session.set({ [key]: job }).catch(error => console.warn('Could not retain Wayback job', error))
      await sleep(Math.max(0, job.nextCheckAt - Date.now()))
      if (Date.now() >= deadline) { break }
      if (silent) {
        const settings = await chrome.storage.local.get(['private_mode_setting'])
        if (settings.private_mode_setting !== false) {
          await statusFailed(atab, pageUrl, silent, { message: 'Capture status checks stopped because Private Mode is on' })
          return
        }
      }
      job.attempt++
      let delay = SPN_RETRY
      let result
      try {
        result = await fetchWithTimeout(hostURL + 'save/status/' + encodeURIComponent(id), {
          credentials: 'include',
          headers
        }, async response => {
          const retry = response.headers.get('Retry-After')
          if (retry) {
            const milliseconds = /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()
            if (Number.isFinite(milliseconds)) { delay = Math.max(SPN_RETRY, Math.min(milliseconds, 60000)) }
          }
          if (response.status === 429 || response.status >= 500) {
            await response.body?.cancel()
            return null
          }
          return response.json()
        }, API_TIMEOUT)
      } catch (error) {
        console.warn('SPN status request failed', error)
      }
      job.nextCheckAt = Date.now() + delay
      if (result) {
        chrome.runtime.sendMessage({ message: 'resource_list_show', data: result, url: pageUrl }, checkLastError)
        if (result.status === 'success') { return await statusSuccess(atab, pageUrl, silent, result) }
        if (result.status !== 'pending') { return await statusFailed(atab, pageUrl, silent, result) }
      }
    }
    await statusFailed(atab, pageUrl, silent, { message: 'Capture status timed out. Check Wayback before submitting again.' })
  } catch (error) {
    await statusFailed(atab, pageUrl, silent, null, error)
  } finally {
    await chrome.storage.session.remove(key).catch(error => console.warn('Could not clear completed Wayback job', error))
    activeSpnJobs.delete(id)
  }
}

/**
 * Call this to update UI, including toolbar icon, after SPN Status returns success.
 * @param atab {Tab}: Current tab used to update toolbar icon.
 * @param pageUrl {string}: URL saved.
 * @param silent {bool}: set false to include notify popup.
 * @param data {Object}: Response data from Status API.
 */
async function statusSuccess(atab, pageUrl, silent, data) {
  recordAutoSaveActivity(silent, pageUrl, 'Saved')

  // update UI
  await removeToolbarState(atab, 'S')
  await addToolbarState(atab, 'check')
  incrementCount(data.original_url, data.timestamp)
  updateWaybackCountBadge(atab, data.original_url)
  chrome.runtime.sendMessage({
    message: 'save_success',
    timestamp: data.timestamp,
    atab,
    url: pageUrl
  }, checkLastError)

  // notify
  if (!silent && data?.timestamp) {
    // since not silent, saves to My Web Archive only if SPN explicitly clicked and turned on
    checkSaveToMyWebArchive(pageUrl, data.timestamp)
    // replace message if present in result
    let msg = 'Successfully saved! Click to view snapshot.'
    if (data?.message?.length > 0) {
      msg = data.message
    }
    notifyMsg(msg, (notificationId) => {
      chrome?.notifications?.onClicked.addListener((newNotificationId) => {
        if (notificationId === newNotificationId) {
          openByWindowSetting('https://web.archive.org/web/' + data.timestamp + '/' + data.original_url)
        }
      })
    })
  }
}

/**
 * Call this to update UI, including toolbar icon, after SPN Status fails.
 * @param atab {Tab}: Current tab used to update toolbar icon.
 * @param pageUrl {string}: URL saved.
 * @param silent {bool}: set false to include notify popup.
 * @param data {Object}: Response data from Status API. (optional)
 * @param err {Error}: Error from a catch block. (optional)
 */
async function statusFailed(atab, pageUrl, silent, data, err) {
  recordAutoSaveActivity(silent, pageUrl, 'Capture unconfirmed')

  await removeToolbarState(atab, 'S')
  if (err) {
    chrome.runtime.sendMessage({
      message: 'resource_list_show_error',
      url: pageUrl,
      data: err
    }, checkLastError)
  }
  const message = data?.message || 'Could not confirm capture status'
  chrome.runtime.sendMessage({
    message: 'save_error',
    error: message,
    url: pageUrl,
    atab
  }, checkLastError)
  if (!silent) { notifyMsg('Error: ' + message) }
}

/**
 * Saves URL to user's My Web Archive list.
 * This assumes user is logged in with cookies set, and params are valid.
 * @param url {string}: Original URL to save.
 * @param timestamp {string}: Wayback timestamp as "yyyyMMddHHmmss" in UTC.
 * @return Promise: which should return this JSON on success: { "success": true }
 */
function saveToMyWebArchive(url, timestamp) {

  const postData = { url, 'snapshot': timestamp, 'tags': [] }
  const headers = new Headers(hostHeaders)
  headers.set('Content-Type', 'application/json')
  return fetchWithTimeout(hostURL + '__wb/web-archive', {
    method: 'POST',
    body: JSON.stringify(postData),
    headers
  }, undefined, API_TIMEOUT)
}

/**
 * Encapsulate fetching a url with a timeout promise object.
 * @param url {string}
 * @param onSuccess(json): json = root object from API call.
 * @param onFail(error): error = Error object or null.
 * @param postData {object}: if present, uses POST instead of GET and sends postData object converted to json.
 * @return Promise
 */
function fetchAPI(url, onSuccess, onFail, postData = null) {

  const headers = new Headers(hostHeaders)
  headers.set('backend', 'nomad')
  headers.set('Content-Type', 'application/json')
  return fetchWithTimeout(url, {
    method: postData ? 'POST' : 'GET',
    body: postData ? JSON.stringify(postData) : null,
    headers
  }, undefined, API_TIMEOUT)
    .then(data => {
      if (data) {
        onSuccess(data)
      } else {
        if (onFail) { onFail(null) }
      }
    })
    .catch(error => {
      if (onFail) { onFail(error) }
    })
}

/**
 * Returns cached API call, or fetches url if not in cache.
 * @param url {string}
 * @param onSuccess(json): json = root object from API call.
 * @param onFail(error): error = Error object or null.
 * @param postData {object}: uses POST if present.
 * @return Promise if calls API, json data if in cache, null if loading in progress.
 */
function fetchCachedAPI(url, onSuccess, onFail, postData = null) {
  if (typeof globalAPICache === 'undefined') { globalAPICache = new Map() }
  let data = globalAPICache.get(url)
  if (data === API_LOADING) {
    // re-call after delay if previous fetch hadn't returned yet
    setTimeout(() => {
      fetchCachedAPI(url, onSuccess, onFail, postData)
    }, API_RETRY)
    return null
  } else if (data !== undefined) {
    onSuccess(data)
    return data
  } else {
    // if cache full, remove first object which is the oldest from the cache
    if (globalAPICache.size >= API_CACHE_SIZE) {
      globalAPICache.delete(globalAPICache.keys().next().value)
    }
    globalAPICache.set(url, API_LOADING)
    return fetchAPI(url, (json) => {
      globalAPICache.set(url, json)
      onSuccess(json)
    }, (error) => {
      globalAPICache.delete(url)
      onFail(error)
    }, postData)
  }
}

/**
 * The books API uses both GET, and POST with isbns array as the body.
 * @param url {string}: Must include '?url=' as entire url is used as cache key.
 * @param onSuccess(json): json = root object from API call.
 * @param onFail(error): error = Error object or null.
 * @param isbns: (optional) array of isbn strings.
 */
function getCachedBooks(url, onSuccess, onFail, isbns = null) {
  const requestUrl = hostURL + 'services/context/books?url=' + fixedEncodeURIComponent(url)
  if (isbns) {
    fetchCachedAPI(requestUrl, onSuccess, onFail, { isbns })
  } else {
    fetchCachedAPI(requestUrl, onSuccess, onFail)
  }
}

function getCachedPapers(url, onSuccess, onFail) {
  const requestUrl = hostURL + 'services/context/papers?url=' + fixedEncodeURIComponent(url)
  fetchCachedAPI(requestUrl, onSuccess, onFail)
}

function getCachedTvNews(url, onSuccess, onFail) {
  const requestUrl = hostURL + 'services/context/tvnews?url=' + fixedEncodeURIComponent(url)
  fetchCachedAPI(requestUrl, onSuccess, onFail)
}

function getCachedFactCheck(url, onSuccess, onFail) {
  const requestUrl = hostURL + 'services/context/notices?url=' + fixedEncodeURIComponent(url)
  fetchCachedAPI(requestUrl, onSuccess, onFail)
}

/* * * Startup related * * */

// Setup toolbar button action.
chrome.storage.local.get({ agreement: false }, (settings) => {
  if (settings?.agreement) {
    chrome.action.setPopup({ popup: chrome.runtime.getURL('index.html') }, checkLastError)
    setupContextMenus(true)
  } else {
    setupContextMenus(false)
  }
})

// Runs whenever extension starts up, except during incognito mode.
chrome.runtime.onStartup.addListener((details) => {

})

// Runs when extension first installed or updated, or browser updated.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    initDefaultOptions()
    initAutoExcludeList()
  }
})

// Opens Welcome page on toolbar click if terms not yet accepted.
chrome.action.onClicked.addListener((tab) => {
  chrome.storage.local.get({ agreement: false }, (settings) => {
    if (settings?.agreement === false) {
      openByWindowSetting(chrome.runtime.getURL('welcome.html'), 'tab')
    }
  })
})

// chrome.webRequest.onBeforeSendHeaders is not supported in manifest v3 and currently we are not looking to rewrite the user-agent
// as we already use diffent host-names for different browsers

// chrome.webRequest.onBeforeSendHeaders.addListener(
//   rewriteUserAgentHeader,
//   { urls: [hostURL + '*'] },
//   ['blocking', 'requestHeaders'] // FIXME: not supported in Safari
// )

// Checks for error in page loading such as when a domain doesn't exist.
//
chrome.webRequest.onErrorOccurred.addListener((details) => {
  if ((['net::ERR_NAME_NOT_RESOLVED', 'net::ERR_NAME_RESOLUTION_FAILED',
    'net::ERR_CONNECTION_TIMED_OUT', 'NS_ERROR_UNKNOWN_HOST'].indexOf(details.error) >= 0) && (details.tabId >= 0) && (details.parentFrameId < 1)) {
    // note: testing parentFrameId prevents false positives
    const url = details.url
    if (isNotExcludedUrl(url) && isValidUrl(url)) {
      chrome.tabs.get(details.tabId, async (tab) => {
        // TODO FIXME: There's a bug causing normal pages to store status 999 and display a red dot.
        await saveTabData(tab, { 'statusCode': 999, 'statusUrl': url })
      })
    }
  }
}, { urls: ['<all_urls>'], types: ['main_frame'] })

// Listens for website loading completed for 404-Not-Found popups.
//
chrome.webRequest.onCompleted.addListener((details) => {
  const url = details.url

  // checking statusCode >= 400 here or else tab data may be overwritten with status 200 URLs.
  // another solution may be to forget using tab ids and use URLs for the key in saveTabData()
  if (isNotExcludedUrl(url) && isValidUrl(url) && details?.statusCode >= 400) {
    // must be > 0 and not => 0 or else tab may be undefined in Safari
    if (details.tabId > 0) {
      // normally go here
      chrome.tabs.get(details.tabId, async (tab) => {
        await saveTabData(tab, { 'statusCode': details.statusCode, 'statusUrl': url, 'statusWaybackUrl': null })
      })
    } else {
      // fixes case where tabId is -1 on first load in Firefox, which is likely a bug
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        await saveTabData(tabs[0], { 'statusCode': details.statusCode, 'statusUrl': url, 'statusWaybackUrl': null })
      })
    }
  }
}, { urls: ['<all_urls>'], types: ['main_frame'] })

// Check for 404 Not Found and other status errors.
// pass these keys in details: { tabId, statusCode, url }
//
function checkNotFound(details) {
  if (!details) { return }

  // save status, display 'V' toolbar icon and banner
  async function update(tab, statusUrl, waybackUrl, statusCode, bannerFlag) {
    checkLastError()
    await addToolbarState(tab, 'V')
    // need the following to store statusWaybackUrl, other keys are overwritten with the same values.
    await saveTabData(tab, { statusCode, statusUrl, 'statusWaybackUrl': waybackUrl })
    if (bannerFlag && tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'SHOW_BANNER',
        wayback_url: waybackUrl,
        status_code: statusCode
      })
    }
  }

  // check if wayback machine has a copy
  function checkWM(tab, details2, bannerFlag) {
    wmAvailabilityCheck(details2.url, (wayback_url, url) => {
      if (bannerFlag && tab?.id) {
        // scripting permission is required as executeScript() is moved from the tabs API to the scripting API
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['/scripts/archive.js']
        }).then(() => {
          update(tab, url, wayback_url, details2.statusCode, bannerFlag)
        })
      } else {
        update(tab, url, wayback_url, details2.statusCode, bannerFlag)
      }
    })
  }

  chrome.storage.local.get(['agreement', 'private_mode_setting', 'not_found_setting', 'embed_popup_setting'], (settings) => {
    if (settings?.agreement && settings.private_mode_setting === false && settings.not_found_setting && isNotExcludedUrl(details.url) && details?.statusCode >= 400) {
      const bannerFlag = (settings.embed_popup_setting && (details.statusCode !== 999)) || false
      chrome.tabs.get(details.tabId, (tab) => {
        checkWM(tab, details, bannerFlag)
      })
    }
  })
}

// Calls saveToMyWebArchive() if setting is set, and outputs errors to console.
//
function checkSaveToMyWebArchive(url, timestamp) {
  chrome.storage.local.get(['my_archive_setting'], (settings) => {
    if (settings?.my_archive_setting) {
      saveToMyWebArchive(url, timestamp)
      .then(data => {
        if (!data?.success) {
          console.log('Save to My Web Archive FAILED: ', data.error)
        }
      })
      .catch(error => {
        console.log('Save to My Web Archive FAILED: ', error)
      })
    }
  })
}

// Listens for messages to call background functions from other scripts.
// note: return true only if sendResponse() needs to be kept around.
//
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) { return }
  if (message.message === 'clearAutoSaveActivity') {
    if (sender.url !== chrome.runtime.getURL('index.html') &&
        sender.url !== chrome.runtime.getURL('index.html?view=settings')) { return false }
    queueAutoSaveActivity(() => chrome.storage.local.remove('auto_save_activity'))
      .then(() => sendResponse({ cleared: true }), () => sendResponse({ cleared: false }))
    return true
  }
  if (message.message === 'saveurl') {
    // Save Page Now uses the public target even if the URL was extracted from an archive.
    const pageUrl = getCleanUrl(message.page_url)
    const accepted = isNotExcludedUrl(pageUrl) && !isArchiveUrl(pageUrl)
    if (accepted) {
      savePageNowChecked(message.atab, pageUrl, message.silent || false, message.options || {})
    }
    sendResponse({ accepted })
  }
  else if (message.message === 'openurl') {
    // open URL in new tab or window depending on setting
    let page_url = getCleanUrl(message.page_url)
    if (isValidUrl(page_url) && isNotExcludedUrl(page_url)) {
      openByWindowSetting(message.wayback_url + page_url)
    }
  } else if (message.message === 'getWikipediaBooks') {
    // retrieve wikipedia books
    chrome.storage.local.get(['private_mode_setting'], (settings) => {
      if (settings?.private_mode_setting !== false || !isNotExcludedUrl(message.query)) {
        sendResponse({ status: 'error', error: 'Automatic lookup disabled' })
        return
      }
      getCachedBooks(message.query,
        (json) => { sendResponse(json) },
        (error) => { sendResponse({ error }) },
        message.isbns
      )
    })
    return true
  } else if (message.message === 'getCitedPapers') {
    // retrieve wikipedia papers
    getCachedPapers(message.query,
      (json) => { sendResponse(json) },
      (error) => { sendResponse({ error }) }
    )
    return true
  } else if (message.message === 'tvnews') {
    // retrieve tv news clips
    getCachedTvNews(message.article,
      (json) => { sendResponse(json) },
      (error) => { sendResponse({ error }) }
    )
    return true
  } else if (message.message === 'sendurl') {
    // sends a url to webpage under current tab (not used)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs?.[0]) {
        let url = getCleanUrl(tabs[0].url)
        chrome.tabs.sendMessage(tabs[0].id, { url })
      }
    })
  } else if (message.message === 'showall' && isNotExcludedUrl(message.url)) {
    // show all contexts (not used)
    const context_url = chrome.runtime.getURL('context.html') + '?url=' + fixedEncodeURIComponent(message.url)
    tabIdPromise = new Promise((resolve) => {
      openByWindowSetting(context_url, null, resolve)
    })
  } else if (message.message === 'getToolbarState') {
    resumeSaveJobs()
    // retrieve the toolbar state set & custom tab data
    (async () => {
      let data = await readTabData(message.atab);
      let state = toolbarStateFromTabData(data);
      sendResponse({ stateArray: Array.from(state), customData: data })
    })()
    return true
  } else if (message.message === 'addToolbarStates') {
    // add one or more states to the toolbar
    // States will fail to show if tab is loading but not in focus!
    // Content scripts cannot use tabs.query and send the tab, so it must be called here.
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs?.[0]?.url === message.url) {
        for (let state of message.states) {
          await addToolbarState(tabs[0], state)
        }
      }
    })
  } else if (message.message === 'clearCountBadge') {
    // wayback count settings unchecked
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs?.[0]) {
        updateWaybackCountBadge(tabs[0], null)
      }
    })
  } else if (message.message === 'updateCountBadge') {
    // update wayback count badge
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs?.[0] && isNotExcludedUrl(tabs[0].url)) {
        let url = getCleanUrl(tabs[0].url)
        updateWaybackCountBadge(tabs[0], url)
      }
    })
  } else if (message.message === 'clearResource') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs?.[0]) {
        if (message.settings) {
          // clear 'R' state if wiki, amazon, or tvnews settings have been cleared
          const news_host = new URL(tabs[0].url).hostname
          if (((message.settings.wiki_setting === false) && tabs[0].url.match(/^https?:\/\/[\w.]*wikipedia.org/)) ||
              ((message.settings.amazon_setting === false) && tabs[0].url.includes('www.amazon')) ||
              ((message.settings.tvnews_setting === false) && newshosts.has(news_host))) {
            await removeToolbarState(tabs[0], 'R')
          }
        } else {
          // clear 'R' if settings not provided
          await removeToolbarState(tabs[0], 'R')
        }
      }
    })
  } else if (message.message === 'clearFactCheck') {
    // fact check settings unchecked
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs?.[0]) {
        await removeToolbarState(tabs[0], 'F')
      }
    })
  } else if (message.message === 'getCachedWaybackCount') {
    // retrieve wayback count
    chrome.storage.local.get(['private_mode_setting'], (settings) => {
      if (settings?.private_mode_setting !== false) {
        sendResponse({ error: 'Automatic lookup disabled' })
        return
      }
      getCachedWaybackCount(message.url,
        (values) => { sendResponse(values) },
        (error) => { sendResponse({ error }) }
      )
    })
    return true
  } else if (message.message === 'clearCountCache') {
    clearCountCache()
  } /* else if (message.message === 'getFactCheckResults') {
    // retrieve fact check results
    getCachedFactCheck(message.url,
      (json) => { sendResponse({ json }) },
      (error) => { sendResponse({ error }) }
    )
    return true
  }
  */
  return false
})

chrome.tabs.onRemoved.addListener((id, info) => {
  clearTabData({ id, windowId: info.windowId })
})

chrome.tabs.onDetached.addListener((id, info) => {
  clearTabData({ id, windowId: info.oldWindowId })
})

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status === 'loading') {
    await clearToolbarState(tab)
  }
  const url = tab.url
  if (!(isNotExcludedUrl(url) && isValidUrl(url)) || isArchiveUrl(url)) { return }

  if (info.status === 'complete') {
    updateWaybackCountBadge(tab, url)

    chrome.storage.local.get([
      'private_mode_setting', 'not_found_setting', 'auto_archive_setting', 'auto_archive_age',
      'auto_archive_custom_value', 'auto_archive_custom_unit', 'fact_check_setting', 'wiki_setting'
    ], async (settings) => {
      if (settings?.private_mode_setting !== false) { return }
      if (settings.auto_archive_setting) {
        const hours = autoSaveIntervalHours(settings)
        const beforeDate = hours === null ? null : new Date(Date.now() - hours * 60 * 60 * 1000)
        await autoSave(tab, url, beforeDate)
      }

      // 404 not found
      if (settings?.not_found_setting) {
        let data = await readTabData(tab);
        // cropPrefix used because Wayback's URL may not match exactly (e.g. "http" != "https")
        if (data?.statusCode && (cropPrefix(data.statusUrl) === cropPrefix(url))) {
          if (data.statusCode >= 400) {
            checkNotFound({ tabId, 'statusCode': data.statusCode, 'url': data.statusUrl })
          } else {
            await removeToolbarState(tab, 'V')
          }
        }
      }

      // fact check
      if (settings?.fact_check_setting) {
        factCheck(tab, url)
      }

      // wikipedia papers
      if (settings?.wiki_setting && url.match(/^https?:\/\/[\w.]*wikipedia.org/)) {
        // if the papers API were to be updated similar to books API, then this would move to wikipedia.js
        getCachedPapers(url,
          async (data) => {
            if (data?.status !== 'error') {
              await addToolbarState(tab, 'R')
              await addToolbarState(tab, 'papers')
            }
          }, () => {}
        )
      }
    })
  } else if (info.status === 'loading') {
    let received_url = url
    if (received_url && !isArchiveUrl(received_url)) {
      let open_url = received_url.replace(/^https?:\/\//, '')
      if (open_url.slice(-1) === '/') { open_url = received_url.substring(0, open_url.length - 1) }

      chrome.storage.local.get(['private_mode_setting', 'amazon_setting', 'tvnews_setting'], (settings) => {
        if (settings?.private_mode_setting !== false) { return }

        // checking amazon books
        if (settings?.amazon_setting) {
          // checking resource of amazon books
          if (url.includes('www.amazon') && url.includes('/dp/')) {
            let headers = new Headers(hostHeaders)
            headers.set('backend', 'nomad')
            fetchWithTimeout(hostURL + 'services/context/amazonbooks?url=' + fixedEncodeURIComponent(url), { headers })
            .then(async (resp) => {
              if (resp?.metadata?.identifier || resp?.ocaid) {
                await addToolbarState(tab, 'R')
                // Storing the tab url as well as the fetched archive url for future use
                // TODO: may want to redo this?
                chrome.storage.local.set({ 'tab_url': url, 'detail_url': resp.metadata?.['identifier-access'] || null }, () => {})
              }
            }).catch(error => console.warn('Could not look up Archive.org book', error))
          }
        }

        // checking tv news
        const news_host = new URL(url).hostname // FIXME
        if (settings?.tvnews_setting && newshosts.has(news_host)) {
          getCachedTvNews(url,
            async (clips) => {
              if (clips?.status !== 'error') {
                await addToolbarState(tab, 'R')
              }
            }, () => {}
          )
        }

      })
    }
  }
})

// Called whenever a browser tab is selected
chrome.tabs.onActivated.addListener((info) => {
  chrome.storage.local.get(['fact_check_setting', 'wiki_setting', 'amazon_setting', 'tvnews_setting'], (settings) => {
    checkLastError()
    chrome.tabs.get(info.tabId, async (tab) => {
      checkLastError()
      if (typeof tab === 'undefined') { return }
      const tbStates = await getToolbarState(tab);
      // fact check settings unchecked
      if (settings?.fact_check_setting === false && tbStates.has('F')) {
        await removeToolbarState(tab, 'F')
      }
      // wiki_setting settings unchecked
      if (settings?.wiki_setting === false && tbStates.has('R')) {
        if (tab.url.match(/^https?:\/\/[\w.]*wikipedia.org/)) { await removeToolbarState(tab, 'R') }
      }
      // amazon_setting settings unchecked
      if (settings?.amazon_setting === false && tbStates.has('R')) {
        if (tab.url.includes('www.amazon')) { await removeToolbarState(tab, 'R') }
      }
      // tvnews_setting settings unchecked
      if (settings?.tvnews_setting === false && tbStates.has('R')) {
        const news_host = new URL(tab.url).hostname
        if (newshosts.has(news_host)) { await removeToolbarState(tab, 'R') }
      }
      // clear '404 not found' dot if tab URL doesn't match stored URL
      let data = await readTabData(tab);
      if (data?.statusUrl && (cropPrefix(data.statusUrl) !== cropPrefix(tab.url))) {
        // TODO FIXME: stored data with statusCode: 999 and data.statusUrl doesn't match tab.url
        // since data is never cleared, this is called every time user switches to this tab.
        // Could check if has 'V' first? (tab id doesn't match the one in toolbar state) [FIXED]
        // BUG: Stale 'V' state stored for tab id that no longer exists, never gets cleared!
        await removeToolbarState(tab, 'V');
      }
      updateToolbar(tab, await getToolbarState(tab));
      updateWaybackCountBadge(tab, tab.url)
    })
  })
})

/**
 * Runs savePageNow if given tab not currently in saving state.
 * First checks if url available in WM, and only saves if beforeDate is prior
 * to last save date, or saves if never been saved before, or beforeDate not provided.
 * Will not save URLs blocked by the WM API, or URLs in the Auto Exclude List.
 * @param atab {Tab}: Current tab, required to check save status.
 * @param url {string}: URL to save.
 * @param beforeDate {Date}: Date that will be checked only if url previously saved in WM.
 * Leave empty to always save. Set to null to save only if hadn't been previously saved.
 */
function autoSaveAllowed(url, settings) {
  return settings?.private_mode_setting === false &&
    isNotExcludedUrl(url) && !isArchiveUrl(url) &&
    !isUrlInList(url, settings.auto_exclude_list || defaultAutoExcludeList)
}

async function autoSave(atab, url, beforeDate = new Date(), feature = 'auto_archive_setting') {
  if ((await getToolbarState(atab)).has('S')) { return }
  const keys = ['private_mode_setting', 'auto_exclude_list', feature]
  chrome.storage.local.get(keys, (settings) => {
    if (!settings?.[feature] || !autoSaveAllowed(url, settings)) { return }
    getCachedWaybackCount(url, (values) => {
      const lastCapture = timestampToDate(values?.last_ts)
      const shouldSave = values?.total === 0 ||
        (values?.total > 0 && beforeDate && lastCapture && lastCapture < beforeDate)
      if (!shouldSave) { return }
      checkAuthentication((auth) => {
        // Re-check at the last asynchronous boundary before publishing the URL.
        chrome.storage.local.get(keys, (current) => {
          if (current?.[feature] && autoSaveAllowed(url, current)) {
            savePageNow(atab, url, true, undefined, auth?.auth_check || false)
          }
        })
      })
    }, (error) => {
      console.log('wayback count error: ' + error)
    })
  })
}

// Add a listener for handling Auto Save Bookmarks.
function autoBookmarksListener(id, bookmark) {
  // This runs whenever a bookmark is saved.
  if (bookmark?.url && isValidUrl(bookmark.url) && isNotExcludedUrl(bookmark.url) && !isArchiveUrl(bookmark.url)) {
    chrome.storage.local.get(['auto_bookmark_setting'], (settings) => {
      if (settings?.auto_bookmark_setting) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          // The check here that current tab URL == bookmark URL is a temp solution to
          // the issue caused when bookmarking "All Tabs" which could cause too many saves at once.
          // This forces only 1 URL to be saved. Also prevents importing URLs from saving any.
          // Trying to solve multiple URLs would require a queue. Could open a Bulk Save window?
          if (tabs?.[0] && (tabs[0].url === bookmark.url)) {
            autoSave(tabs[0], bookmark.url, undefined, 'auto_bookmark_setting')
          }
        })
      }
    })
  }
}

// Should call this after 'bookmarks' permission Allowed and on start.
function setupAutoSaveBookmarks() {
  // adding a named function instead of anonymous function should prevent multiple listeners from being added.
  // safari doesn't support chrome.bookmarks
  chrome.bookmarks?.onCreated?.addListener(autoBookmarksListener)
}

// Called when an optional permission is acquired such as 'bookmarks'.
chrome.permissions.onAdded.addListener((permissions) => {
  if (permissions.permissions.indexOf('bookmarks') >= 0) {
    setupAutoSaveBookmarks()
    // Bug fix to set setting value because when popup goes away, code in settings.js won't run.
    // FIXME: This is a Hack which may be unintended if any other code attempts to request the
    // 'bookmarks' permission (or ANY optional permission!) in the future. (e.g. Bulk Save)
    // It's hard to see a solution without major refactoring since dependent functions are all in background.js
    chrome.storage.local.set({ auto_bookmark_setting: true })
  }
})

// Restore work and clear orphaned records when a new event page wakes.
resumeSaveJobs(true)

// Called once on extension load, in case permission allowed on start.
setupAutoSaveBookmarks()

// Call Context Notices API, parse and store results if success, then set the toolbar state.
//
function factCheck(atab, url) {
  if (isValidUrl(url) && isNotExcludedUrl(url)) {
    // retrieve fact check results
    getCachedFactCheck(url,
      async (json) => {
        // json is an object containing:
        //   "notices": [ { "notice": "...", "context_url": "..." } ],
        //   "status": "success"

        // parse notices from result
        if (json?.status === 'success' && json?.notices?.length > 0) {
          // Create a Wayback Machine URL from most recent timestamp, or the latest capture if no timestamp returned.
          // If multiple notices, pick notice with most recent timestamp.

          // let latestTimestamp = '2' // latest capture in Wayback Machine URL
          // let latestDate = new Date(0) // epoch 1/1/1970

          // loop through every timestamp present
          // json.notices.forEach(ntc => {
          //   if (ntc?.where?.timestamp) {
          //     const tstamps = ntc.where.timestamp || []
          //     tstamps.forEach(tstamp => {
          //       // compare each timestamp to latest
          //       const timestamp = (tstamp.charAt(0) === '-') ? tstamp.slice(1) : tstamp // remove leading dash
          //       const date = timestampToDate(timestamp)
          //       if (date.getTime() > latestDate.getTime()) {
          //         latestDate = date
          //         latestTimestamp = timestamp
          //       }
          //     })
          //   }
          // })
          // extract context URL if present
          if ('context_url' in json.notices[0]) {
            const contextUrl = json.notices[0]['context_url']
            if (contextUrl !== url) {
              // only show context button if URL different than current URL in address bar
              await saveTabData(atab, { contextUrl })
              await addToolbarState(atab, 'F')
            }
          }
        }
      },
      (error) => {
        console.log('factcheck error: ', error)
      }
    )
  }
}

/* * * Wayback Count * * */

const countCacheTTL = 5 * 60 * 1000
const maxCountEntries = 64
const countCacheKey = 'waybackCountCacheV2'
let countCacheWrites = Promise.resolve()
let countCacheEpoch = 0

function writeCountCache(change) {
  countCacheWrites = countCacheWrites.then(async () => {
    const cache = (await chrome.storage.session.get(countCacheKey))[countCacheKey] || {}
    change(cache)
    const entries = Object.entries(cache)
      .filter(([, item]) => Date.now() - item.savedAt < countCacheTTL)
      .sort(([, left], [, right]) => right.savedAt - left.savedAt)
      .slice(0, maxCountEntries)
    await chrome.storage.session.set({ [countCacheKey]: Object.fromEntries(entries) })
  }).catch(error => console.warn('Wayback count cache write failed', error))
}

async function getCachedWaybackCount(url, onSuccess, onFail) {
  if (!isNotExcludedUrl(url)) { onFail(new Error('Unsupported URL')); return }
  const started = Date.now()
  const epoch = countCacheEpoch
  try {
    await countCacheWrites
    const item = (await chrome.storage.session.get(countCacheKey))[countCacheKey]?.[url]
    if (item && Date.now() - item.savedAt < countCacheTTL) {
      onSuccess(item.values)
      return
    }
  } catch (error) {
    console.warn('Wayback count cache read failed', error)
  }
  getWaybackCount(url, values => {
    if (epoch === countCacheEpoch) {
      writeCountCache(cache => {
        if (!cache[url] || cache[url].savedAt <= started) {
          cache[url] = { savedAt: Date.now(), values }
        }
      })
    }
    onSuccess(values)
  }, onFail)
}

function clearCountCache() {
  countCacheEpoch++
  countCacheWrites = countCacheWrites.then(() =>
    chrome.storage.session.remove(['waybackCountCache', countCacheKey])
  ).catch(error => console.warn('Could not clear Wayback count cache', error))
}

function incrementCount(url, timestamp) {
  if (!isNotExcludedUrl(url) || !/^\d{14}$/.test(timestamp)) { return }
  writeCountCache(cache => {
    const item = cache[url]
    if (!item || Date.now() - item.savedAt >= countCacheTTL) { return }
    if (item.values.total < 0 || item.values.last_ts >= timestamp) { return }
    item.values.total++
    item.values.last_ts = timestamp
  })
}

function updateWaybackCountBadge(atab, url) {
  if (!atab) { return }
  chrome.storage.local.get(['private_mode_setting', 'wm_count_setting'], (settings) => {
    if (settings?.private_mode_setting === false && settings.wm_count_setting && isValidUrl(url) && isNotExcludedUrl(url) && !isArchiveUrl(url)) {
      getCachedWaybackCount(url, async(values) => {
        let tbStates = await getToolbarState(atab);
        if ((values.total >= 0) && !tbStates.has('S')) {
          // display badge
          let text = badgeCountText(values.total)
          chrome.action.setBadgeBackgroundColor({ color: '#9A3B38' }, checkLastError) // red
          chrome.action.setBadgeText({ tabId: atab.id, text }, checkLastError)
        } else {
          chrome.action.setBadgeText({ tabId: atab.id, text: '' }, checkLastError)
        }
      },
      (error) => {
        console.log('wayback count error: ' + error)
        chrome.action.setBadgeText({ tabId: atab.id, text: '' }, checkLastError)
      })
    } else {
      chrome.action.setBadgeText({ tabId: atab.id, text: '' }, checkLastError)
    }
  })
}

/* * * Toolbar * * */

/**
 * Sets the toolbar icon.
 * Name string is based on PNG image filename in images/toolbar/
 * @param name {string} = one of 'archive', 'check', 'R', or 'S'
 * @param tabId {int} (optional) = tab id, else sets current or global icon.
 */
function setToolbarIcon(name, tabId = null) {
  const validToolbarIcons = new Set(['R', 'S', 'F', 'V', 'check', 'archive'])
  const checkBadgePos = new Set(['R', 'F', 'V'])
  const path = '../images/toolbar/'
  const n = validToolbarIcons.has(name) ? name : 'archive'
  const ab = checkBadgePos.has(name) ? (isBadgeOnTop() ? 'b' : 'a') : ''
  const prefix = isDevVersion() ? 'dev-icon-' : 'toolbar-icon-'
  const allPaths = {
    '16': (path + prefix + n + ab + '16.png'),
    '24': (path + prefix + n + ab + '24.png'),
    '32': (path + prefix + n + ab + '32.png'),
    '64': (path + prefix + n + ab + '64.png')
  }
  const details = Number.isInteger(tabId) ? { path: allPaths, tabId } : { path: allPaths }
  chrome.action.setIcon(details, checkLastError)
}

function changeToolbarState(tab, state, enabled) {
  return mutateTabData(tab, data => {
    const states = toolbarStateFromTabData(data)
    if (states.has(state) === enabled) { return false }
    if (enabled) { states.add(state) } else { states.delete(state) }
    data.states = Array.from(states)
  }, data => updateToolbar(tab, toolbarStateFromTabData(data)))
}

function addToolbarState(tab, state) {
  return changeToolbarState(tab, state, true)
}

function removeToolbarState(tab, state) {
  return changeToolbarState(tab, state, false)
}

// Helper function to return Set of toolbar states from tab data.
function toolbarStateFromTabData(data) {
  let tbStates = new Set();
  if (data?.states) {
    // convert stored Array to a Set
    tbStates = new Set(data.states);
  }
  return tbStates;
}

// Returns a Promise of a Set of toolbar states, or an empty set.
async function getToolbarState(atab) {

  if (!atab) { return new Set() }
  let data = await readTabData(atab);
  return toolbarStateFromTabData(data);
}

function clearToolbarState(tab) {
  return clearTabData(tab, () => updateToolbar(tab))
}

function updateToolbar(tab, states = new Set()) {
  if (!Number.isInteger(tab?.id) || tab.id < 0) { return }
  const icon = ['S', 'V', 'F', 'R', 'check'].find(state => states.has(state)) || 'archive'
  setToolbarIcon(icon, tab.id)
}

/* * * Right-click Menu * * */

// Right-click context menu "Wayback Machine" inside the page.
chrome.contextMenus.onClicked.addListener((click) => {
  if (['first', 'recent', 'save', 'all'].indexOf(click.menuItemId) >= 0) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      let url = click.linkUrl || tabs[0].url
      if (isValidUrl(url) && isNotExcludedUrl(url)) {
        let page_url = getCleanUrl(url)
        let wayback_url
        if (click.menuItemId === 'first') {
          wayback_url = 'https://web.archive.org/web/0/'
        } else if (click.menuItemId === 'recent') {
          wayback_url = 'https://web.archive.org/web/2/'
        } else if (click.menuItemId === 'all') {
          wayback_url = 'https://web.archive.org/web/*/'
        } else if (click.menuItemId === 'save') {
          let atab = tabs[0]
          let options = { 'capture_all': 1 }
          savePageNowChecked(atab, page_url, false, options)
          return true
        }
        openByWindowSetting(wayback_url + page_url)
      } else {
        alertMsg('URL not supported.')
      }
    })
  } else if (click.menuItemId === 'welcome') {
    openByWindowSetting(chrome.runtime.getURL('welcome.html'), 'tab')
  }
})

if (typeof module !== 'undefined') {
  module.exports = {
    tabIdPromise
  }
}
