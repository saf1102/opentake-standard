/** Pictures cut from a version's video in the page, for ⌘-drag quotes (no React here). */
type Box = { x: number; y: number; w: number; h: number }

/** The region `rect` (video pixels) of the frame the video shows now, as a small JPEG data URL. */
export function cropFrame(video: HTMLVideoElement, rect: Box) {
  try {
    const scale = Math.min(1, 480 / rect.w)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(rect.w * scale)); canvas.height = Math.max(1, Math.round(rect.h * scale))
    canvas.getContext('2d')?.drawImage(video, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.85)
  } catch { return undefined }
}

/**
 * The picture of a quoted area, cut from a version's own video at that moment (the editor's preview is a live page on
 * another origin, so its pixels cannot be read). `area` is in film pixels of a `film`-sized picture.
 */
export function grabArea(url: string, time: number, area: Box, film: { w: number; h: number }) {
  return new Promise<string | undefined>(resolve => {
    const video = document.createElement('video')
    let done = false
    const finish = (value?: string) => { if (done) return; done = true; window.clearTimeout(timer); video.removeAttribute('src'); video.load(); resolve(value) }
    const timer = window.setTimeout(() => finish(), 6000)
    video.muted = true; video.preload = 'auto'; video.playsInline = true
    video.onloadedmetadata = () => { video.currentTime = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.05)) }
    video.onseeked = () => {
      const kx = (video.videoWidth || film.w) / film.w, ky = (video.videoHeight || film.h) / film.h
      finish(cropFrame(video, { x: area.x * kx, y: area.y * ky, w: area.w * kx, h: area.h * ky }))
    }
    video.onerror = () => finish()
    video.src = url
  })
}
