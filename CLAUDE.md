# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run build        # type-check + lint + build to dist/
bun run dev          # watch mode (no type-check/lint)
bun run type:check   # tsc --noEmit only
bun run lint         # eslint only
bun run lint:fix     # eslint with auto-fix
```

No tests exist in this project.

**Always run `bun run build` at the end of a coding task** (see the `build` skill in `.claude/skills/build/`). After it passes, remind the user to reload the extension manually in `chrome://extensions`.

To load the extension in Chrome: open `chrome://extensions`, enable Developer mode, click "Load unpacked", and select the `dist/` folder.

## Architecture

This is a Manifest V3 Chrome extension with two independent scripts built from `src/` into `dist/`:

**content.ts** — injected into every page. Owns the keyboard event pipeline: reads hotkey→action mappings from `maps.csv` (parsed at build time into a JS array by a Vite plugin), resolves n-character chord sequences (e.g. `g`, `gg`, `ymv`, `oml`), and dispatches to action handlers. Tab-related actions are forwarded to the background via `chrome.runtime.sendMessage`. In-page actions (scroll, hints, hover, help, prompt) are handled directly.

**background.ts** — service worker. Receives messages from content and executes them using `chrome.tabs` / `chrome.sessions` / `chrome.downloads` APIs. Message types: `openTab`, `navigateTo`, `downloadImage`, plus the standard tab management types in `knownTypes`.

**Hotkey system** — `maps.csv` is the single source of truth for all keybindings. Columns: `hotkey`, `action`, `description`, `group`. Hotkeys support:
- Single keys: `f`, `G`, `x`
- N-char chords: `gg`, `yv`, `ymv`, `oml` (prefix keys are auto-detected at build time)
- Alt combos: `A-h` prefix notation (e.g. `A-h` = Alt+H)

The `group` column is used by the help popup (`help.ts`) for display grouping. Defined groups: `scroll`, `history`, `click`, `copy`, `svg`, `image`, `url`, `tab`, `seo`, `input`, `zoom`, `timecode`, `video`, `find`, `dev`.

Adding a new action requires: a new row in `maps.csv`, a new entry in the `Action` union type in `content.ts`, and a handler in the `actions` record. For background actions, also handle the message type in `background.ts`.

**Hints system** (`hints.ts`) — activated by various keys. Overlays labeled `<div>` nodes at viewport coordinates. Labels use home-row chars (`sadfjklewcmpgh`), single-char for ≤14 elements, two-char pairs beyond that. `typeHint` filters visible hints on each keypress; `endHints` removes the container.

Hint placement: each hint is placed at the element's own `getBoundingClientRect()` top-left. `getClickable()` excludes elements inside `<svg>` from the cursor-pointer check (they only inherit cursor and are not independently clickable), preventing duplicate stacked hints on icon buttons.

Hint modes (hotkeys are from `maps.csv` — check there for the authoritative list):
- `f` — follow link (click) in current tab
- `F` — follow link in new tab
- `c` — toggle checkbox / radio / select
- `oml` — open multiple links in background tabs (Enter to finish)
- `C` — multi-click: click multiple elements then Enter
- `yv` — copy element `innerText` to clipboard
- `yl` — copy link `href` to clipboard
- `yi` — copy input/textarea value (or placeholder if empty)
- `ymv` — multi-select copy: accumulate text from multiple elements, Enter to copy all joined by `\n`
- `Tc` / `Tmc` — copy table column / multiple table columns
- `A-h` — hover element: activates CSS `:hover` via stylesheet rewriting + dispatches JS mouse events up ancestor chain
- `Id` — download image via `chrome.downloads`
- `Ic` — copy image to clipboard as PNG blob (canvas approach for cross-origin, when `navigator.clipboard.write` is available); falls back to `execCommand('copy')` via a `Range` selection on the `<img>` element on HTTP pages or when the canvas/CORS path fails
- `Io` — open image src in new tab
- `Sc` — copy SVG code to clipboard; only top-level `<svg>` elements get hints (nested SVGs excluded)
- `Ii` — show image info popup (dimensions, file size, type)

**Hover system** (`hints.ts`) — `A-h` activates hover mode. Two-pronged approach:
1. CSS injection: reads all page stylesheets, rewrites `:hover` → `[data-bs-hover]`, injects as `<style>` tag, adds `data-bs-hover` attribute to target and ancestors. Handles CSS `:hover` effects (e.g. WordPress row-actions).
2. JS events: dispatches `mouseenter` (non-bubbling) on each ancestor from root to target, then `mouseover` + `mousemove` on target. Handles JS event listener-based hover effects (e.g. Vue `@mouseenter`).
Escape calls `unhoverLast()` which reverses both.

**Help popup** (`help.ts` / `help.css`) — `?` opens a centered modal listing all hotkeys from `maps.csv` in a 2-column grid. Escape / click backdrop / `×` closes it.

**Prompt** (`prompt.ts` / `prompt.css`) — reusable inline input popup. `showPrompt(label, initialValue, onConfirm)`. Used by `ue` (edit URL → current tab) and `uE` (edit URL → new tab). Enter confirms, Escape cancels.

