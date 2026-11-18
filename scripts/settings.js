// settings.js

// from 'utils.js'
/*   global attachTooltip, openByWindowSetting, isSafari */

// from 'popup.js'
/*   global setupWaybackCount, goBackToMain */

// onload
$(function() {
  initSettings()
  setupPrivateMode()
  setupSettingsChange()
  setupPanelSwitch()
  setupHelpDocs()
  $('#exclude-urls-btn').click(showExcludeList)
  $('.back-btn').off('click').on('click', goBackToMain)
})

function initSettings() {
  chrome.storage.local.get(null, restoreSettings)
}

function restoreSettings(items) {
  // SPN
  $('#chk-screenshot').prop('checked', items.spn_screenshot)
  $('#chk-outlinks').prop('checked', items.spn_outlinks)
  // first panel
  $('#private-mode-setting').prop('checked', items.private_mode_setting)
  $('#not-found-setting').prop('checked', items.not_found_setting)
  $('#wm-count-setting').prop('checked', items.wm_count_setting)
  $('#fact-check-setting').prop('checked', items.fact_check_setting)
  $('#wiki-setting').prop('checked', items.wiki_setting)
  $('#amazon-setting').prop('checked', items.amazon_setting)
  $('#tvnews-setting').prop('checked', items.tvnews_setting)
  // second panel
  $('#auto-archive-setting').prop('checked', items.auto_archive_setting)
  const savedAge = String(items.auto_archive_age ?? '99999')
  if (Array.from(document.getElementById('auto-archive-age').options).some(option => option.value === savedAge)) {
    $('#auto-archive-age').val(savedAge)
  }
  if (customAutoSaveHours(items.auto_archive_custom_value, items.auto_archive_custom_unit) !== null) {
    $('#auto-archive-value').val(items.auto_archive_custom_value)
    $('#auto-archive-unit').val(items.auto_archive_custom_unit)
  }
  updateAutoArchiveControls()
  $('#auto-bookmark-setting').prop('checked', items.auto_bookmark_setting)
  $('#email-results-setting').prop('checked', items.email_results_setting)
  $('#my-archive-setting').prop('checked', items.my_archive_setting)
  $('#resource-list-setting').prop('checked', items.resource_list_setting)
  $('#notify-setting').prop('checked', items.notify_setting)
  $('#embed-popup-setting').prop('checked', items.embed_popup_setting)
  $('input[name=view-setting-input]').val([items.view_setting || 'tab'])
  // update UI
  enableEmbedPopupSetting(items.not_found_setting)
}

function saveSettingChange(event) {
  const control = event.target
  const names = { 'chk-screenshot': 'spn_screenshot', 'chk-outlinks': 'spn_outlinks' }
  const key = control.name === 'view-setting-input'
    ? 'view_setting' : names[control.id] || control.id.replaceAll('-', '_')
  const value = control.type === 'checkbox' ? control.checked : control.value
  const settings = { [key]: value }
  if (value === true && control.classList.contains('private-setting')) {
    settings.private_mode_setting = false
  }
  chrome.storage.local.set(settings)
}

function updateAutoArchiveControls() {
  document.getElementById('auto-archive-custom').hidden = $('#auto-archive-age').val() !== 'custom'
  $('#auto-archive-value').attr('max', $('#auto-archive-unit').val() === 'days' ? '365' : '8760')
}

function saveAutoArchiveInterval() {
  updateAutoArchiveControls()
  const age = $('#auto-archive-age').val()
  const values = { auto_archive_age: age }
  const status = $('#auto-archive-settings-status')
  if (age === 'custom') {
    const value = $('#auto-archive-value').val()
    const unit = $('#auto-archive-unit').val()
    if (customAutoSaveHours(value, unit) === null) {
      status.text('Enter a whole interval between 1 hour and 365 days.')
      return
    }
    values.auto_archive_custom_value = Number(value)
    values.auto_archive_custom_unit = unit
  }
  status.empty()
  chrome.storage.local.set(values)
}

// Clear only the settings that depend on signing in.
function clearSettingsOnLogout() {
  $('.clear-on-logout').prop('checked', false)
  chrome.storage.local.set({
    spn_outlinks: false,
    spn_screenshot: false,
    email_results_setting: false,
    my_archive_setting: false
  })
}

function setupPrivateMode() {
  $('#private-mode-setting').change(onPrivateModeChange)
  $('.private-setting').change(onPrivateSettingChange)
}

// When Private Mode turned on, clear all private checkboxes and clear cached data.
function onPrivateModeChange(e) {
  if ($('#private-mode-setting').prop('checked') === true) {
    $('.private-setting').prop('checked', false).trigger('change')
    chrome.runtime.sendMessage({ message: 'clearCountCache' })
  }
}

// Turn off private mode if any private checkbox is set.
function onPrivateSettingChange(e) {
  if ($(e.target).prop('checked') === true) {
    $('#private-mode-setting').prop('checked', false)
  }
}

// Enable or disable setting when flag is true or false.
function enableEmbedPopupSetting(flag) {
  if (flag) {
    $('#embed-popup-setting').attr('disabled', false)
    $('#embed-popup-label').css('opacity', '1.0').css('cursor', '')
  } else {
    $('#embed-popup-setting').attr('disabled', true)
    $('#embed-popup-label').css('opacity', '0.66').css('cursor', 'not-allowed')
  }
}

