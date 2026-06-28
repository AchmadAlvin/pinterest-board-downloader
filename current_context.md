# Current Context & Architecture State
As of June 28, 2026 — 22:06

## 1. Project Overview
A Chrome/Brave browser extension that downloads all pins (images + videos) from a Pinterest board. Key files:
- `manifest.json` — MV3 manifest. Content script = `client.js` + `gsap.min.js`. Background = `background.js`. Harvester = `harvester.js` (web_accessible_resources, runs in MAIN world).
- `harvester.js` — Runs in the MAIN world (page context). Continuously traverses React Fiber, `__APOLLO_CLIENT__`, `__PWS_DATA__`, `__PWS_INITIAL_PROPS__` every 150ms to build `window.__PBDL_PIN_CACHE` (pin_id → [media_urls]).
- `client.js` — Content script (ISOLATED world). UI, pin selection, metadata extraction, download orchestration. ~2454 lines.
- `background.js` — Service Worker. Handles `download_pin` (standard download) and `download_and_probe` (download + MIME check) actions. ~104 lines.

## 2. Data Flow: How Pins Get Downloaded
1. **Observation Phase**: MutationObserver watches for `[data-test-id="pin"]` DOM nodes. For each pin, stores `{ url, image_url, media_urls: [], has_video }` in `selected_pins` Map.
2. **Metadata Extraction Phase** (`initialize_downloads` → `fetch_pin_media`):
   a. First calls `extract_memory_pins()` — messages the MAIN world harvester via `window.postMessage`, receives `PINTEREST_STORE_DATA` with the `__PBDL_PIN_CACHE`.
   b. For each pin, checks `memory_cached_pins[pin_id]` first (from harvester).
   c. If not cached, calls Pinterest API: `PinResource/get` with `field_set_key: "detailed"` then `"unauth_react_main_pin"`.
   d. If API fails, falls back to HTML extraction (fetches `/pin/{id}/` and parses Relay blocks, `__PWS_DATA__`, `__PWS_INITIAL_PROPS__`).
   e. From the pin data, extracts media in priority order: Story Pin pages → Carousel slots → Regular video → video_urls field → Images.
3. **Download Phase** (`download_pins`):
   - For each item, if `media_url` starts with `fallback||`, splits into array and uses `download_and_probe` action (Download Manager Probe).
   - Otherwise uses `download_pin` action (direct download).
   - If download fails with `fallback: true`, falls back to `item.image_url` (thumbnail).

## 3. The Core Bug: Videos Downloaded as JPG
### Symptoms
- Out of 51 pins on a test board ("Motion inspiration"), the user reports only 5 are actual images. The rest (~46) should be videos.
- However, the extension downloads ~22 files as JPG and only ~25 as MP4.
- Specific example: pin `a92a22ee199f180ea96cc600ae736b23` is a video but gets downloaded as `.jpg`.

### Root Cause Analysis
The problem has multiple layers:

#### Layer 1: Harvester Extraction Quality
`harvester.js` runs in MAIN world and traverses React Fiber. It looks for `video_list` in pin objects. If the pin data in React Fiber doesn't contain `video_list` (because Pinterest only provides HLS `.m3u8` URLs for some videos, or the data simply isn't in the Fiber tree at that moment), the harvester either:
- Returns only the `.m3u8` URL (which gets synthesized to `fallback||...`)
- Returns nothing (pin falls through to image)

#### Layer 2: client.js `fetch_pin_media` API Extraction
When the memory cache doesn't have the pin, `client.js` calls the Pinterest API. The `extract_best_video` function in `client.js` (line 1533) has a quality order that checks for direct `.mp4` URLs first. If only `.m3u8` is available, it synthesizes a `fallback||` string with guessed `.mp4` paths.

**Critical issue**: The quality order in client.js is `['V_720P', 'V_1080P', ...]` while harvester.js uses `['V_1080P', 'V_720P', ...]`. This inconsistency is minor but notable.

#### Layer 3: The "fallback||" Synthesized URL Problem
When a video only has `.m3u8` streams, the code synthesizes URLs like:
```
fallback||https://v1.pinimg.com/videos/iht/1080p/hash.mp4||.../720p/hash.mp4||...
```
These synthesized URLs are **guesses**. The `download_and_probe` system in `background.js` tries to download each one, checks the MIME type, and cancels if it's XML/HTML (a 403 error page). If ALL synthesized URLs fail, the extension falls back to the image thumbnail.

**The fundamental problem**: Pinterest's CDN does NOT serve `.mp4` files for many videos. They only serve HLS (`.m3u8` + `.ts` segments). The synthesized URL guessing approach fails for these videos because no `.mp4` file exists on the server.

#### Layer 4: Carousel Videos
The carousel extraction code (line 1601-1608) only extracts **images** from carousel slots:
```javascript
if (slot.images?.originals?.url) {
    media_urls.push(slot.images.originals.url);
}
```
It does NOT check for `slot.videos` or `slot.video` at all! If a carousel contains video slides, they get downloaded as their image thumbnails.

#### Layer 5: Memory Cache Returning Image URLs
The harvester stores URLs in `__PBDL_PIN_CACHE`. When `fetch_pin_media` finds the pin in `memory_cached_pins`, it returns those URLs directly (line 1385-1387) **without ever checking the API**. If the harvester only found the image URL (because the video data wasn't in the Fiber tree at scan time), the pin gets stuck as an image forever.

## 4. Previous Fix Attempts (Chronological)
1. **XML download bug** — Videos downloading as XML DASH manifests. Fixed by filtering `.xml`/`.mpd` extensions.
2. **m3u8 synthesizer** — Added/removed/restored multiple times. Current: synthesize `fallback||` URL array.
3. **HEAD→GET probe** — AWS WAF blocks HEAD requests. Changed to GET.
4. **DOM video probe** — Tried using `<video>` elements to probe URLs. Failed due to Chrome media suspension policies.
5. **Fetch probe (client.js)** — CORS blocks content script fetch to pinimg.com CDN.
6. **Download Manager Probe** — Current approach. Downloads file, checks MIME, cancels if XML. Works but can't help if no `.mp4` exists.

## 5. Key Architectural Decisions
- Extension uses MV3 (service worker, not persistent background page).
- Harvester runs in MAIN world (page context) to access React internals.
- Client.js runs in ISOLATED world (content script context).
- Communication between worlds via `window.postMessage`.
- Downloads go through `chrome.runtime.sendMessage` → background.js → `chrome.downloads.download`.

## 6. Files Summary

### harvester.js (235 lines)
- `extract_best_video(video_list, root_cache)` — Finds best MP4 from video_list, synthesizes fallback if only m3u8.
- `searchForPins(obj, depth, root_cache)` — Recursive traversal of React data structures.
- Runs on 150ms interval, traverses Apollo cache, PWS_DATA, React Fiber.

### client.js (~2454 lines)
- Pin observation, selection, UI rendering (GSAP animations).
- `extract_memory_pins()` — Requests data from harvester via postMessage.
- `fetch_pin_media(pin_slug)` — Memory cache → API → HTML fallback pipeline.
- `initialize_downloads()` — Orchestrates metadata extraction + download.
- `download_pins(items)` — Chunked concurrent download with fallback logic.

### background.js (104 lines)
- `download_pin` — Direct download or multi-URL probe via fetch.
- `download_and_probe` — Download + MIME type validation + auto-cancel.
