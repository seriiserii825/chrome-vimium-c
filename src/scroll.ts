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

export function saveScrollPos(): void {
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
