import "./hints.css";
import "./help.css";
import "./prompt.css";
import "./whichkey.css";
import "./cookieconfirm.css";
import "./imageinfo.css";
import "./seoinfo.css";
import "./seoheadings.css";
import "./seorel.css";
import "./tabswitcher.css";
import "./timecode.css";
import "./historysearch.css";
import "./findinpage.css";
import "./projects.css";
import { beginHints, typeHint, endHints, unhoverLast, HintSession } from "./hints";
import { beginTabSwitch, typeTabSwitch, endTabSwitch, TabSwitchSession, beginWindowPick, typeWindowPick, endWindowPick, WindowPickSession } from "./tabswitcher";
import { showHelp, hideHelp, isHelpVisible } from "./help";
import { showPrompt, hidePrompt, isPromptVisible } from "./prompt";
import { showWhichKey, hideWhichKey, isWhichKeyVisible } from "./whichkey";
import { showCookieConfirm, hideCookieConfirm, isCookieConfirmVisible } from "./cookieconfirm";
import { hideImageInfo, isImageInfoVisible } from "./imageinfo";
import { showSeoInfo, hideSeoInfo, isSeoInfoVisible } from "./seoinfo";
import { showSeoHeadings, hideSeoHeadings, isSeoHeadingsVisible } from "./seoheadings";
import { showSeoRelLinks, showSeoBlankLinks, hideSeoRelLinks, isSeoRelLinksVisible } from "./seorel";
import { showTimecode, hideTimecode, isTimecodeVisible, saveCurrentTimecode, goToTime, exportTimecodes, importTimecodes, startTimecodeWatcher } from "./timecode";
import { showHistorySearch, hideHistorySearch, isHistorySearchVisible, HistoryEntry } from "./historysearch";
import { showFind, hideFind, isFindVisible } from "./findinpage";
import { showProjects, isProjectsVisible } from "./projects";
import { applyBestQuality } from "./videoquality";
import { physicalKey } from "./keycode";
import { showToast } from "./toast";
import { showWpPhp, hideWpPhp, isWpPhpVisible, wpAdminUrl } from "./wpphp";
import { toggleWpMigration, resumeWpMigration } from "./wpmigration";
import { uploadWpPlugin, resumeWpNewPlugin } from "./wpnewplugin";
import { makeWpBackup, resumeWpBackup } from "./wpbackup";
import { findInAccess, resumeAccessSearch } from "./accesssearch";
import { writeText, readText } from "./clipboard";
import { DISABLED_SITES_KEY, hostOf, getDisabledSites, toggleSite } from "./sites";
import { startScroll, stopScroll, scrollToTop, scrollToBottom, saveScrollPos, goScrollPos, clearScrollTarget } from "./scroll";
import mappings from "../maps.csv";
import projectsMappings from "../projects-map.csv";

let session: HintSession | null = null;
let tabSession: TabSwitchSession | null = null;
let winSession: WindowPickSession | null = null;

