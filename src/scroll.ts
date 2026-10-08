import { showToast } from "./toast";

const VELOCITY = 1500; // px/s while key held
const SLOW_VELOCITY = 300; // px/s for slow scroll (J/K)
const DECEL = 15000; // px/s² linear deceleration after keyup (~100ms coast)

let vel = 0; // current velocity, signed (px/s)
let active = false; // is scroll key currently held
let lastTime = 0;
let rafId: number | null = null;

export function startScroll(direction: 1 | -1, slow = false): void {
  vel = direction * (slow ? SLOW_VELOCITY : VELOCITY);
  active = true;
  if (rafId !== null) return; // already ticking
  lastTime = performance.now();
  rafId = requestAnimationFrame(tick);
}

export function stopScroll(): void {
  active = false; // tick() will decelerate and stop
}

export function scrollToTop(): void {
  vel = 0;
  active = false;
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  window.scrollTo({ top: 0, behavior: "instant" });
}

export function scrollToBottom(): void {
  vel = 0;
  active = false;
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
}

// Not keyed by URL: one slot per origin (localStorage is per-origin)
const SCROLL_POS_KEY = "bs-scroll-pos";

let confirmEl: HTMLElement | null = null;

// Confirm before overwriting, ms is easy to hit by accident. Enter/y saves, Escape/n/q cancels.
export function saveScrollPos(): void {
  if (confirmEl) return;
  const y = Math.round(window.scrollY);

  confirmEl = document.createElement("div");
  confirmEl.id = "bs-cookieconfirm-backdrop";
  const dialog = document.createElement("div");
  dialog.id = "bs-cookieconfirm";
  const header = document.createElement("div");
  header.id = "bs-cookieconfirm-header";
  header.textContent = `Save scroll position (${y}px)? Overwrites the saved one.`;
  const footer = document.createElement("div");
  footer.id = "bs-cookieconfirm-footer";
  const hint = document.createElement("span");
  hint.id = "bs-cookieconfirm-count";
  hint.textContent = "Enter / y — save, Esc / n — cancel";
  const btnCancel = document.createElement("button");
  btnCancel.className = "bs-cookieconfirm-btn";
  btnCancel.textContent = "Cancel";
  const btnSave = document.createElement("button");
  btnSave.className = "bs-cookieconfirm-btn bs-cookieconfirm-btn-danger";
  btnSave.textContent = "Save";
  footer.append(hint, btnCancel, btnSave);
  dialog.append(header, footer);
  confirmEl.appendChild(dialog);

  const close = (save: boolean): void => {
    confirmEl?.remove();
    confirmEl = null;
    window.removeEventListener("keydown", onKey, true);
    if (save) writeScrollPos();
  };
  function onKey(e: KeyboardEvent): void {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === "Enter" || e.key === "y") close(true);
    else if (e.key === "Escape" || e.key === "n" || e.key === "q") close(false);
  }

  btnCancel.addEventListener("click", () => close(false));
  btnSave.addEventListener("click", () => close(true));
  confirmEl.addEventListener("click", (e) => { if (e.target === confirmEl) close(false); });
  window.addEventListener("keydown", onKey, true);
  document.documentElement.appendChild(confirmEl);
}

function writeScrollPos(): void {
  try {
    localStorage.setItem(SCROLL_POS_KEY, JSON.stringify({ x: window.scrollX, y: window.scrollY }));
    showToast(`Scroll position saved (${Math.round(window.scrollY)}px)`, "");
  } catch {
    showToast("Can't save scroll position", "");
  }
}

export function goScrollPos(): void {
  let pos: { x: number; y: number } | null = null;
  try {
    const raw = localStorage.getItem(SCROLL_POS_KEY);
    if (raw) pos = JSON.parse(raw) as { x: number; y: number };
  } catch { /* ignore */ }
  if (!pos) { showToast("No saved scroll position", ""); return; }
  vel = 0;
  active = false;
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  window.scrollTo({ left: pos.x, top: pos.y, behavior: "instant" });
}

function tick(now: number): void {
  const dt = Math.min(now - lastTime, 50) / 1000; // seconds, cap for tab switch
  lastTime = now;

  if (!active) {
    const sign = Math.sign(vel);
    vel -= sign * DECEL * dt;
    if (Math.sign(vel) !== sign) {
      // crossed zero → done
      vel = 0;
      rafId = null;
      return;
    }
  }

  window.scrollBy(0, vel * dt);
  rafId = requestAnimationFrame(tick);
}
