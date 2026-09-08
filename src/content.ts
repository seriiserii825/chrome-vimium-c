import "./hints.css";
import "./help.css";
import "./prompt.css";
import "./whichkey.css";
import "./cookieconfirm.css";
import "./imageinfo.css";
import "./seoinfo.css";
import "./seoheadings.css";
import "./tabswitcher.css";
import "./timecode.css";
import "./historysearch.css";
import "./findinpage.css";
import { beginHints, typeHint, endHints, unhoverLast, HintSession } from "./hints";
import { beginTabSwitch, typeTabSwitch, endTabSwitch, TabSwitchSession, beginWindowPick, typeWindowPick, endWindowPick, WindowPickSession } from "./tabswitcher";
import { showHelp, hideHelp, isHelpVisible } from "./help";
import { showPrompt, hidePrompt, isPromptVisible } from "./prompt";
import { showWhichKey, hideWhichKey, isWhichKeyVisible } from "./whichkey";
import { showCookieConfirm, hideCookieConfirm, isCookieConfirmVisible } from "./cookieconfirm";
import { hideImageInfo, isImageInfoVisible } from "./imageinfo";
import { showSeoInfo, hideSeoInfo, isSeoInfoVisible } from "./seoinfo";
import { showSeoHeadings, hideSeoHeadings, isSeoHeadingsVisible } from "./seoheadings";
import { showTimecode, hideTimecode, isTimecodeVisible, saveCurrentTimecode, exportTimecodes, importTimecodes, startTimecodeWatcher } from "./timecode";
import { showHistorySearch, hideHistorySearch, isHistorySearchVisible, HistoryEntry } from "./historysearch";
import { showFind, hideFind, isFindVisible } from "./findinpage";
import { applyBestQuality } from "./videoquality";
import { physicalKey } from "./keycode";
import { showToast } from "./toast";
import { writeText } from "./clipboard";
import { startScroll, stopScroll, scrollToTop, scrollToBottom } from "./scroll";
import mappings from "../maps.csv";

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
  | "goUpUrl"
  | "goRootUrl"
  | "goExtensions"
  | "goExtensionShortcuts"
  | "goDownloads"
  | "goWpAdmin"
  | "yankPageId"
  | "historyBack"
  | "historyForward"
  | "prevTab"
  | "nextTab"
  | "moveTabRight"
  | "moveTabLeft"
  | "duplicateTab"
  | "newTab"
  | "closeTab"
  | "restoreTab"
  | "reloadTab"
  | "reloadTabHard"
  | "closeTabsRight"
  | "closeTabsOthers"
  | "yankText"
  | "yankLinkUrl"
  | "yankInputText"
  | "yankMultiText"
  | "yankMultiInputText"
  | "openMultiLinks"
  | "followMultiClick"
  | "hoverElement"
  | "showHelp"
  | "editUrlCurrentTab"
  | "editUrlNewTab"
  | "downloadImage"
  | "copyImage"
  | "copySvg"
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
  | "showSeoInfo"
  | "showSeoHeadings"
  | "inputEdit"
  | "inputClearEdit"
  | "inputEditStart"
  | "zoomFitWindow"
  | "zoomFull"
  | "zoomIn"
  | "zoomOut"
  | "followFormControl"
  | "goToTab"
  | "seekTimecode"
  | "saveTimecode"
  | "exportTimecodes"
  | "importTimecodes"
  | "speedUp"
  | "speedDown"
  | "videoQuality"
  | "videoFullscreen"
  | "openVideoNewTab"
  | "showHistory"
  | "findInPage"
  | "reloadExtension";

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
  yankLinkUrl: () => {
    session = beginHints("yl");
  },
  yankInputText: () => {
    session = beginHints("yi");
  },
  yankMultiText: () => {
    session = beginHints("ym");
  },
  yankMultiInputText: () => {
    session = beginHints("ymi");
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
    showHelp(mappings);
  },
  downloadImage: () => { session = beginHints("di"); },
  copyImage:     () => { session = beginHints("ci"); },
  copySvg:       () => { session = beginHints("cs"); },
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
      showHistorySearch(items, (url, newTab) => {
        if (newTab) chrome.runtime.sendMessage({ type: "navigateTo", url });
        else window.location.href = url;
      });
    });
  },
  findInPage: () => { showFind(); },
  scrollToTop: scrollToTop,
  scrollToBottom: scrollToBottom,
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
  goWpAdmin: () => {
    const postId = extractWpPostId();
    if (!postId) { showToast("WP post id not found", ""); return; }
    window.location.href = `${window.location.origin}/wp-admin/post.php?post=${postId}&action=edit`;
  },
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
  closeTab:         () => { chrome.runtime.sendMessage({ type: "closeTab" }) },
  restoreTab:       () => { chrome.runtime.sendMessage({ type: "restoreTab" }) },
  reloadTab:        () => { chrome.runtime.sendMessage({ type: "reloadTab" }) },
  reloadTabHard:    () => { chrome.runtime.sendMessage({ type: "reloadTabHard" }) },
  closeTabsRight:   () => { chrome.runtime.sendMessage({ type: "closeTabsRight" }) },
  closeTabsOthers:  () => { chrome.runtime.sendMessage({ type: "closeTabsOthers" }) },
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
  showSeoInfo: () => { showSeoInfo(); },
  showSeoHeadings: () => { showSeoHeadings(); },
  inputEdit: () => { session = beginHints("ie"); },
  inputEditStart: () => { session = beginHints("is"); },
  inputClearEdit: () => { session = beginHints("ic"); },
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
  videoQuality: () => { void applyBestQuality() },
  reloadExtension: () => { try { chrome.runtime.sendMessage({ type: "reloadExtension" }) } catch {} },
  videoFullscreen: () => {
    const btn = document.querySelector('.ytp-fullscreen-button') as HTMLElement | null
    btn?.click()
  },
  openVideoNewTab: () => { session = beginHints("oV"); },
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

function dispatchAction(action: Action): void {
  currentCount = countPrefix ? Math.max(1, parseInt(countPrefix, 10)) : 1;
  clearCount();
  actions[action]();
}

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
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock', 'AltGraph'].includes(e.key)) return;

    if (e.ctrlKey || e.metaKey) return;

    const key = physicalKey(e);

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
      if (isHistorySearchVisible()) { hideHistorySearch(); e.preventDefault(); return; }
      if (isFindVisible()) { hideFind(); e.preventDefault(); return; }
      if (isPromptVisible()) { hidePrompt(); return; }
      if (isHelpVisible()) { hideHelp(); return; }
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

startTimecodeWatcher();
