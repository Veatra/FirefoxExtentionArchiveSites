# Wayback Machine Firefox fork

This repository contains an unpacked fork of the Internet Archive Wayback Machine extension 3.4.8. The fork targets Firefox ESR 115 and retains the upstream copyright, AGPL-3.0 terms and add-on ID. Fork changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Load and test

1. On Firefox ESR 115, open `about:debugging#/runtime/this-firefox`.
2. Select **Load Temporary Add-on**, then select this checkout's `manifest.json`.
3. Use **Inspect** to see background messages. The temporary installation ends when Firefox closes.

The extension has no build step or runtime package dependencies. For an unsigned XPI on Firefox ESR, Mozilla documents setting `xpinstall.signatures.required` to `false` in `about:config`, then using **Install Add-on From File** in `about:addons`. This pref applies across the current Firefox profile. Use a dedicated ESR profile for the fork. The XPI must contain `manifest.json` at its root and omit the original `META-INF` signature files. The fork retains the explicit upstream ID, so installing it in the same profile may replace the upstream extension. See [Mozilla's signing guide](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

Run `node --test tests/utils.test.js` with Node 20 or newer. If Mozilla's `web-ext` is installed, run `web-ext lint --ignore-files 'META-INF/**' 'tests/**'`. See [COMPAT.md](COMPAT.md) and [REGRESSION.md](REGRESSION.md) for tested behavior and remaining checks.

## Archives

Open the popup and expand **Archives** to see the Wayback total and recent captures. Choose 5, 10 or 20 rows. Each readable capture includes its UTC date and time, available HTTP status, a link, and a Copy button. Requests start on open, and Private Mode or an excluded URL blocks the lookup. See [PRIVACY-DELTA.md](PRIVACY-DELTA.md).
