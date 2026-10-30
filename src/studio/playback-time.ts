/**
 * 播放时间纯逻辑。播放头时间是剪辑器里被写入最频繁的状态，
 * 这些函数保证所有写入路径（seek、播放循环、拖拽定位）共用同一套规则。
 */

/** 把目标时间钳制在 [0, duration] 内。 */
export function clampTimelineTime(time: number, duration: number): number {
  const safeDuration = Math.max(0, Number.isFinite(duration) ? duration : 0);
  const safeTime = Number.isFinite(time) ? time : 0;
  return Math.max(0, Math.min(safeDuration, safeTime));
}

/**
 * 播放循环中某一帧对应的时间轴时间：从播放起点前进 elapsedMs，
 * 到达时间线末尾后停在末尾（由调用方触发结束回调）。
 */
export function playbackTimeAt(
  startTime: number,
  elapsedMs: number,
  duration: number,
): number {
  return Math.min(Math.max(0, duration), startTime + elapsedMs / 1000);
}

/**
 * 把连续时间量化到最近的帧边界。渲染时间落在两帧之间会导致
 * 字幕/动效在播放中闪动，所有给渲染层的时间都必须先过这里。
 */
export function quantizeToFrame(time: number, fps: number): number {
  const safeFps = fps > 0 ? fps : 30;
  return Math.max(0, Math.round(time * safeFps)) / safeFps;
}
