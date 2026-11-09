// Shared by the Mac and Windows update dialogs.
export type Progress={step:number;status:string;error?:string;downloadedBytes?:number;totalBytes?:number};export type Bridge={updateStatus:()=>Promise<Progress&{supported:boolean;modified?:boolean;reason?:string}>;updateStart:(release:unknown)=>Promise<void>;updateCancel:()=>Promise<void>;updateRestart:()=>Promise<void>};
export const RELEASES_PAGE='https://github.com/saf1102/opentake-standard/releases/latest';
export const mb=(n?:number)=>((n||0)/1024/1024).toFixed(0);
/** Step list shared by the Mac and Windows dialogs; the download step shows how much has arrived. */
export function UpdateSteps({labels,progress}:{labels:string[];progress:Progress}){return <ol className="update-steps">{labels.map((label,i)=><li key={label} className={i===progress.step?'now':i<progress.step?'done':''}><i>{i<progress.step?'✓':i+1}</i>{label}{i===0&&progress.step===0&&progress.totalBytes?<small> {mb(progress.downloadedBytes)} / {mb(progress.totalBytes)} MB</small>:null}</li>)}</ol>}
export const bridge=()=>(window as unknown as {standardDesktop?:Bridge}).standardDesktop;