type Action =
  | "followLink"
  | "followLinkNewTab"
  | "scrollDown"
  | "scrollUp"
  | "slowScrollDown"
  | "slowScrollUp"
  | "scrollToTop"
  | "scrollToBottom"
  | "saveScrollPos"
  | "goScrollPos"
  | "goUpUrl"
  | "goRootUrl"
  | "goExtensions"
  | "goExtensionShortcuts"
  | "goDownloads"
  | "goWpAdmin"
  | "goAdminLogin"
  | "showWpPhp"
  | "toggleWpMigration"
  | "copyWpThemeName"
  | "uploadWpPlugin"
  | "makeWpBackup"
  | "findInAccess"
  | "yankPageId"
  | "historyBack"
  | "historyForward"
  | "prevTab"
  | "nextTab"
  | "moveTabRight"
  | "moveTabLeft"
  | "duplicateTab"
  | "newTab"
  | "openClipboardUrl"
  | "yankUrlDomainName"
  | "closeTab"
  | "restoreTab"
  | "reloadTab"
  | "reloadTabHard"
  | "closeTabsRight"
  | "closeTabsOthers"
  | "showProjects"
  | "saveProject"
  | "yankText"
  | "copyInnerHtml"
  | "copyOuterHtml"
  | "yankLinkUrl"
  | "yankInputText"
  | "yankGoogleMapsUrl"
  | "openGoogleMapsUrl"
  | "yankMultiText"
  | "yankMultiInputText"
  | "yankMultiLinkUrl"
  | "yankRangeText"
  | "yankRangeLinkUrl"
  | "openMultiLinks"
  | "followMultiClick"
  | "hoverElement"
  | "showHelp"
  | "editUrlCurrentTab"
  | "editUrlNewTab"
  | "yankUrl"
  | "yankUrlPath"
  | "yankUrlDomain"
  | "downloadImage"
  | "copyImage"
  | "copySvg"
  | "scrollBlock"
  | "openImage"
  | "openIncognito"
  | "moveTabToWindow"
  | "deleteCookiesRefresh"
  | "imageInfo"
  | "copyImagePath"
  | "copyImageName"
  | "copyImageBasename"
  | "copyTableColumn"
  | "copyTableMultiColumn"
  | "pasteTableColumn"
  | "showSeoInfo"
  | "showSeoHeadings"
  | "showSeoRelLinks"
  | "showSeoBlankLinks"
  | "inputEdit"
  | "inputClearEdit"
  | "inputEditStart"
  | "inputPaste"
  | "zoomFitWindow"
  | "zoomFull"
  | "zoomIn"
  | "zoomOut"
  | "followFormControl"
  | "goToTab"
  | "seekTimecode"
  | "saveTimecode"
  | "goToTime"
  | "exportTimecodes"
  | "importTimecodes"
  | "speedUp"
  | "speedDown"
  | "seekBack"
  | "seekForward"
  | "videoQuality"
  | "videoFullscreen"
  | "openVideoNewTab"
  | "yankVideoUrl"
  | "showHistory"
  | "findInPage"
  | "findInFields"
  | "reloadExtension"
  | "toggleSite";

function extractPostIdFromBodyClass(): string | null {
  const bodyClass = document.body.className || "";

  const postIdMatch = bodyClass.match(/\bpostid-(\d+)\b/);
  if (postIdMatch) return postIdMatch[1];

  const pageIdMatch = bodyClass.match(/\bpage-id-(\d+)\b/);
  if (pageIdMatch) return pageIdMatch[1];

  const editLink = document.querySelector<HTMLAnchorElement>("#wp-admin-bar-edit a");
  if (editLink) {
    const hrefMatch = editLink.href.match(/[?&]post=(\d+)/);
    if (hrefMatch) return hrefMatch[1];
  }

  return null;
}

function extractPostIdFromUrl(): string | null {
  const urlMatch = window.location.href.match(/[?&]post=(\d+)\b/);
  if (urlMatch) return urlMatch[1];
  return null;
}

function extractWpPostId(): string | null {
  return extractPostIdFromBodyClass() ?? extractPostIdFromUrl();
}

function extractWpThemeName(): string | null {
  const elements = document.querySelectorAll<HTMLLinkElement | HTMLScriptElement | HTMLImageElement>(
    "link[href*='/wp-content/themes/'], script[src*='/wp-content/themes/'], img[src*='/wp-content/themes/']",
  );
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const url = (el as HTMLLinkElement).href || (el as HTMLScriptElement | HTMLImageElement).src;
    const match = url.match(/\/wp-content\/themes\/([^/]+)\//);
    if (match) return match[1];
  }
  return null;
}

// Injected at build time from ADMIN_PATHS in .env (see vite.config.ts)
const ADMIN_PATHS: string[] = __ADMIN_PATHS__;

// Probes an admin path; returns the URL of the WordPress login form it leads to, or null.
// Status codes can't be trusted (themes serve soft 404 pages with 200, WordPress redirects
// unknown paths), so the response body must contain the login form. Redirects are followed:
// /wp-admin → wp-login.php yields the final wp-login.php URL.
async function probeAdminLogin(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const html = await res.text();
    if (!/name=["']pwd["']/.test(html)) return null;
    const final = new URL(res.url);
    return final.origin + final.pathname;
  } catch {
    return null;
  }
}

// Second-level parts that act as a TLD: "example.co.uk" → "example".
const COMPOUND_TLD_PARTS = new Set(["co", "com", "net", "org", "gov", "edu", "ac"]);

// Bare site name without subdomains and TLD: "api.bludelego.it" → "bludelego".
function domainName(hostname: string): string {
  const parts = hostname.split(".");
  if (parts.length < 2 || /^\d+$/.test(parts[parts.length - 1])) return hostname;
  const compound = parts.length > 2 && COMPOUND_TLD_PARTS.has(parts[parts.length - 2]);
  return parts[parts.length - (compound ? 3 : 2)];
}

// Clipboard text as an http(s) URL; bare domains like "example.com/path" get https://.
function clipboardUrl(text: string): string | null {
  const value = text.trim();
  if (!value || /\s/.test(value)) return null;
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.hostname !== "localhost" && !url.hostname.includes(".")) return null;
    return url.href;
  } catch {
    return null;
  }
}

