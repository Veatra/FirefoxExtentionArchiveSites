# Changelog

## Unreleased

- Preserve the v3.2 Email Outlinks choice during upgrade and refresh untouched v3.2 exclusions.

- Add versioned settings backup, merge, and replace.
- Add opt-in local auto-save activity with export and clear controls.
- Clean up orphaned tab records on background wake and retain the save error when a service status check fails.
- Use the abortable request helper for sign-in, account info, annotations, and word cloud requests.

- Add opt-in Archive.today and archive.is search and saving, including Save to both.
- Widen the popup, separate provider results, and add a configurable recent-copy limit in Settings. Show Wayback results as they arrive.
- Add full-tab settings through the add-on manager and an Open in tab button in the popup.
- Add a custom auto-save interval in hours or days and keep interval changes separate from enabling auto-save.
- Keep save feedback separate from the Wayback save button so the next action is clear.

- Raise the Firefox minimum to ESR 115 and load shared background helpers before listeners.
- Screen local and unsupported URL literals, fix case-insensitive and apex exclusion matching, and enforce Private Mode for automatic lookups and saves.
- Serialize per-tab state writes, clean up old tab state, avoid treating canceled navigation as DNS failure, and fix popup window dimensions.
- Render external annotation and book content safely. Validate links and display actual capture dates or a latest-snapshot link.
- Add an opt-in-by-opening Wayback Archives panel with totals, recent capture links, and copy controls.
- Bound count cache size and lifetime. Abort stalled API requests and keep bounded Save Page Now status polling across event-page wakeups in the same browser session.
- Improve SPN status feedback, first-run tooltip handling, and keyboard focus.
