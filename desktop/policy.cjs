const path = require('node:path');
const APP_NAME = 'OpenTake Standard';
const APP_ID = 'top.opentake.standard';
function sameOrigin(url, origin) { try { return new URL(url).origin === origin; } catch { return false; } }
function userDataPath(appData, override=process.env.OPENTAKE_STANDARD_USER_DATA) {
 if(override && !path.isAbsolute(override))throw Error('OPENTAKE_STANDARD_USER_DATA 必须是绝对路径');
 return override || path.join(appData, APP_NAME);
}
function rememberedPort(state) {try {const url=new URL(state.url);const port=Number(url.port);return url.hostname==='127.0.0.1'&&url.protocol==='http:'&&Number.isInteger(port)&&port>=1024&&port<=65535?port:3119;}catch{return 3119;}}
module.exports = { APP_NAME, APP_ID, sameOrigin, userDataPath, rememberedPort };
