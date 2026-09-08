// Maps a physical key (KeyboardEvent.code) to the character it would produce
// under a US QWERTY layout. This lets hotkeys keep working when the OS
// keyboard layout is switched to something else (e.g. Russian), since
// KeyboardEvent.code reflects the physical key position, not the layout.
const CODE_TO_CHAR: Record<string, [lower: string, upper: string]> = {};
for (let i = 0; i < 26; i++) {
  const lower = String.fromCharCode(97 + i);
  CODE_TO_CHAR[`Key${lower.toUpperCase()}`] = [lower, lower.toUpperCase()];
}
CODE_TO_CHAR.Slash = ['/', '?'];
CODE_TO_CHAR.Comma = [',', '<'];
CODE_TO_CHAR.Period = ['.', '>'];

export function physicalKey(e: KeyboardEvent): string {
  const pair = CODE_TO_CHAR[e.code];
  if (!pair) return e.key;
  return e.shiftKey ? pair[1] : pair[0];
}