async function openClipboardUrl(): Promise<void> {
  let text: string;
  try {
    text = await readText();
  } catch {
    showToast("Can't read clipboard", "");
    return;
  }
  const url = clipboardUrl(text);
  if (!url) { showToast("Clipboard is not a URL", ""); return; }
  chrome.runtime.sendMessage({ type: "navigateTo", url });
}

// WordPress install root URL without trailing slash. On localhost the site often lives in a
// subdirectory (http://localhost/site), so admin paths must be appended to it, not to the origin.
function wpBaseUrl(): string {
  const { origin } = window.location;
  const urls = Array.from(document.querySelectorAll<HTMLElement>(
    "link[href*='/wp-content/'], script[src*='/wp-content/'], img[src*='/wp-content/'], " +
    "link[href*='/wp-includes/'], script[src*='/wp-includes/'], link[href*='/wp-json'], " +
    "#wpadminbar a[href], a[href*='/wp-admin/']",
  ), (el) => (el as HTMLLinkElement).href || (el as HTMLScriptElement).src);
  for (const raw of urls) {
    try {
      const url = new URL(raw, window.location.href);
      if (url.origin !== origin) continue;
      const m = url.pathname.match(/^(.*?)\/(?:wp-content|wp-includes|wp-admin|wp-json)(?:\/|$)/);
      if (m) return origin + m[1];
    } catch { /* ignore malformed URL */ }
  }
  return origin;
}

// First admin login path (from ADMIN_PATHS) that serves a login form; falls back to wp-login.php.
async function findAdminLoginUrl(): Promise<string> {
  const base = wpBaseUrl();
  // Probe all paths in parallel, but respect priority order: pick the highest-priority
  // path that works, once all higher ones are known not to
  const checks = ADMIN_PATHS.map((path) => probeAdminLogin(base + path));
  for (const check of checks) {
    const found = await check;
    if (found) return found;
  }
  return `${base}/wp-login.php`;
}

async function goAdminLogin(): Promise<void> {
  showToast("Looking for admin…", "");
  const url = await findAdminLoginUrl();
  chrome.runtime.sendMessage({ type: "navigateTo", url, left: true });
}

// Opens the post editor in a new tab on the left. When the user is not signed in,
// the editor URL is not usable (the admin path may 404 or redirect), so the admin
// login page is opened with redirect_to=<editor>: after sign-in WordPress lands on the editor.
async function goWpPostEdit(): Promise<void> {
  const postId = extractWpPostId();
  if (!postId) { showToast("WP post id not found", ""); return; }
  const editUrl = wpAdminUrl(document, window.location.href, `post.php?post=${postId}&action=edit`).href;
  showToast("Checking WP login…", "");
  let loggedIn = false;
  try {
    const res = await fetch(editUrl, {
      credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(4000),
    });
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const onLogin = new URL(res.url).pathname.endsWith("/wp-login.php") || !!doc.querySelector("#loginform");
    loggedIn = res.ok && !onLogin;
  } catch {
    // Unknown (network error or timeout): the login page with redirect_to is safe either way
  }
  const target = loggedIn
    ? editUrl
    : `${await findAdminLoginUrl()}?redirect_to=${encodeURIComponent(editUrl)}`;
  chrome.runtime.sendMessage({ type: "navigateTo", url: target, left: true });
}

