import { useEffect, useRef, useState } from 'react'
import './login-backdrop.css'

const SEAM = 1.4 // seconds the end of the shot dissolves into its start
const SEGMENTS = 3 // the shot travels microphone → grading panel → faders, six seconds each

const VERTEX = `attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}`
const NOISE = `
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*n(p);p*=2.03;a*=.5;}return s;}`

// The ink: last frame's ink drifts along a slow noise current and fades; the pointer adds a soft stroke.
const TRAIL = `precision mediump float;varying vec2 v;uniform sampler2D prev;uniform vec2 a,b;uniform float strength,aspect,time,radius,fade;${NOISE}
float seg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;float t=clamp(dot(pa,ba)/max(dot(ba,ba),1e-5),0.,1.);return length(pa-ba*t);}
void main(){
  vec2 q=v*vec2(aspect,1.);
  vec2 flow=vec2(fbm(q*2.2+time*.07)-.5,fbm(q*2.2+7.3-time*.06)-.5);
  float ink=texture2D(prev,v-flow*.006+vec2(0.,.0007)).r*fade;
  float d=seg(q,a*vec2(aspect,1.),b*vec2(aspect,1.));
  ink+=exp(-d*d/(radius*radius))*strength;
  gl_FragColor=vec4(min(ink,1.),0.,0.,1.);
}`

// The picture: the shot desaturated, softened and dark; where the ink is it develops into the graded, sharp shot
// with an amber rim. The end of the shot dissolves into its start through the same kind of noise.
// `side` darkens the right for the sign-in panel, `focus` centres the vignette, and on light themes `mist` lays a
// tinted fog over the undeveloped picture instead of darkness.
const COMPOSITE = `precision mediump float;varying vec2 v;uniform sampler2D A,B,ink;uniform float mixAB,intro,time,aspect,videoAspect,side;uniform vec2 texel,drift,focus;uniform vec4 mist;${NOISE}
vec2 cover(vec2 uv){vec2 s=aspect>videoAspect?vec2(1.,videoAspect/aspect):vec2(aspect/videoAspect,1.);return (uv-.5)*s*.96+.5+drift;}
vec3 shot(vec2 uv,float m){return mix(texture2D(A,uv).rgb,texture2D(B,uv).rgb,m);}
void main(){
  vec2 uv=cover(v);
  float wipe=fbm(v*vec2(aspect,1.)*2.4+time*.04);
  float m=smoothstep(wipe-.08,wipe+.08,mixAB*1.25-.12);
  vec3 col=shot(uv,m);
  vec3 soft=(col+shot(uv+texel*vec2(2.,0.),m)+shot(uv-texel*vec2(2.,0.),m)+shot(uv+texel*vec2(0.,2.),m)+shot(uv-texel*vec2(0.,2.),m))/5.;
  float l=dot(soft,vec3(.299,.587,.114));
  vec3 base=mix(vec3(l),soft,.3)*vec3(.92,.96,1.04)*mix(.54,.9,mist.a);
  base=mix(base,mist.rgb,mist.a*.66);
  float k=texture2D(ink,v).r;
  // ink edges are uneven, like ink in water rather than a soft disc
  k=clamp(k+(fbm(v*vec2(aspect,1.)*5.+time*.15)-.5)*.32*k,0.,1.);
  float reveal=smoothstep(.06,.5,k);
  vec2 ca=texel*1.1*reveal;
  vec3 graded=vec3(shot(uv+ca,m).r,col.g,shot(uv-ca,m).b);
  graded=pow(graded,vec3(.9))*vec3(1.1,1.,.88)*1.18;
  // through fog the night shot would read as a hole; screen the fog into its shadows
  graded=mix(graded,1.-(1.-graded)*(1.-mist.rgb*.5),mist.a);
  vec3 c=mix(base,graded,reveal);
  float rim=smoothstep(.05,.14,k)*(1.-smoothstep(.14,.32,k));
  c+=vec3(1.,.69,.13)*rim*.2*(.45+fbm(v*9.+time*.3));
  float seam=m*(1.-m)*4.;
  c+=vec3(1.,.69,.13)*seam*.18*smoothstep(.3,.7,fbm(v*6.+time*.2));
  c*=mix(1.,.38,smoothstep(.5,1.,v.x)*side);
  c*=mix(mix(.55,1.,smoothstep(0.,.45,v.y)),1.,mist.a);
  float vig=smoothstep(1.2,.3,length((v-focus)*vec2(aspect*.8,1.)));
  c=mix(c*mix(.55,1.,vig),mix(mist.rgb,c,mix(.35,1.,vig)),mist.a);
  gl_FragColor=vec4(mix(mist.rgb*mist.a,c,intro),1.);
}`

