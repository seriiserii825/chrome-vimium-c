// Full-page screenshot (Sp): scroll the top frame viewport by viewport, captureVisibleTab
// each step, stitch on an OffscreenCanvas in the service worker, download as JPEG.

// Chrome canvas limit is 32767 px per side; stay below it.
const MAX_CANVAS_PX = 32000;
// captureVisibleTab is rate-limited (MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND = 2).
const CAPTURE_INTERVAL_MS = 550;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PageInfo { total: number; vh: number; title: string; }

async function run<T, A extends unknown[]>(tabId: number, func: (...args: A) => T, args: A): Promise<T> {
  const [res] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func, args });
  return res.result as T;
}

function pagePrepare(): PageInfo {
  const de = document.documentElement;
  const w = window as unknown as Record<string, unknown>;
  w.__bsShot = { x: window.scrollX, y: window.scrollY, behavior: de.style.scrollBehavior };
  de.style.scrollBehavior = "auto";
  const total = Math.max(de.scrollHeight, document.body?.scrollHeight ?? 0);
  return { total, vh: window.innerHeight, title: document.title };
}

function pageScrollTo(y: number): number {
  window.scrollTo(0, y);
  return window.scrollY;
}

// After the first frame: hide fixed/sticky elements so headers don't repeat in every segment.
function pageHideFixed(): void {
  const hidden: [HTMLElement, string][] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    const pos = getComputedStyle(el).position;
    if (pos === "fixed" || pos === "sticky") {
      hidden.push([el, el.style.visibility]);
      el.style.setProperty("visibility", "hidden", "important");
    }
  }
  (window as unknown as Record<string, unknown>).__bsShotHidden = hidden;
}

function pageRestore(): void {
  const w = window as unknown as Record<string, unknown>;
  const hidden = (w.__bsShotHidden ?? []) as [HTMLElement, string][];
  for (const [el, v] of hidden) el.style.visibility = v;
  const s = w.__bsShot as { x: number; y: number; behavior: string } | undefined;
  if (s) {
    window.scrollTo(s.x, s.y);
    document.documentElement.style.scrollBehavior = s.behavior;
  }
  delete w.__bsShot;
  delete w.__bsShotHidden;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:${blob.type};base64,${btoa(bin)}`;
}

function fileName(title: string): string {
  const name = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 150);
  return `${name || "page"}.jpg`;
}

export async function captureFullPage(tabId: number, windowId: number): Promise<{ ok: boolean; file?: string; truncated?: boolean; error?: string }> {
  let prepared = false;
  try {
    const info = await run(tabId, pagePrepare, []);
    prepared = true;

    let canvas: OffscreenCanvas | null = null;
    let ctx: OffscreenCanvasRenderingContext2D | null = null;
    let scale = 1;
    let height = 0;
    let truncated = false;
    let lastCapture = 0;

    for (let y = 0, i = 0; y < info.total; y += info.vh, i++) {
      const actualY = await run(tabId, pageScrollTo, [y]);
      if (i === 1) await run(tabId, pageHideFixed, []);
      const wait = Math.max(150, CAPTURE_INTERVAL_MS - (Date.now() - lastCapture));
      await sleep(wait);
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
      lastCapture = Date.now();
      const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());

      if (!canvas) {
        scale = bmp.height / info.vh;
        height = Math.round(info.total * scale);
        if (height > MAX_CANVAS_PX) { height = MAX_CANVAS_PX; truncated = true; }
        canvas = new OffscreenCanvas(bmp.width, height);
        ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      const top = Math.round(actualY * scale);
      const bmpH = bmp.height;
      ctx!.drawImage(bmp, 0, top);
      bmp.close();
      if (top + bmpH >= height) break;
      if (actualY + info.vh >= info.total) break;
    }

    await run(tabId, pageRestore, []);
    prepared = false;

    const blob = await canvas!.convertToBlob({ type: "image/jpeg", quality: 0.92 });
    const file = fileName(info.title);
    await chrome.downloads.download({ url: await blobToDataUrl(blob), filename: file, saveAs: false, conflictAction: "uniquify" });
    return { ok: true, file, truncated };
  } catch (err) {
    if (prepared) await run(tabId, pageRestore, []).catch(() => {});
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }
}
