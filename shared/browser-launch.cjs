// The agent's sample browser runs inside Codex's OS sandbox. The renderer runs in
// the application process, outside that sandbox. Keep each probe on its own path.
const SAMPLE_ARGS = ['--single-process', '--no-zygote', '--no-sandbox', '--ignore-gpu-blocklist', '--font-render-hinting=none', '--force-color-profile=srgb', '--hide-scrollbars', '--mute-audio', '--enable-unsafe-swiftshader'];
const RENDER_ARGS = ['--force-color-profile=srgb', '--font-render-hinting=none', '--use-gl=angle'];
// Preserve the kit's explicit Metal option for callers outside the agent sandbox.
const sampleArgs = gl => gl === 'metal'
 ? [...SAMPLE_ARGS.filter(arg=>arg!=='--enable-unsafe-swiftshader'), '--use-gl=angle', '--use-angle=metal']
 : [...SAMPLE_ARGS];
const renderArgs = (gl='angle') => RENDER_ARGS.map(arg=>arg.startsWith('--use-gl=')?'--use-gl='+gl:arg);
module.exports = {SAMPLE_ARGS, RENDER_ARGS, sampleArgs, renderArgs};
