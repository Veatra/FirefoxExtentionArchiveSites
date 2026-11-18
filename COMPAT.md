# Compatibility

| Feature | Method | Result and fallback |
| --- | --- | --- |
| Firefox 115.43 ESR MV3 event page | Installed a temporary add-on with Linux Firefox 115.43.0 ESR and Mozilla web-ext | Loaded. The cloud shell required filesystem sandbox escalation to initialize Firefox. Windows 8.1 and 115.0 floor installation still need a smoke test. |
| Tab state and storage.session | Firefox 115.43 background fixture used the real storage and tab APIs for concurrent icon/state and context writes, then cleared the record | Passed. Probe output was `WAYBACK-115-PASS`. Do not use storage.session.setAccessLevel. |
| URL and exclusion handling | Firefox 115.43 background fixture and Node unit tests | Passed canonical private IPv4 rejection, Discord matching and Private Mode decision. Unit tests include additional literal ranges, mixed case and long wildcard inputs. |
| Request cancellation | Node unit test with a stalled response body and a short timeout | Abort reached the underlying request signal. The panel separately aborts on close or settings change. |
| Bootstrap Tooltip bridge | Firefox 115.43 test loaded the bundled scripts | `jQuery.fn.tooltip` exists. Popup first-run, layout and focus behavior remain on the manual checklist. |
| Archives panel | Firefox 115.43 extension-page fixture with mocked Wayback responses | Probe output was `WAYBACK-PANEL-PASS`. Checked Private Mode with zero requests, count and replay link, cache reuse, empty and unavailable responses. Clipboard and physical popup sizing need the Windows smoke test. |
| Live Wayback response shapes | Read-only cloud HTTP requests for example.org | CDX on web.archive.org returned capture rows. The Firefox API CDX host returned 403. Sparkline returned JSON. Browser-to-live-service behavior remains unverified. |
| Archive.today and dual save | Linux Firefox 115.43 with mocked provider navigation and intercepted Wayback submission | Passed opt-in, Private Mode, persisted count limit, mirror selection, and the same URL sent to both flows. Direct capture completion on Archive.today remains provider-controlled. |
| Settings tab and custom auto-save interval | Opened the manifest options page on Firefox 115.43 and edited the interval using the shared controls | Persisted a 12-hour interval without enabling auto-save. Rejected an invalid interval and kept the last valid setting. |
| Unsigned installation | Mozilla documentation and ESR 115 source | Temporary load verified. Persistent ESR signature-preference route remains untested here. |
| SPN resume | Session-based recovery and bounded polling in the event page | No timer permission. A future popup or event can wake the background. Browser restart discards pending status records. Live SPN and suspension during a real job require manual testing. |
| Newer APIs and Chromium | Code review and linter | Uses AbortController, session storage on Firefox 115 and plain CSS. This batch was not exercised in Chromium. |