const actions: Record<Action, () => void> = {
  followLink: () => {
    session = beginHints("f", currentCount);
  },
  followFormControl: () => {
    session = beginHints("c");
  },
  followLinkNewTab: () => {
    session = beginHints("F");
  },
  yankText: () => {
    session = beginHints("y");
  },
  copyInnerHtml: () => {
    session = beginHints("hci");
  },
  copyOuterHtml: () => {
    session = beginHints("hco");
  },
  yankLinkUrl: () => {
    session = beginHints("yl");
  },
  yankInputText: () => {
    session = beginHints("yi");
  },
  yankGoogleMapsUrl: () => {
    session = beginHints("ygc");
  },
  openGoogleMapsUrl: () => {
    session = beginHints("ygo");
  },
  yankMultiText: () => {
    session = beginHints("ym");
  },
  yankMultiInputText: () => {
    session = beginHints("ymi");
  },
  yankMultiLinkUrl: () => {
    session = beginHints("yml");
  },
  yankRangeText: () => {
    session = beginHints("ydv");
  },
  yankRangeLinkUrl: () => {
    session = beginHints("ydl");
  },
  openMultiLinks: () => {
    session = beginHints("om");
  },
  followMultiClick: () => {
    session = beginHints("ymf");
  },
  hoverElement: () => {
    session = beginHints("h");
  },
  showHelp: () => {
    showHelp([...mappings, ...projectsMappings]);
  },
  downloadImage: () => { session = beginHints("di"); },
  copyImage:     () => { session = beginHints("ci"); },
  copySvg:       () => { session = beginHints("cs"); },
  scrollBlock:   () => { session = beginHints("sb"); if (!session) showToast("No scrollable blocks", ""); },
  openImage:     () => { session = beginHints("oI"); },
  openIncognito: () => { chrome.runtime.sendMessage({ type: "openIncognito" }) },
  editUrlCurrentTab: () => {
    showPrompt("Open URL in current tab", window.location.href, (url) => {
      window.location.href = url;
    });
  },
  editUrlNewTab: () => {
    showPrompt("Open URL in new tab", window.location.href, (url) => {
      chrome.runtime.sendMessage({ type: "navigateTo", url });
    });
  },
  yankUrl: () => {
    const url = window.location.href;
    writeText(url);
    showToast(url);
  },
  yankUrlPath: () => {
    const path = window.location.pathname;
    writeText(path);
    showToast(path);
  },
  yankUrlDomainName: () => {
    const name = domainName(window.location.hostname);
    writeText(name);
    showToast(name);
  },
  yankUrlDomain: () => {
    const domain = window.location.origin;
    writeText(domain);
    showToast(domain);
  },
  scrollDown: () => {
    startScroll(1);
  },
  scrollUp: () => {
    startScroll(-1);
  },
  slowScrollDown: () => {
    startScroll(1, true);
  },
  slowScrollUp: () => {
    startScroll(-1, true);
  },
  historyBack:    () => { history.back() },
  historyForward: () => { history.forward() },
  showHistory: () => {
    chrome.runtime.sendMessage({ type: "searchHistory" }, (res) => {
      const items: HistoryEntry[] = res?.items ?? [];
      showHistorySearch(items, (url, sameTab) => {
        if (sameTab) window.location.href = url;
        else chrome.runtime.sendMessage({ type: "navigateTo", url });
      });
    });
  },
  findInPage: () => { showFind(); },
  findInFields: () => { showFind("fields"); },
  scrollToTop: scrollToTop,
  scrollToBottom: scrollToBottom,
  saveScrollPos: saveScrollPos,
  goScrollPos: goScrollPos,
  goUpUrl: () => {
    const url = new URL(window.location.href);
    const path = url.pathname.replace(/\/$/, "");
    const up = path.lastIndexOf("/");
    url.pathname = up >= 0 ? path.slice(0, up) + "/" : "/";
    url.search = "";
    url.hash = "";
    window.location.href = url.href;
  },
  goRootUrl: () => {
    window.location.href = window.location.origin + "/";
  },
  goExtensions:         () => { chrome.runtime.sendMessage({ type: "navigateTo", url: "chrome://extensions/" }) },
  goExtensionShortcuts: () => { chrome.runtime.sendMessage({ type: "navigateTo", url: "chrome://extensions/shortcuts" }) },
  goDownloads:          () => { chrome.runtime.sendMessage({ type: "navigateTo", url: "chrome://downloads/" }) },
  goWpAdmin: () => { void goWpPostEdit(); },
  goAdminLogin: () => { void goAdminLogin(); },
  yankPageId: () => {
    const bodyId = extractPostIdFromBodyClass();
    if (bodyId) { writeText(bodyId); showToast(bodyId); return; }

    const urlId = extractPostIdFromUrl();
    if (urlId) { writeText(urlId); showToast(urlId); return; }

    showToast("Not found in body class; not found in URL", "");
  },
  prevTab:      () => { chrome.runtime.sendMessage({ type: "prevTab" }) },
  nextTab:      () => { chrome.runtime.sendMessage({ type: "nextTab" }) },
  moveTabRight: () => { chrome.runtime.sendMessage({ type: "moveTabRight" }) },
  moveTabLeft:  () => { chrome.runtime.sendMessage({ type: "moveTabLeft" }) },
  duplicateTab:     () => { chrome.runtime.sendMessage({ type: "duplicateTab" }) },
  newTab:           () => { chrome.runtime.sendMessage({ type: "newTab" }) },
  openClipboardUrl: () => { void openClipboardUrl(); },
  closeTab:         () => { chrome.runtime.sendMessage({ type: "closeTab" }) },
  restoreTab:       () => { chrome.runtime.sendMessage({ type: "restoreTab" }) },
  reloadTab:        () => { chrome.runtime.sendMessage({ type: "reloadTab" }) },
  reloadTabHard:    () => { chrome.runtime.sendMessage({ type: "reloadTabHard" }) },
  closeTabsRight:   () => { chrome.runtime.sendMessage({ type: "closeTabsRight" }) },
  closeTabsOthers:  () => { chrome.runtime.sendMessage({ type: "closeTabsOthers" }) },
  showProjects:     () => { void showProjects() },
  saveProject:      () => { void showProjects(true) },
  moveTabToWindow: () => {
    chrome.runtime.sendMessage({ type: "getOtherWindowTabs" }, (res) => {
      if (!res?.windows?.length) return;
      winSession = beginWindowPick(res.windows);
    });
  },
  imageInfo: () => {
    session = beginHints("ii");
  },
  copyImagePath: () => {
    session = beginHints("ip");
  },
  copyImageName: () => {
    session = beginHints("in");
  },
  copyImageBasename: () => {
    session = beginHints("ib");
  },
  copyTableColumn: () => { session = beginHints("ctc"); },
  copyTableMultiColumn: () => { session = beginHints("ctmc"); },
  pasteTableColumn: () => { session = beginHints("ptc"); },
  showSeoInfo: () => { showSeoInfo(); },
  showWpPhp: () => { showWpPhp(); },
  toggleWpMigration: () => { toggleWpMigration(); },
  copyWpThemeName: () => {
    const theme = extractWpThemeName();
    if (!theme) { showToast("WP theme not found", ""); return; }
    writeText(theme);
    showToast(theme);
  },
  uploadWpPlugin: () => { uploadWpPlugin(); },
  makeWpBackup: () => { makeWpBackup(); },
  findInAccess: () => { findInAccess(); },
  showSeoHeadings: () => { showSeoHeadings(); },
  showSeoRelLinks: () => { showSeoRelLinks(); },
  showSeoBlankLinks: () => { showSeoBlankLinks(); },
  inputEdit: () => { session = beginHints("ie"); },
  inputEditStart: () => { session = beginHints("is"); },
  inputClearEdit: () => { session = beginHints("ic"); },
  inputPaste: () => { session = beginHints("pi"); },
  zoomFitWindow: () => {
    const contentWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0);
    const ratio = contentWidth > 0 ? window.innerWidth / contentWidth : 1;
    chrome.runtime.sendMessage({ type: "zoomFitWindow", ratio });
  },
  zoomFull:      () => { chrome.runtime.sendMessage({ type: "zoomFull" }) },
  zoomIn:        () => { chrome.runtime.sendMessage({ type: "zoomIn" }) },
  zoomOut:       () => { chrome.runtime.sendMessage({ type: "zoomOut" }) },
  goToTab: () => {
    chrome.runtime.sendMessage({ type: "getTabs" }, (res) => {
      if (!res?.tabs?.length) return;
      tabSession = beginTabSwitch(res.tabs);
    });
  },
  seekTimecode: () => { showTimecode() },
  saveTimecode: () => { saveCurrentTimecode() },
  goToTime: () => { goToTime() },
  exportTimecodes: () => { exportTimecodes() },
  importTimecodes: () => { importTimecodes() },
  speedUp: () => {
    const video = document.querySelector('video')
    if (!video) return
    const rate = Math.min(Math.round((video.playbackRate + 0.25) * 100) / 100, 4)
    video.playbackRate = rate
    showToast(`${rate}×`, 'Speed: ')
  },
  speedDown: () => {
    const video = document.querySelector('video')
    if (!video) return
    const rate = Math.max(Math.round((video.playbackRate - 0.25) * 100) / 100, 0.25)
    video.playbackRate = rate
    showToast(`${rate}×`, 'Speed: ')
  },
  seekBack: () => { seekVideo(-10 * currentCount) },
  seekForward: () => { seekVideo(10 * currentCount) },
  videoQuality: () => { void applyBestQuality() },
  reloadExtension: () => { try { chrome.runtime.sendMessage({ type: "reloadExtension" }) } catch {} },
  toggleSite: () => { if (siteHost) void toggleSite(siteHost) },
  videoFullscreen: () => {
    const btn = document.querySelector('.ytp-fullscreen-button') as HTMLElement | null
    btn?.click()
  },
  openVideoNewTab: () => { session = beginHints("oV"); },
  yankVideoUrl: () => {
    const id = new URLSearchParams(window.location.search).get("v");
    if (!id) { showToast("No YouTube video ID in URL"); return; }
    const url = `https://www.youtube.com/watch?v=${id}`;
    writeText(url);
    showToast(url);
  },
  deleteCookiesRefresh: () => {
    chrome.runtime.sendMessage({ type: "getCookies", url: window.location.href }, (res) => {
      showCookieConfirm(window.location.href, res?.cookies ?? []);
    });
  },
};