function compile(gl: WebGLRenderingContext, fragment: string) {
  const program = gl.createProgram()!
  for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader')
    gl.attachShader(program, shader)
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'link')
  return program
}

function texture(gl: WebGLRenderingContext) {
  const id = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, id)
  for (const [key, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, key, value)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))
  return id
}

// light themes see the undeveloped shot through their own fog (the host paints the same colour until the first frame)
const MIST: Record<string, [number, number, number]> = { warm: [.925, .886, .816], frost: [.875, .914, .906] }

/** The sign-in page's moving backdrop: a looping studio shot that develops under the pointer, like ink spreading
 *  through water, from a dark ungraded take into the graded one. Writes its playback onto its host, the element it
 *  sits in (`--bg-progress`, `data-segment`), and the pointer (`--mx`, `--my`, -1…1) for the page's parallax.
 *  `wait` is the same shot behind long tasks in the editor: centred, at 30fps, wandering over the whole picture and
 *  fogged on light themes. `home` sits behind the home page's two entrances: centred, fogged on light themes, and it
 *  stops drawing once the page has scrolled past it. Falls back to the graded still when WebGL is missing or reduced
 *  motion is asked for. */
export function LoginBackdrop({ src, poster, variant = 'gate' }: { src: string; poster: string; variant?: 'gate' | 'wait' | 'home' }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoA = useRef<HTMLVideoElement>(null)
  const videoB = useRef<HTMLVideoElement>(null)
  const [live, setLive] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const gate = canvas?.parentElement?.parentElement
    const clips = [videoA.current, videoB.current]
    if (!canvas || !gate || !clips[0] || !clips[1]) return
    const wait = variant === 'wait', home = variant === 'home', centred = wait || home
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false, alpha: false })
    if (!gl) return
    let trailProgram: WebGLProgram, compositeProgram: WebGLProgram
    try { trailProgram = compile(gl, TRAIL); compositeProgram = compile(gl, COMPOSITE) } catch { return }
    const quad = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const shotTextures = [texture(gl), texture(gl)]
    // ping-pong ink buffers at a quarter of the picture
    const inks = [0, 1].map(() => { const tex = texture(gl); const fbo = gl.createFramebuffer()!; return { tex, fbo } })
    let inkW = 0, inkH = 0
    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.75
      canvas.width = Math.max(2, Math.round(canvas.clientWidth * scale))
      canvas.height = Math.max(2, Math.round(canvas.clientHeight * scale))
      inkW = Math.max(2, Math.round(canvas.clientWidth / 4)); inkH = Math.max(2, Math.round(canvas.clientHeight / 4))
      for (const ink of inks) {
        gl.bindTexture(gl.TEXTURE_2D, ink.tex)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, inkW, inkH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
        gl.bindFramebuffer(gl.FRAMEBUFFER, ink.fbo)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ink.tex, 0)
        gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT)
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    }
    resize()
    window.addEventListener('resize', resize)

    // the pointer, in picture space (0…1, y up); a hidden one wanders when the real one rests
    let pointer = { x: .32, y: .5 }, last = { ...pointer }, movedAt = -1e9, speed = 0
    const onMove = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect()
      const next = { x: (event.clientX - box.left) / box.width, y: 1 - (event.clientY - box.top) / box.height }
      speed = Math.hypot(next.x - pointer.x, next.y - pointer.y)
      pointer = next
      movedAt = performance.now()
      gate.style.setProperty('--mx', (next.x * 2 - 1).toFixed(3))
      gate.style.setProperty('--my', (1 - next.y * 2).toFixed(3))
    }
    window.addEventListener('pointermove', onMove)

    let active = 0, joining = false, frame = 0, segment = -1, inkIndex = 0, showing = false, drawnAt = -1e9, resting = false
    const started = performance.now()
    void clips[0].play().catch(() => {})
    // The home page's shot rests (players paused, nothing drawn) while nobody can see it: the window is in the
    // background or hidden, or the content sheet covers it after one screen of scrolling. It picks up where it stopped.
    const unseen = () => document.hidden || !document.hasFocus() || window.scrollY > window.innerHeight
    const rest = (next: boolean) => {
      if (next === resting) return
      resting = next
      if (resting) { for (const clip of clips) clip!.pause(); return }
      void clips[active]!.play().catch(() => {})
      if (joining) void clips[1 - active]!.play().catch(() => {})
    }
    const attr = (program: WebGLProgram) => { const at = gl.getAttribLocation(program, 'p'); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0) }
    const upload = (clip: HTMLVideoElement, tex: WebGLTexture) => {
      if (clip.readyState < 2) return
      gl.bindTexture(gl.TEXTURE_2D, tex)
      // video rows arrive top first; the picture's texture space starts at the bottom
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, clip)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    }
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      if (home) { rest(unseen()); if (resting) return }
      if (document.hidden) return
      // behind a long task, and on the home page, the shot keeps to its own 30fps (the clip itself is 24fps)
      if ((wait || home) && now - drawnAt < 30) return
      drawnAt = now
      const time = (now - started) / 1000
      const current = clips[active]!, next = clips[1 - active]!
      const duration = Number.isFinite(current.duration) ? current.duration : 18
      // the end of the shot dissolves into its start, then the second player takes over
      const left = duration - current.currentTime
      if (!joining && left < SEAM) { joining = true; next.currentTime = 0; void next.play().catch(() => {}) }
      let mixAB = joining ? Math.min(1, 1 - left / SEAM) : 0
      if (joining && (current.ended || left <= 0.04)) { current.pause(); joining = false; active = 1 - active; mixAB = 0 }
      const shown = clips[active]!
      const progress = (joining ? 0 : shown.currentTime) / duration
      gate.style.setProperty('--bg-progress', progress.toFixed(4))
      const nextSegment = Math.min(SEGMENTS - 1, Math.floor(progress * SEGMENTS))
      if (nextSegment !== segment) { segment = nextSegment; gate.dataset.segment = String(segment) }
      upload(clips[active]!, shotTextures[0]); if (joining) upload(clips[1 - active]!, shotTextures[1])

      // where to add ink: the opening sweep, the pointer, or the wanderer
      const intro = Math.min(1, time / 1.6)
      let target = pointer, strength = Math.min(1, .25 + speed * 40), radius = .075
      if (time < 2.6) { const t = Math.min(1, time / 2.4); target = { x: .05 + t * .9, y: .62 - .18 * Math.sin(t * Math.PI) }; strength = .9; radius = .16 }
      else if (now - movedAt > 2600) {
        target = wait
          ? { x: .5 + .36 * Math.sin(time * .19), y: .5 + .3 * Math.sin(time * .31 + 1) }
          : { x: .36 + .24 * Math.sin(time * .23), y: .5 + .22 * Math.sin(time * .37 + 1) }
        strength = wait ? .4 : .32; radius = wait ? .12 : .1
      }
      speed *= .8
      const from = inks[inkIndex], to = inks[1 - inkIndex]
      gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo); gl.viewport(0, 0, inkW, inkH)
      gl.useProgram(trailProgram); attr(trailProgram)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, from.tex)
      gl.uniform1i(gl.getUniformLocation(trailProgram, 'prev'), 0)
      gl.uniform2f(gl.getUniformLocation(trailProgram, 'a'), last.x, last.y)
      gl.uniform2f(gl.getUniformLocation(trailProgram, 'b'), target.x, target.y)
      gl.uniform1f(gl.getUniformLocation(trailProgram, 'strength'), strength * .5)
      gl.uniform1f(gl.getUniformLocation(trailProgram, 'radius'), radius)
      gl.uniform1f(gl.getUniformLocation(trailProgram, 'aspect'), canvas.clientWidth / Math.max(1, canvas.clientHeight))
      gl.uniform1f(gl.getUniformLocation(trailProgram, 'time'), time)
      // half the frames, so the ink fades twice as much per frame to last as long
      gl.uniform1f(gl.getUniformLocation(trailProgram, 'fade'), wait ? .945 : .972)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      inkIndex = 1 - inkIndex
      last = target

      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height)
      gl.useProgram(compositeProgram); attr(compositeProgram)
      const unit = (name: string, index: number, tex: WebGLTexture) => { gl.activeTexture(gl.TEXTURE0 + index); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(gl.getUniformLocation(compositeProgram, name), index) }
      unit('A', 0, shotTextures[0]); unit('B', 1, joining ? shotTextures[1] : shotTextures[0]); unit('ink', 2, to.tex)
      const videoAspect = shown.videoWidth && shown.videoHeight ? shown.videoWidth / shown.videoHeight : 16 / 9
      const mx = Number(gate.style.getPropertyValue('--mx') || 0), my = Number(gate.style.getPropertyValue('--my') || 0)
      gl.uniform1f(gl.getUniformLocation(compositeProgram, 'mixAB'), mixAB)
      gl.uniform1f(gl.getUniformLocation(compositeProgram, 'intro'), intro)
      gl.uniform1f(gl.getUniformLocation(compositeProgram, 'time'), time)
      gl.uniform1f(gl.getUniformLocation(compositeProgram, 'aspect'), canvas.width / canvas.height)
      gl.uniform1f(gl.getUniformLocation(compositeProgram, 'videoAspect'), videoAspect)
      gl.uniform2f(gl.getUniformLocation(compositeProgram, 'texel'), 1 / (shown.videoWidth || 854), 1 / (shown.videoHeight || 480))
      gl.uniform2f(gl.getUniformLocation(compositeProgram, 'drift'), -mx * .012, my * .01)
      gl.uniform1f(gl.getUniformLocation(compositeProgram, 'side'), centred ? 0 : 1)
      gl.uniform2f(gl.getUniformLocation(compositeProgram, 'focus'), centred ? .5 : .38, centred ? .5 : .55)
      const mist = centred ? MIST[document.documentElement.dataset.uiTheme || ''] : undefined
      gl.uniform4f(gl.getUniformLocation(compositeProgram, 'mist'), ...(mist ?? [0, 0, 0]), mist ? 1 : 0)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      if (!showing && shown.readyState >= 2) { showing = true; setLive(true) }
    }
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onMove)
      for (const clip of clips) clip?.pause()
      // the context is left alive: React may run this effect again on the same canvas (and gets the same context)
    }
  }, [src, variant])

  return <div className={`login-backdrop-video${live ? ' is-live' : ''}`} data-variant={variant} aria-hidden="true">
    <img className="login-backdrop-video__still" src={poster} alt="" />
    <canvas ref={canvasRef} />
    <video ref={videoA} src={src} muted playsInline preload="auto" />
    <video ref={videoB} src={src} muted playsInline preload="auto" />
  </div>
}
