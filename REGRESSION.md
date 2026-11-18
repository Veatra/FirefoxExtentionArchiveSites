# Firefox ESR 115 regression checklist

Use a separate profile and a public test URL you own or have permission to archive. The Linux fixtures described in [COMPAT.md](COMPAT.md) substitute mock replies where indicated. The following interactive flows still need a real Windows smoke test.

| Flow | Check |
| --- | --- |
| Onboarding and settings | Temporarily load, click the action, review and accept the welcome agreement. Check the first-run Settings tooltip, close/reopen, and verify choices persist. |
| SPN and options | Save a public test URL. Check normal, outlinks, screenshot, email results and My Web Archive with an authorized account. Verify clear pending, success, error and overload labels. Open the resource-list window and observe progress and its errors. |
| Offline and background lifecycle | Disconnect before a status check. Reconnect and reopen the popup to wake the event page. Check for resume or a terminal failure and confirm no duplicate submission. Close the originating tab or reload it while polling. |
| Archive navigation | Click Oldest, Newest, Overview, URLs, Collections, Site Map and Word Cloud. Check destination and query. Copy a known snapshot and a latest link, then open the copied URLs. |
| Archive panel | Open with Private Mode on, then off on a public URL. Verify captures and count, test all limits, keyboard navigation, Copy, unsupported URLs and unavailable service. Close while loading and check the Network panel for cancellation. |
| Archive.today and Save to both | Enable a mirror under Settings → General. Confirm that search opens that mirror and the selected URL is preserved with query parameters. For a URL you are allowed to publish, confirm Save to both starts Wayback and opens the provider submission. Switch mirror, check Private Mode and exclusions still block actions, and confirm the popup labels provider availability as unknown. |
| Context | Check Annotations, contextual notices, Wikipedia books and cited papers, an Amazon book and a supported TV news article. Confirm remote text displays literally and links open safe destinations. |
| 404 and badge | Use a known archived site with a missing page to test the toolbar and optional in-page banner. Abort a navigation and confirm no DNS indicator. Switch between tabs, navigate to a new URL, close tabs and check count badge and state cleanup. |
| Auto-save / bookmarks | Turn on auto-save with an authorized public test URL and compare behavior with Private Mode on and off. Grant the existing optional bookmarks permission, bookmark the current URL, and check the same gate. Check custom and built-in exclusions, including mixed-case paths. Set a custom interval with Auto Save Page off and confirm it stays off. Open Settings from the add-on manager and verify the interval and unit persist. |
| Login / logout | Use a test account, validate visible signed-in options, exercise extension logout and website logout. Legacy restoration remains an open item. |
| Menus and view modes | Use page and link context menus and verify New Tab, Same Tab and New Window, including small screens and back-button behavior. |
| Accessibility | Use Tab and Enter for Settings and Archives. Check focus, dark mode SPN text, reduced motion and readable status announcements. |