// Actions that scroll continuously — need keyup to stop
const continuousActions = new Set<Action>(["scrollDown", "scrollUp", "slowScrollDown", "slowScrollUp"]);

const keyMap = new Map<string, Action>(
  mappings.filter(({ hotkey }) => !hotkey.startsWith("A-")).map(({ hotkey, action }) => [hotkey, action as Action]),
);

const altKeyMap = new Map<string, Action>(
  mappings.filter(({ hotkey }) => hotkey.startsWith("A-")).map(({ hotkey, action }) => [hotkey.slice(2), action as Action]),
);

// All proper prefixes of multi-char hotkeys (e.g. "y", "ym", "g", ">", "<", "d")
const prefixStrings = new Set<string>();
for (const hotkey of keyMap.keys()) {
  for (let i = 1; i < hotkey.length; i++) prefixStrings.add(hotkey.slice(0, i));
}

let pendingPrefix = "";
let prefixTimeout: ReturnType<typeof setTimeout> | null = null;

let countPrefix = "";
let countTimeout: ReturnType<typeof setTimeout> | null = null;
let currentCount = 1;

function clearPending(): void {
  pendingPrefix = "";
  hideWhichKey();
  if (prefixTimeout !== null) {
    clearTimeout(prefixTimeout);
    prefixTimeout = null;
  }
}

