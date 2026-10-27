/** mm:ss:ff 时间码（ff 按 30fps 计）。 */
export function timecode(value: number) {
  const seconds = Math.max(0, value);
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * 30);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}
