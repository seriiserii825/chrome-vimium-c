export function showToast(message: string, prefix = 'Copied: '): void {
  const existing = document.getElementById("bs-vimium-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "bs-vimium-toast";
  const preview = message.length > 60 ? message.slice(0, 60) + "…" : message;
  toast.textContent = `${prefix}${preview}`;
  document.documentElement.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("bs-vimium-toast-visible");
  });

  setTimeout(() => {
    toast.classList.remove("bs-vimium-toast-visible");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }, 5000);
}