function clearCount(): void {
  countPrefix = "";
  if (countTimeout !== null) {
    clearTimeout(countTimeout);
    countTimeout = null;
  }
}

// Panels and overlays open in the top frame: inside an iframe they'd be clipped to it.
// Hints, scrolling, find etc. stay in the frame they were pressed in.
const topFrameActions = new Set<Action>([
  "showProjects", "saveProject", "showHelp", "showHistory", "goToTab",
  "showSeoInfo", "showSeoHeadings", "showSeoRelLinks", "showSeoBlankLinks", "editUrlCurrentTab", "editUrlNewTab",
]);

function formatVideoTime(t: number): string {
  const s = Math.floor(t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function seekVideo(delta: number): void {
  const video = document.querySelector("video");
  if (!video) return;
  const max = Number.isFinite(video.duration) ? video.duration : Infinity;
  video.currentTime = Math.min(Math.max(video.currentTime + delta, 0), max);
  showToast(`${delta > 0 ? "+" : ""}${delta}s → ${formatVideoTime(video.currentTime)}`, "Seek: ");
}

function dispatchAction(action: Action): void {
  currentCount = countPrefix ? Math.max(1, parseInt(countPrefix, 10)) : 1;
  clearCount();
  if (window !== window.top && topFrameActions.has(action)) {
    // Background relays it to frame 0; if that fails (no content script there), run here.
    chrome.runtime.sendMessage({ type: "runInTopFrame", action }, (res) => {
      if (chrome.runtime.lastError || !res?.ok) actions[action]();
    });
    return;
  }
  actions[action]();
}

if (window === window.top) {
  chrome.runtime.onMessage.addListener((msg: { type?: string; action?: string }, _sender, sendResponse) => {
    if (msg.type !== "runAction" || !msg.action || !topFrameActions.has(msg.action as Action)) return;
    // Keyboard focus is still inside the iframe: take it back, or keys typed into the
    // overlay (tab switcher labels etc.) would go to the frame.
    if (document.activeElement?.tagName === "IFRAME") (document.activeElement as HTMLElement).blur();
    window.focus();
    actions[msg.action as Action]();
    sendResponse({ ok: true });
  });
}

// Per-site off switch (see sites.ts). Iframes follow the top page's host, so a site
// is switched off as a whole, embedded frames included.
const siteHost = hostOf(location.ancestorOrigins?.length ? location.ancestorOrigins[location.ancestorOrigins.length - 1] : location.href);
let siteDisabled = false;

function applySiteState(list: string[], notify: boolean): void {
  const disabled = !!siteHost && list.includes(siteHost);
  if (disabled === siteDisabled) return;
  siteDisabled = disabled;
  if (disabled) {
    clearPending();
    clearCount();
    stopScroll();
  }
  if (notify && window === window.top) {
    showToast(disabled ? `off on ${siteHost} (Alt+\\ to enable)` : `on for ${siteHost}`, "Vimium: ");
  }
}

void getDisabledSites().then((list) => applySiteState(list, false));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[DISABLED_SITES_KEY]) {
    const list = changes[DISABLED_SITES_KEY].newValue;
    applySiteState(Array.isArray(list) ? list : [], true);
  }
});