// Save settings on change and other actions on particular settings.
function setupSettingsChange() {

  $('.saved-setting').change(saveSettingChange)
  $('#auto-archive-age, #auto-archive-value, #auto-archive-unit').change(saveAutoArchiveInterval)

  // auto save bookmarks
  if (isSafari) {
    // Tried alternatives to test bookmarks support, but none worked out.
    // hide setting if bookmarks unsupported
    $('#auto-bookmark-label').hide()
  } else {
    // before setting Auto Save Bookmarks, check optional 'bookmarks' permission and popup request if not yet acquired.
    $('#auto-bookmark-setting').click((e) => {
      if ($(e.target).prop('checked') === true) {
        e.preventDefault()
        chrome.permissions.request({ permissions: ['bookmarks'] }, (granted) => {
          if (granted) {
            // Set checkmark and save it since it was prevented.
            // Permissions popup will cause main popup to disappear, preventing this code from running.
            // Fixed by saving auto_bookmark_setting to true in background.js when permission granted.
            $('#auto-bookmark-setting').prop('checked', true)
            chrome.storage.local.set({ auto_bookmark_setting: true })
          }
        })
      }
    })
  }

  // notify setting
  // hide setting if notifications unsupported (e.g. Safari)
  if (!chrome.notifications) {
    $('#notify-label').hide()
  }

  // view setting
  $('#view-setting').click(switchTabWindow)
  $('#view-setting').children('input,label').click((e) => { e.stopPropagation() })

  // wayback count
  $('#wm-count-setting').change((e) => {
    // displays or clears the count badge, label, oldest and newest tooltips
    setupWaybackCount()
  })

  // 404 embed-popup-setting
  $('#not-found-setting').change((e) => {
    enableEmbedPopupSetting($(e.target).prop('checked') === true)
  })

  // resources
  $('#wiki-setting').change((e) => {
    if ($(e.target).prop('checked') === false) {
      $('#wiki-container').hide()
      chrome.runtime.sendMessage({ message: 'clearResource', settings: { wiki_setting: false } })
    }
  })
  $('#amazon-setting').change((e) => {
    if ($(e.target).prop('checked') === false) {
      $('#readbook-container').hide()
      chrome.runtime.sendMessage({ message: 'clearResource', settings: { amazon_setting: false } })
    }
  })
  $('#tvnews-setting').change((e) => {
    if ($(e.target).prop('checked') === false) {
      $('#tvnews-container').hide()
      chrome.runtime.sendMessage({ message: 'clearResource', settings: { tvnews_setting: false } })
    }
  })

  // context notices
  $('#fact-check-setting').change((e) => {
    if ($(e.target).prop('checked') === false) {
      $('#fact-check-container').hide()
      chrome.runtime.sendMessage({ message: 'clearFactCheck' })
    }
  })
}

function showExcludeList() {
  openByWindowSetting(chrome.runtime.getURL('exclude-list.html'), 'windows')
}

// Prepares the top tab bar for switching between setting panels.
function setupPanelSwitch() {
  $('#panel1-btn').addClass('selected')
  $('#second-panel').hide()
  $('#panel1-btn').click(() => {
    $('#second-panel').hide()
    $('#first-panel').show()
    if (!$('#panel1-btn').hasClass('selected')) { $('#panel1-btn').addClass('selected') }
    if ($('#panel2-btn').hasClass('selected')) { $('#panel2-btn').removeClass('selected') }
  })
  $('#panel2-btn').click(() => {
    $('#first-panel').hide()
    $('#second-panel').show()
    if (!$('#panel2-btn').hasClass('selected')) { $('#panel2-btn').addClass('selected') }
    if ($('#panel1-btn').hasClass('selected')) { $('#panel1-btn').removeClass('selected') }
  })
}

// Cycles the Tab/Window setting.
function switchTabWindow() {
  let idx = 0, inputs = $('input[name=view-setting-input]')
  for (let i = 0; i < inputs.length; i++) {
    if (inputs[i].checked) { idx = i }
  }
  let j = (idx + 1) % inputs.length // wrap around using mod
  $(inputs[j]).prop('checked', true).trigger('change')
}

function setupHelpDocs() {
  let docs = {
    // context tab
    'private-mode-setting': 'Don\'t initiate automatic communications between this extension and the Internet Archive.',
    'not-found-setting': 'If server returns a 4xx or 5xx then check the Wayback Machine for archives.',
    'wm-count-setting': 'Show number of times the current URL has been archived in the Wayback Machine.',
    'fact-check-setting': 'Check for contextual information from fact checking organizations and origin websites.',
    'wiki-setting': 'Check for books and academic papers from the Internet Archive referenced in Wikipedia articles. ',
    'amazon-setting': 'Check if books from Amazon are available from the Internet Archive.',
    'tvnews-setting': 'Auto check for related TV News Clips while visiting selected news websites.',
    // general tab
    'auto-archive-setting': 'Archive URLs that have not previously been archived to the Wayback Machine.',
    'auto-bookmark-setting': 'Archive when bookmarking a website, except Excluded URLs.',
    'email-results-setting': 'Get an email report with the list of URLs you have captured.',
    'my-archive-setting': 'Adds URL to My Web Archive when Save Page Now is selected.',
    'notify-setting': 'Turn off all notifications.',
    'resource-list-setting': 'Display embedded URLs archived with Save Page Now.'
  }
  let labels = $('label')
  for (let i = 0; i < labels.length; i++) {
    let docFor = $(labels[i]).attr('for')
    if (docs[docFor]) {
      let tt = $('<div>').append($('<p>').text(docs[docFor]).attr({ 'class': 'setting-tip' }))[0].outerHTML
      let docBtn = $('<button>').addClass('btn-docs').text('?')
      $(labels[i]).append(attachTooltip(docBtn, tt, 'top'))
    }
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    clearSettingsOnLogout
  }
}
