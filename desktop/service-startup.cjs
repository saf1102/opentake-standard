const STAGES=Object.freeze({runtime:'加载本机服务',config:'加载应用配置',listening:'启动本地连接'});
function waitForService(child,{timeoutMs=60000,onPhase=()=>{}}={}){
 return new Promise((resolve,reject)=>{
  let stage='runtime',settled=false;
  const finish=(error,url)=>{if(settled)return;settled=true;clearTimeout(timer);child.off('error',failed);child.off('exit',exited);child.off('message',message);error?reject(error):resolve(url)};
  const failed=error=>finish(error);
  const exited=(code,signal)=>finish(Error(`本机服务未能启动（退出码 ${code??'未知'}${signal?'，'+signal:''}）。请保留诊断日志。`));
  const message=value=>{
   if(Object.hasOwn(STAGES,value?.startupPhase)){stage=value.startupPhase;onPhase(stage);}
   if(value?.ready&&/^http:\/\/127\.0\.0\.1:\d+$/.test(value.ready))finish(null,value.ready);
  };
  const timer=setTimeout(()=>finish(Error(`本机服务启动超时（${STAGES[stage]}）。请保留诊断日志，不必重复配置依赖。`)),timeoutMs);
  child.once('error',failed);child.once('exit',exited);child.on('message',message);
 });
}
module.exports={waitForService,STAGES};
