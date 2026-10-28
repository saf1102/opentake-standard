// Invoked by Codex's sandbox command: sample parameters only, never server-render parameters.
// No model is started and no credentials are read.
const {probeBrowser}=require('./creation-tools.cjs');
probeBrowser(require('playwright-core').chromium,process.argv[2],process.env).then(()=>{
 console.log('OPENTAKE_BROWSER_READY');
},()=>{console.error('出片沙盒中 Chromium 无法启动或截图');process.exitCode=1;});
