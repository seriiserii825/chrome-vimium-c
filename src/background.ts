(async () => {
  const res = await chrome.storage.local.get("reloadedToast");
  if (!res.reloadedToast) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.reload(tab.id);
})();

chrome.runtime.onMessage.addListener((msg: { type: string; url?: string; currentTabId?: number; targetWindowId?: number; ratio?: number; tabId?: number; quality?: string }, _sender, sendResponse) => {
  const type = msg.type;

  if (type === "searchHistory") {
    chrome.history.search({ text: "", maxResults: 5000, startTime: 0 }, (results) => {
      const items = results
        .sort((a, b) => (b.lastVisitTime ?? 0) - (a.lastVisitTime ?? 0))
        .map((r) => ({ title: r.title || r.url || "", url: r.url || "" }));
      sendResponse({ items });
    });
    return true;
  }

  if (type === "getTabs") {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      const sorted = tabs.filter(t => t.index !== undefined).sort((a, b) => a.index! - b.index!)
      sendResponse({ tabs: sorted.map(t => ({ id: t.id!, title: t.title || '', url: t.url || '', favIconUrl: t.favIconUrl, active: t.active })) })
    })
    return true
  }

  if (type === "switchToTab" && msg.tabId !== undefined) {
    chrome.tabs.update(msg.tabId, { active: true })
    return
  }

  if (type === "getCookies" && msg.url) {
    chrome.cookies.getAll({ url: msg.url }, (cookies) => {
      sendResponse({ cookies: cookies.map(c => ({ name: c.name, value: c.value, domain: c.domain, secure: c.secure, path: c.path })) });
    });
    return true;
  }

  if (type === "deleteCookiesRefresh" && msg.url) {
    (async () => {
      const cookies = await chrome.cookies.getAll({ url: msg.url! });
      await Promise.all(cookies.map(c => {
        const cookieUrl = `${c.secure ? 'https' : 'http'}://${c.domain.startsWith('.') ? c.domain.slice(1) : c.domain}${c.path}`;
        return chrome.cookies.remove({ url: cookieUrl, name: c.name });
      }));
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.id) chrome.tabs.reload(tab.id);
    })();
    return;
  }


  if (type === "getOtherWindowTabs") {
    (async () => {
      const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const allWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
      const windows = allWindows
        .filter(w => w.id !== currentTab.windowId)
        .map(w => ({
          id: w.id!,
          tabs: (w.tabs ?? [])
            .sort((a, b) => a.index - b.index)
            .map(t => ({ id: t.id!, title: t.title || '', url: t.url || '', favIconUrl: t.favIconUrl, active: t.active })),
        }));
      sendResponse({ windows });
    })();
    return true;
  }

  if (type === "moveTabToWindowId" && msg.targetWindowId !== undefined) {
    (async () => {
      const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.move(currentTab.id!, { windowId: msg.targetWindowId!, index: -1 });
      await chrome.tabs.update(currentTab.id!, { active: true });
      await chrome.windows.update(msg.targetWindowId!, { focused: true });
    })();
    return;
  }

  if (type === "moveTabConfirm" && msg.currentTabId !== undefined && msg.targetWindowId !== undefined) {
    (async () => {
      await chrome.tabs.move(msg.currentTabId!, { windowId: msg.targetWindowId!, index: -1 });
      await chrome.tabs.update(msg.currentTabId!, { active: true });
      await chrome.windows.update(msg.targetWindowId!, { focused: true });
    })();
    return;
  }

  if (type === "zoomFitWindow") {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) return;
      if (msg.ratio !== undefined) {
        const current = await chrome.tabs.getZoom(tab.id);
        chrome.tabs.setZoom(tab.id, current * msg.ratio);
      } else {
        chrome.tabs.setZoom(tab.id, 0);
      }
    })();
    return;
  }

  if (type === "zoomFull") {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.id) chrome.tabs.setZoom(tab.id, 1.0);
    })();
    return;
  }

  if (type === "zoomIn" || type === "zoomOut") {
    const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0];
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) return;
      const current = await chrome.tabs.getZoom(tab.id);
      const pct = Math.round(current * 100);
      const idx = ZOOM_STEPS.findIndex(z => Math.round(z * 100) === pct);
      let next: number;
      if (type === "zoomIn") {
        next = idx === -1 ? 1.1 : ZOOM_STEPS[Math.min(idx + 1, ZOOM_STEPS.length - 1)];
      } else {
        next = idx === -1 ? 0.9 : ZOOM_STEPS[Math.max(idx - 1, 0)];
      }
      chrome.tabs.setZoom(tab.id, next);
    })();
    return;
  }

  if (type === "getYoutubeQualities") {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) { sendResponse(null); return; }
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => {
          type YTPlayerGet = { getAvailableQualityLevels(): string[]; getPlaybackQuality(): string } | null;
          const p = document.querySelector('#movie_player') as unknown as YTPlayerGet;
          if (!p?.getAvailableQualityLevels) return null;
          return { levels: p.getAvailableQualityLevels(), current: p.getPlaybackQuality() };
        },
      });
      sendResponse(results?.[0]?.result ?? null);
    })();
    return true;
  }

  if (type === "setYoutubeQuality" && msg.quality) {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) return;
      const q = msg.quality!;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: (quality: string) => {
          type YTPlayerSet = { setPlaybackQualityRange(min: string, max: string): void } | null;
          const p = document.querySelector('#movie_player') as unknown as YTPlayerSet;
          if (p?.setPlaybackQualityRange) p.setPlaybackQualityRange(quality, quality);
        },
        args: [q],
      });
    })();
    return;
  }

  if (type === "openIncognito") {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.url) chrome.windows.create({ url: tab.url, incognito: true });
    })();
    return;
  }

  if (type === "downloadImage" && msg.url) {
    chrome.downloads.download({ url: msg.url });
    return;
  }

  if (type === "openTab" && msg.url) {
    chrome.tabs.create({ url: msg.url, active: false });
    return;
  }

  if (type === "reloadExtension") {
    const TARGET_NAMES = ["Quick Tabs Project", "Figma Copy — Page Order"];

    const selfReload = () => {
      chrome.storage.local.set({ reloadedToast: true }, () => chrome.runtime.reload());
    };

    chrome.management.getAll((extensions) => {
      const targets = extensions.filter((e) => TARGET_NAMES.includes(e.name) && e.id !== chrome.runtime.id);

      if (targets.length === 0) {
        selfReload();
        return;
      }

      let remaining = targets.length;
      targets.forEach((target) => {
        chrome.management.setEnabled(target.id, false, () => {
          chrome.management.setEnabled(target.id, true, () => {
            if (--remaining === 0) selfReload();
          });
        });
      });
    });
    return;
  }

  if (type === "navigateTo" && msg.url) {
    chrome.tabs.create({ url: msg.url, active: true });
    return;
  }

  const knownTypes = new Set(["prevTab","nextTab","moveTabRight","moveTabLeft","duplicateTab","newTab","closeTab","restoreTab","reloadTab","reloadTabHard","closeTabsRight","closeTabsOthers"]);
  if (!knownTypes.has(type)) return;

  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    const sorted = tabs
      .filter(t => t.index !== undefined)
      .sort((a, b) => a.index! - b.index!);
    const activeIdx = sorted.findIndex(t => t.active);
    if (activeIdx === -1) return;
    const len = sorted.length;

    if (type === "prevTab" || type === "nextTab") {
      const target = type === "prevTab"
        ? (activeIdx - 1 + len) % len
        : (activeIdx + 1) % len;
      chrome.tabs.update(sorted[target].id!, { active: true });
    } else if (type === "moveTabRight" || type === "moveTabLeft") {
      const delta = type === "moveTabRight" ? 1 : -1;
      const newIndex = Math.max(0, Math.min(len - 1, activeIdx + delta));
      if (newIndex !== activeIdx) {
        chrome.tabs.move(sorted[activeIdx].id!, { index: newIndex });
      }
    } else if (type === "duplicateTab") {
      chrome.tabs.duplicate(sorted[activeIdx].id!);
    } else if (type === "newTab") {
      chrome.tabs.create({});
    } else if (type === "closeTab") {
      chrome.tabs.remove(sorted[activeIdx].id!);
    } else if (type === "restoreTab") {
      chrome.sessions.restore();
    } else if (type === "reloadTab") {
      chrome.tabs.reload(sorted[activeIdx].id!);
    } else if (type === "reloadTabHard") {
      chrome.tabs.reload(sorted[activeIdx].id!, { bypassCache: true });
    } else if (type === "closeTabsRight") {
      const toClose = sorted.slice(activeIdx + 1).map(t => t.id!);
      if (toClose.length) chrome.tabs.remove(toClose);
    } else if (type === "closeTabsOthers") {
      const toClose = sorted.filter((_, i) => i !== activeIdx).map(t => t.id!);
      if (toClose.length) chrome.tabs.remove(toClose);
    }
  });
});
