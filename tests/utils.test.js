const assert = require('node:assert/strict')
const test = require('node:test')

globalThis.isInTestEnv = true
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Firefox/115.0' } })
const { fetchWithTimeout, getTabKey, isNotExcludedUrl, isUrlInList, matchWildcard, normalizeExcludePattern } =
  require('../scripts/utils.js')

test('classifies canonical and alternate local addresses without DNS', () => {
  for (const url of [
    'http://2130706433/', 'http://0x7f000001/', 'http://127.1/', 'http://10.0.0.1/',
    'http://172.31.1.2/', 'http://192.168.2.3/', 'http://169.254.169.254/',
    'http://100.127.0.1/', 'http://[::1]/', 'http://[::ffff:7f00:1]/',
    'http://[fc00::1]/', 'http://[fe80::1]/', 'http://[2001:db8::1]/',
    'https://router/', 'https://device.local./', 'https://test.internal/', 'https://my.home.arpa/',
    'https://name:pass@example.org/', 'file:///etc/hosts', 'https://', null
  ]) {
    assert.equal(isNotExcludedUrl(url), false, String(url))
  }

  for (const url of ['HTTPS://Example.org/', 'http://172.32.1.2/', 'http://1.1.1.1/', 'https://[2606:4700::1111]/']) {
    assert.equal(isNotExcludedUrl(url), true, url)
  }
})

test('matches exclusions case-insensitively with anchored literal segments', () => {
  assert.equal(normalizeExcludePattern(' HTTPS://www.EXAMPLE.org/Path/ '), 'example.org/path')
  assert.equal(isUrlInList('https://example.org/Path', ['EXAMPLE.org/P*']), true)
  assert.equal(matchWildcard('ab', 'a**b'), true)
  assert.equal(matchWildcard('abc', 'ab*bc'), false)
  assert.equal(matchWildcard('a'.repeat(50000) + 'z', '*a'.repeat(1000) + '*z'), true)
  assert.equal(matchWildcard('a'.repeat(50000) + 'x', '*a'.repeat(1000) + '*z'), false)
})

test('applies Discord and Proton rules at the apex and subdomains', () => {
  const patterns = ['*.discord.com/api/webhooks/*', '*.proton.me*']
  for (const host of ['discord.com', 'canary.discord.com', 'www.discord.com']) {
    assert.equal(isUrlInList('https://' + host + '/API/webhooks/1/token', patterns), true)
    assert.equal(isUrlInList('https://' + host + '/channels/', patterns), false)
  }
  assert.equal(isUrlInList('https://proton.me/', patterns), true)
  assert.equal(isUrlInList('https://mail.proton.me/', patterns), true)
  assert.equal(isUrlInList('https://mail.proton.me.example.org/', patterns), false)
})

test('preserves zero-valued tab and window IDs', () => {
  assert.equal(getTabKey({ id: 0, windowId: 0 }), '0i0')
  assert.equal(getTabKey({ id: -1, windowId: 0 }), '')
  assert.equal(getTabKey({ id: 0 }), '')
})

test('request deadline aborts a stalled response body', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, { signal }) => ({
    json() {
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }
  })
  try {
    await assert.rejects(fetchWithTimeout('https://example.org/', {}, undefined, 10), { name: 'AbortError' })
  } finally {
    globalThis.fetch = originalFetch
  }
})
