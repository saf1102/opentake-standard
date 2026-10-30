/** Timeline zoom shortcuts remain available after using a slider or button. */
export function timelineZoomShortcut(event: KeyboardEvent): 'fit' | 'in' | 'out' | undefined {
  const target = event.target as HTMLElement | null;
  if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return;
  if (target?.isContentEditable || target?.closest(
    "input:not([type='range']):not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit']), textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='dialog']",
  )) return;
  if (event.key === '0' || event.code === 'Digit0' || event.code === 'Numpad0') return event.shiftKey ? undefined : 'fit';
  if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') return 'in';
  if (event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract') return 'out';
}
