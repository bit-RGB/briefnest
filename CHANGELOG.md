# Changelog

## 0.1.5 — Preview branch

- Add GitHub Trending with the source page's repository order, daily/weekly/monthly snapshots, and monthly selected on entry. Stars are informational only.
- Retain the last successful snapshot on collection failure. Favorites are shared across periods and survive repositories leaving a ranking.
- Drag the category sidebar's right edge to adjust its width; the plugin remembers the final width locally.

## 0.1.4 — Development changes included in the preview

- Replace the right-side preview's dependency on an unpublished host browser capability with a dedicated local Edge browser, using the public plugin REST API for in-memory frames and narrow input operations.
- Keep dedicated login profiles across normal close, process restart and plugin updates. Scope them by the actual backend Hermes home and selected local connection/profile. Never import ordinary browser cookies. Provide confirmed **Clear login data** without deleting news or favorites.
- Preserve the existing pane layout, divider, page scaling and limited-preview fallback. Require a painted current-generation frame before forwarding input; reject stale input without destroying a healthy browser session.
- Add bounded backend requests, cancellation and Windows-owned process-tree cleanup; use an OS mutex for crash-safe profile exclusion and pause new page targets before installing navigation interception.

Real-site QR/SMS login and website-specific expiration remain separate acceptance checks. Website policy can still require signing in again. This is not a tagged release or an approved Hermes catalog version.
