# Cat Break Reminder

A Chrome extension that walks an animated cat onto your active tab to remind you to take a break.

## Load it in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked** and select this folder (`cat-break-reminder/`)
4. Pin the extension and click its icon to set the interval / break duration
5. Click **Test now** to see the cat appear on the current tab

## How it works

- `background.js` (service worker) — uses `chrome.alarms` to fire on the configured interval and tells the active tab to show the cat.
- `content.js` + `content.css` — injected into every web page. When a `SHOW_CAT` message arrives, builds a fixed, top-z-index overlay containing a CSS-drawn cat that walks in from the left, sits center-screen with idle breathing/blinking/tail-flick animations, and walks out when the countdown ends.
- `popup.html` / `popup.js` — settings UI; values stored in `chrome.storage.sync`.

## Limits vs. the desktop version

A Chrome extension can only overlay **web pages**. The cat will not appear on `chrome://` pages, the new-tab page, or non-browser apps. For a true always-on-top desktop pet (overlaying the OS itself, like the video), you need Electron / Tauri / PyQt — the architecture in this extension maps over cleanly.

## Swapping in a real cat asset

Replace `.cbr-cat`'s inner DOM in `content.js` with an `<img>` (transparent APNG/GIF) or `<video>` (WebM with alpha):

```html
<video class="cbr-cat-media" src="cat.webm" autoplay loop muted playsinline></video>
```

Add the file to the extension folder and to `web_accessible_resources` in `manifest.json`:

```json
"web_accessible_resources": [
  { "resources": ["cat.webm"], "matches": ["<all_urls>"] }
]
```

Then reference it as `chrome.runtime.getURL("cat.webm")`.
