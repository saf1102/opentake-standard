const path=require('node:path');
const {bundledRuntimeEnvironment}=require('./bundled-runtimes.cjs');
const OFFLINE_CHANNEL='windows-offline';
function distributionIdentity(metadata={},platform=process.platform){
 return {APP_NAME:'OpenTake Standard',APP_ID:'top.opentake.standard',IS_WINDOWS_OFFLINE:platform==='win32'&&metadata.opentakeDistribution===OFFLINE_CHANNEL};
}
function distributionEnvironment(env,{bundled,profile,videos,resources}){
 const result={...env};if(!bundled)return result;
 result.LINK_READER_PROJECTS_DIR ||= path.join(videos,'OpenTake Standard Projects');
 result.OPENSCREEN_USER_DATA_DIR ||= path.join(profile,'openscreen');
 return resources?bundledRuntimeEnvironment(result,resources):result;
}
function unsignedBuildEnvironment(env){
 const result={...env};
 for(const key of Object.keys(result))if(/^(?:WIN_)?CSC_/i.test(key))delete result[key];
 result.CSC_IDENTITY_AUTO_DISCOVERY='false';return result;
}
module.exports={OFFLINE_CHANNEL,distributionIdentity,distributionEnvironment,unsignedBuildEnvironment};
