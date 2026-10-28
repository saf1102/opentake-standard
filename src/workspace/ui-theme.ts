/** Two themes since 2026-10-26 (S先生): 原色 and 暖雾. 磨砂 was retired; a saved 磨砂 opens as 暖雾, the other light theme. */
export type UiTheme = 'original' | 'warm';
const key = 'linkreader-ui-theme';
export function readUiTheme(): UiTheme {
  try { const value = localStorage.getItem(key); return value === 'original' || value === 'warm' ? value : value === 'frost' ? 'warm' : 'original'; } catch { return 'original'; }
}
export function applyUiTheme(theme: UiTheme) {
  document.documentElement.dataset.uiTheme = theme;
  try { localStorage.setItem(key, theme); } catch { /* Preferences may be unavailable. */ }
  window.dispatchEvent(new Event('linkreader-ui-theme'));
}