**Scroll** (`scroll.ts`) — physics-based: constant velocity while key held, linear deceleration after keyup via `requestAnimationFrame`. `scrollToTop`/`scrollToBottom` cancel any in-flight animation before calling `window.scrollTo`.

**WhichKey** (`whichkey.ts`) — after typing a prefix key (e.g. `y`, `o`, `v`), a panel appears at the bottom of the screen showing all available continuations. Grouped by next character; shows the description if the key is complete, or a `…` indicator if deeper chords exist. Dismissed on Escape or when the chord resolves.

**Tab switcher** (`tabswitcher.ts`) — `tg` opens a visual overlay of all tabs in the current window, each labeled with a hint character. Typing a label activates that tab. `tw` (moveTabToWindow) opens a similar overlay for picking which window to move the current tab to — this uses `picker.ts` / `picker.html` rendered in a popup window via `chrome.windows.create`.

**Timecode** (`timecode.ts`) — YouTube-specific. `vc` opens a prompt to seek to a `HH:MM:SS` timestamp. `vs` saves the current position with a name prompt. `ve`/`vi` export/import timecodes as JSON. Entries are stored in `localStorage` under `bs-timecodes`, keyed by YouTube video ID, max 30 per video. `startTimecodeWatcher()` runs a 500ms interval: when `video.currentTime` naturally reaches a saved timecode, the video pauses and a popup appears asking to Continue or Stay. Seeking to a timecode manually (via the list) pre-marks it in `firedSeconds` so the watcher doesn't fire. Seeking backwards more than 3 seconds re-arms timecodes that are now in the future. Timecode entries are deleted with `Delete` key only (not Backspace).

**SEO tools** — `sh` (`seoinfo.ts`) shows a panel with meta title, description, og/twitter tags, and canonical URL. `st` (`seoheadings.ts`) shows the heading structure (h1–h3) as an outline panel. Both panels close on Escape or a second keypress.

**Cookie confirm** (`cookieconfirm.ts`) — `dc` shows a confirmation dialog before deleting all cookies for the current domain and reloading. Prevents accidental logouts.

**Image info** (`imageinfo.ts`) — `Ii` hint mode shows a popup with image dimensions, file size, and MIME type fetched via a `HEAD` request.

**Video quality / fullscreen** (`videoquality.ts`) — `vq` shows a quality picker for the current `<video>` element if it exposes quality levels. `vf` toggles fullscreen (clicks `.ytp-fullscreen-button`, YouTube-specific). `vu`/`vd` adjust playback rate by ±0.25; current rate shown via a toast notification. `vo` places hints on every visible `<video>` element on the page (hint mode `oV`, mirroring `Io` for images); selecting one opens its `currentSrc`/`src` in a new tab via background `navigateTo`, or shows a toast if the source is a `blob:` URL (e.g. YouTube's MSE-backed video has no directly fetchable URL).

**Zoom** — `zw` resets zoom to fit the page width; `zf` resets to 100%; `zi`/`zo` zoom in/out. All send messages to background which calls `chrome.tabs.setZoom`.

**Input focus** — `ie` focuses an input and places cursor at start; `ia` at end; `ic` clears and focuses. These use hint overlays to select the target input/textarea.

**Build** — Vite handles `content.ts` (IIFE, with all CSS inlined). `background.ts` and `picker.ts` are built separately via esbuild in the `closeBundle` hook (Vite's Rollup pipeline can't produce MV3-compatible service workers or popup scripts directly). `manifest.json`, `picker.html`, and icons are copied as-is. `er` hotkey sends `reloadExtension` to the background, which calls `chrome.runtime.reload()` to reload the extension without opening `chrome://extensions`.

## Source files

| File | Purpose |
|------|---------|
| `content.ts` | Keyboard pipeline, action dispatch |
| `background.ts` | Tab/download/navigation API calls (service worker) |
| `picker.ts` + `picker.html` | Popup window for window-pick UI (`W` action) |
| `hints.ts` | All hint modes + hover logic |
| `tabswitcher.ts` | Tab/window picker overlays (`tg`, `tw`) |
| `whichkey.ts` | Prefix key disambiguation panel |
| `scroll.ts` | Physics scroll |
| `timecode.ts` | YouTube timecode save/seek/export/import |
| `videoquality.ts` | Video quality picker + fullscreen + speed |
| `seoinfo.ts` | SEO meta info panel |
| `seoheadings.ts` | Heading structure panel |
| `imageinfo.ts` | Image info popup (dimensions, size, type) |
| `cookieconfirm.ts` | Delete-cookies confirmation dialog |
| `help.ts` | Keyboard shortcuts popup |
| `prompt.ts` | Reusable input prompt popup |
| `toast.ts` | Toast notifications |
| `clipboard.ts` | `writeText()` helper — uses `navigator.clipboard` when available, falls back to `execCommand('copy')` for HTTP pages |
| `maps.csv` | All keybindings (single source of truth) |
| `maps.d.ts` | TypeScript type for CSV import |
