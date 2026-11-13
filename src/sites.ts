// Per-site on/off. Hostnames where the extension's hotkeys are switched off live in
// chrome.storage.local (shared across sites and frames), toggled from the page (`ed`),
// the Alt+Shift+V command or the toolbar icon's context menu (both work while disabled).
export const DISABLED_SITES_KEY = "bs-disabled-sites";

export function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "file:" ? u.hostname || "file" : null;
  } catch {
    return null;
  }
}

export async function getDisabledSites(): Promise<string[]> {
  const res = await chrome.storage.local.get(DISABLED_SITES_KEY);
  return Array.isArray(res[DISABLED_SITES_KEY]) ? res[DISABLED_SITES_KEY] : [];
}

/** Flips `host` in the list; returns true when the site is now disabled. */
export async function toggleSite(host: string): Promise<boolean> {
  const list = await getDisabledSites();
  const disabled = !list.includes(host);
  const next = disabled ? [...list, host].sort() : list.filter((h) => h !== host);
  await chrome.storage.local.set({ [DISABLED_SITES_KEY]: next });
  return disabled;
}
