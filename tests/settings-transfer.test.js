const assert = require('node:assert/strict')
const test = require('node:test')
const { backupImport } = require('../scripts/settings-transfer.js')

const defaults = {
  view_setting: 'tab',
  archive_capture_limit: '5',
  auto_exclude_list: ['*.proton.me*'],
  auto_archive_custom_value: 1,
  auto_archive_custom_unit: 'days'
}
const validateInterval = (value, unit) => value <= (unit === 'days' ? 365 : 8760) ? value : null
const backup = settings => ({ version: 1, settings })

test('merge preserves other settings and exclusions, and pauses auto-save', () => {
  const changed = backupImport(backup({
    archive_capture_limit: '12', auto_exclude_list: ['example.org/*'], auth_cookies: ['never import'],
    private_mode_setting: false, archive_today_enabled: true, auto_archive_setting: true
  }), defaults, false, defaults, validateInterval)
  assert.deepEqual(changed, {
    archive_capture_limit: '12',
    auto_exclude_list: ['*.proton.me*', 'example.org/*'],
    auto_archive_setting: false,
    auto_bookmark_setting: false
  })
})

test('replace returns known defaults and accepts a deliberately empty exclusion list', () => {
  const changed = backupImport(backup({ auto_exclude_list: [] }),
    { ...defaults, view_setting: 'window' }, true, defaults, validateInterval)
  assert.equal(changed.view_setting, 'tab')
  assert.deepEqual(changed.auto_exclude_list, [])
})

test('rejects unsupported versions, bad types and invalid custom intervals', () => {
  const apply = payload => backupImport(payload, defaults, true, defaults, validateInterval)
  assert.throws(() => apply({ version: 2, settings: {} }), /version/)
  assert.throws(() => apply(backup({ auto_exclude_list: [' '] })), /auto_exclude_list/)
  assert.throws(() => apply(backup({ archive_capture_limit: '200' })), /archive_capture_limit/)
  assert.throws(() => apply(backup({ auto_archive_custom_value: 500 })), /interval/)
})
