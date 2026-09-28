# chrome-vimium-c

On a WordPress site, press `g` then `p` to check its PHP version without leaving
the page. A popup loads Site Health using your current WordPress login. Your
account must have access to Site Health. Close with `Esc`, `q`, or the × button.

The check reads WordPress's language-independent debug report. Admin links on
the page also allow detecting installations in subdirectories; otherwise it
uses `/wp-admin/`. Nothing is stored, and each invocation requests fresh data.

Build with `bun install` and `bun run build`, then load `dist/` as an unpacked
extension in `chrome://extensions`. Reload the extension and the webpage after
rebuilding.
