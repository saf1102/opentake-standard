/** Production accepts HTTPS only. An explicit loopback test origin never grants HTTP access elsewhere. */
function allowedSource(value,testOrigin){try{const u=new URL(value);if(u.username||u.password)return false;if(u.protocol==='https:')return true;return /^http:\/\/127\.0\.0\.1:\d+$/.test(testOrigin||'')&&u.origin===testOrigin}catch{return false}}
module.exports={allowedSource};