function isEditing(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    (el as HTMLElement).isContentEditable
  );
}

const hookedDocs = new WeakSet<Document>();

document.addEventListener('focusin', (e) => {
  const el = e.target as HTMLElement;
  if (el.tagName !== 'IFRAME') return;
  const iframe = el as HTMLIFrameElement;
  try {
    const doc = iframe.contentDocument;
    if (!doc || hookedDocs.has(doc)) return;
    hookedDocs.add(doc);
    doc.addEventListener('keydown', (ke) => {
      if (ke.key !== 'Escape') return;
      ke.preventDefault();
      ke.stopImmediatePropagation();
      (doc.activeElement as HTMLElement)?.blur();
      iframe.blur();
      window.focus();
    }, { capture: true });
  } catch {}
}, true);

document.addEventListener(
  "keydown",
  (e: KeyboardEvent) => {
    // Alt+\ (toggleSite) is the only key still handled on a disabled site
    if (siteDisabled) {
      if (e.altKey && !e.ctrlKey && !e.metaKey && altKeyMap.get(physicalKey(e)) === "toggleSite") {
        e.preventDefault();
        actions.toggleSite();
      }
      return;
    }
    if (isWpPhpVisible()) {
      if (e.key === "Escape" || e.key === "q") {
        hideWpPhp();
        e.preventDefault();
      }
      return;
    }
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock', 'AltGraph'].includes(e.key)) return;
    // The projects panel handles every key itself, including Escape and Ctrl combos
    if (isProjectsVisible()) return;

    // Ctrl+[ (как в vim) отменяет labels — Escape может перехватить страница (закрыть popup)
    const ctrlBracket = e.ctrlKey && !e.altKey && !e.metaKey && e.code === 'BracketLeft'
      && (session !== null || tabSession !== null || winSession !== null);

    if ((e.ctrlKey || e.metaKey) && !ctrlBracket) return;

    const key = ctrlBracket ? 'Escape' : physicalKey(e);

    if (e.altKey) {
      const action = altKeyMap.get(key);
      if (action) {
        e.preventDefault();
        actions[action]();
      }
      return;
    }

    if (isPromptVisible()) {
      if (e.key === "Escape") { hidePrompt(); e.preventDefault(); }
      return;
    }

    if (winSession) {
      e.preventDefault();
      e.stopPropagation();
      const { result, windowId } = typeWindowPick(winSession, key);
      if (result !== "continue") {
        endWindowPick(winSession);
        winSession = null;
        if (result === "done" && windowId !== undefined) {
          chrome.runtime.sendMessage({ type: "moveTabToWindowId", targetWindowId: windowId });
        }
      }
      return;
    }

    if (tabSession) {
      e.preventDefault();
      e.stopPropagation();
      const { result, tabId } = typeTabSwitch(tabSession, key);
      if (result !== "continue") {
        endTabSwitch(tabSession);
        tabSession = null;
        if (result === "done" && tabId !== undefined) {
          chrome.runtime.sendMessage({ type: "switchToTab", tabId });
        }
      }
      return;
    }

    if (session) {
      e.preventDefault();
      e.stopPropagation();
      const mode = session.mode;
      const result = typeHint(session, key);
      if (result !== "continue") {
        endHints(session);
        session = null;
        // For f/F/c: return focus to page after the hint ends (done or Escape-cancel)
        // Skip blur if a <select> is focused (user may have just opened a dropdown)
        if (mode === 'f' || mode === 'F' || mode === 'c') {
          const active = document.activeElement;
          if (!active || active.tagName.toLowerCase() !== 'select') {
            (active as HTMLElement)?.blur();
            window.focus();
          }
        }
      }
      return;
    }

    if (e.key === "Escape") {
      clearCount();
      if (isTimecodeVisible()) { e.preventDefault(); return; }
      if (isWhichKeyVisible()) { clearPending(); e.preventDefault(); return; }
      if (isCookieConfirmVisible()) { hideCookieConfirm(); e.preventDefault(); return; }
      if (isImageInfoVisible()) { hideImageInfo(); e.preventDefault(); return; }
      if (isSeoInfoVisible()) { hideSeoInfo(); e.preventDefault(); return; }
      if (isSeoHeadingsVisible()) { hideSeoHeadings(); e.preventDefault(); return; }
      if (isSeoRelLinksVisible()) { hideSeoRelLinks(); e.preventDefault(); return; }
      if (isHistorySearchVisible()) { hideHistorySearch(); e.preventDefault(); return; }
      if (isFindVisible()) { hideFind(); e.preventDefault(); return; }
      if (isPromptVisible()) { hidePrompt(); return; }
      if (isHelpVisible()) { hideHelp(); return; }
      if (clearScrollTarget()) { e.preventDefault(); return; }
      (document.activeElement as HTMLElement)?.blur();
      if (window.frameElement) {
        (window.frameElement as HTMLElement).blur();
        window.parent.focus();
      }
      unhoverLast();
      return;
    }

    if (isTimecodeVisible() && key === "q") { hideTimecode(); e.preventDefault(); return; }
    if (isCookieConfirmVisible() && key === "q") { hideCookieConfirm(); e.preventDefault(); return; }
    if (isImageInfoVisible() && key === "q") { hideImageInfo(); e.preventDefault(); return; }
    if (isSeoInfoVisible() && key === "q") { hideSeoInfo(); e.preventDefault(); return; }
    if (isSeoHeadingsVisible() && key === "q") { hideSeoHeadings(); e.preventDefault(); return; }
    if (isSeoRelLinksVisible() && key === "q") { hideSeoRelLinks(); e.preventDefault(); return; }
    if (isHelpVisible() && key === "q") { hideHelp(); e.preventDefault(); return; }

    if (isHelpVisible()) return;
    if (isHistorySearchVisible()) return;
    if (isFindVisible()) return;

    if (isEditing()) return;
    if (e.repeat) return; // ignore OS key-repeat, we handle held keys ourselves

    if (!pendingPrefix && countPrefix === "" && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      countPrefix = e.key;
      if (countTimeout !== null) clearTimeout(countTimeout);
      countTimeout = setTimeout(clearCount, 5000);
      return;
    }
    if (!pendingPrefix && countPrefix !== "" && /^[0-9]$/.test(e.key)) {
      e.preventDefault();
      countPrefix += e.key;
      if (countTimeout !== null) clearTimeout(countTimeout);
      countTimeout = setTimeout(clearCount, 5000);
      return;
    }

    if (pendingPrefix) {
      const combo = pendingPrefix + key;
      if (keyMap.has(combo)) {
        clearPending();
        e.preventDefault();
        dispatchAction(keyMap.get(combo)!);
      } else if (prefixStrings.has(combo)) {
        e.preventDefault();
        pendingPrefix = combo;
        if (prefixTimeout !== null) clearTimeout(prefixTimeout);
        prefixTimeout = setTimeout(clearPending, 5000);
        showWhichKey(pendingPrefix, mappings);
      } else {
        clearPending();
        clearCount();
      }
      return;
    }

    if (prefixStrings.has(key)) {
      e.preventDefault();
      pendingPrefix = key;
      prefixTimeout = setTimeout(clearPending, 5000);
      showWhichKey(pendingPrefix, mappings);
      return;
    }

    const action = keyMap.get(key);
    if (action) {
      e.preventDefault();
      dispatchAction(action);
    } else {
      clearCount();
    }
  },
  true,
);

document.addEventListener(
  "keyup",
  (e: KeyboardEvent) => {
    if (siteDisabled) return;
    const action = keyMap.get(physicalKey(e));
    if (action && continuousActions.has(action)) {
      stopScroll();
    }
  },
  true,
);

chrome.storage.local.get("reloadedToast", (res) => {
  if (res.reloadedToast) {
    chrome.storage.local.remove("reloadedToast");
    showToast("Extension reloaded", "");
  }
});

resumeWpMigration();
resumeWpBackup();
resumeWpNewPlugin();
resumeAccessSearch();
startTimecodeWatcher();
