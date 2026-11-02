// Invoked by Codex's sandbox command: sample parameters only, never server-render parameters.
// No model is started and no credentials are read.
const {MARKER,browserDiagnostic}=require('./browser-diagnostic.cjs');
(async()=>{
 try{
  const {probeBrowser}=require('./creation-tools.cjs');
  await probeBrowser(require('playwright-core').chromium,process.argv[2],process.env);
  console.log('OPENTAKE_BROWSER_READY');
 }catch(error){console.error(MARKER+JSON.stringify(browserDiagnostic(error,'sandbox','script-load').diagnostic));process.exitCode=1;}
})();
