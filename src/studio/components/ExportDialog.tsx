import {ExportMethodIcon} from './ExportMethodIcon';
import {ExportHistory} from './ExportHistory';
import {WaitBackdrop} from './WaitBackdrop';
import { exportTime, exportElapsedLabel, exportRemainingLabel } from '../export-time';
import { useEffect, useState, useRef } from "react";
import {createPortal} from 'react-dom';
import "./export-dialog.css";
import { ExportSettingsSchema } from "@/types";
import type { ReactNode } from "react";
import {
  Check,
  ChevronRight,
  CircleAlert,
  Download,
  FolderOpen,
  LoaderCircle,
  X,
  Square,
  RotateCcw,
  Play,
  Send,
} from "lucide-react";
import type {
  ExportCapabilities,
  ExportJob,
  ExportPreset,
  ExportSettings,
} from "@/types";
import {
  EXPORT_PRESET_COPY,
  exportSettingsForPreset,
  hasSelectedExport,
  createExportDialogSettings,
  updateExportDialogSettings,
  switchExportDialogPreset,
  exportDialogSubmission,
  exportDialogPreferences,
  isFilmExportPreset,
} from "@/studio/export-settings";

const PRESETS = ['quick','jianying'] as const;

const PHASE_LABELS: Record<string, string> = {
  queued: "等待执行",
  preparing: "准备文件",
  reference: "渲染时间线",
  motion: "渲染动效",
  compositing: "合成封装",
  audio: "生成音轨",
  cards: "渲染卡片",
  jianying: "生成剪映工程",
  finalizing: "核对交付",
  completed: "导出完成",
  failed: "导出失败",
  cancelled: "已停止",
};

function formatBytes(bytes?: number) {
  if (!bytes) return "";
  const gb = bytes / 1024 / 1024 / 1024;
  return `${gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)} GB 可用`;
}

function ProgressView({
  job,
  reuseSnapshot = true,
  retrying,
  onClose,
  onReveal,
  onRetry,
  onStop,
  onRestart,
  onPublish,
}: {
  job: ExportJob;
  reuseSnapshot?: boolean;
  retrying: boolean;
  onPublish?: () => void;
  onClose: () => void;
  onReveal: () => void;
  onRetry: () => void;
  onStop: () => void;
  onRestart: () => void;
}) {
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),1000);return ()=>window.clearInterval(timer);},[job.id]);
  const timing=exportTime(job,now);
  const done = job.status === "completed";
  const failed = job.status === "failed";
  const stopped = job.status === "cancelled";
  const active = job.status === "running" || job.status === "queued";
  const value = Math.round(Math.max(0, Math.min(100, job.progress)));
  return (
    <section className="export-progress" aria-live="polite">
      <header>
        <div className={`export-progress__icon ${done ? "is-done" : failed ? "is-failed" : ""}`}>
          {done ? <Check /> : failed ? <CircleAlert /> : stopped ? <Square /> : <LoaderCircle className="is-spinning" />}
        </div>
        <div>
          <span>{PHASE_LABELS[job.phase || job.status] || "导出任务"}</span>
          <div className="export-progress__status-row">
            <h2>{stopped ? "导出已停止" : job.message || "正在执行导出"}</h2>

          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭导出窗口"><X /></button>
      </header>
      <div className="export-progress__number">{value}<small>%</small></div>
      <div className="export-progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
        <i style={{ width: `${value}%` }} />
      </div>
      {job.totalItems ? (
        <p>当前项目 {job.currentItem || 0} / {job.totalItems}</p>
      ) : done && job.outputDir ? <p>{job.outputDir}</p> : null}
      {(stopped || failed) && <p>{reuseSnapshot ? '继续导出使用原任务内容并复用已完成素材；重新导出使用当前工程，另存新版本。' : '重试导出使用当前版本和原导出参数，另存新文件夹。'}</p>}
      {job.error ? <div className="export-progress__error">{job.error}</div> : null}
      {job.warnings?.length ? (
        <ul>{job.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      ) : null}
      <footer>
            <div className="export-progress__timing" aria-live="off">
              <div><small>{timing.terminal ? "实际用时" : "已运行"}</small><strong>{exportElapsedLabel(timing.elapsed)}</strong></div>
              {!timing.terminal && <div><small>预计剩余</small><strong>{timing.remaining === null ? "估算中…" : exportRemainingLabel(timing.remaining)}</strong></div>}
            </div>
        <button type="button" className="export-secondary" onClick={onClose}>{active ? "转到后台" : "关闭"}</button>
        {active && <button type="button" className="export-secondary" disabled={retrying} onClick={onStop}><Square /> {retrying ? "正在停止…" : "停止导出"}</button>}
        {!active && job.settings && <button type="button" className="export-secondary" disabled={retrying} onClick={onRestart}><RotateCcw /> 重新导出</button>}
        {(failed || stopped) && <button type="button" className="export-primary" disabled={retrying} onClick={onRetry}>
          {retrying ? <LoaderCircle className="is-spinning" /> : <Play />} {retrying ? "正在处理…" : reuseSnapshot ? "继续导出" : "重试导出"}
        </button>}
        {done && onPublish ? <button type="button" className="export-secondary" onClick={onPublish}><Send /> 去发布</button> : null}
        {done ? <button type="button" className="export-primary" onClick={onReveal}><FolderOpen /> 在访达中显示</button> : null}
      </footer>
    </section>
  );
}

export function ExportDialog({
  projectId,projectName,unfinishedCards=0,notice,
  mode = "koubo", apiBase = `/api/editor/projects/${encodeURIComponent(projectId)}/exports`, onPublish, history,
  canvas,
  capabilities,
  job,
  starting,
  onClose,
  onChooseDestination,
  onStart,
  onRetry,
  onStop,
  onRestart,
  onReveal,
}: {
  projectId: string;projectName: string;unfinishedCards?:number;notice?:string;
  mode?: "koubo" | "general" | "screen"; apiBase?: string; onPublish?: () => void; history?: ReactNode;
  canvas?: {width:number;height:number;fps?:number};
  capabilities?: ExportCapabilities;
  job?: ExportJob;
  starting: boolean;
  onClose: () => void;
  onChooseDestination: () => Promise<string>;
  onStart: (settings: ExportSettings) => Promise<void>;
  onRetry: () => Promise<void>;
  onStop: () => Promise<void>;
  onRestart: () => Promise<void>;
  onReveal: () => void;
}) {
  const [exportState, setExportState] = useState(() => createExportDialogSettings(exportSettingsForPreset("quick")));
  const {settings} = exportState;
  const setSettings = (update: (current: ExportSettings) => ExportSettings) =>
    setExportState(current => updateExportDialogSettings(current, update(current.settings)));
  const filmOptionsEnabled = isFilmExportPreset(settings.preset);
  const dialogRef=useRef<HTMLDivElement>(null);
  const defaultsApplied=useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string>();
  const exporting = job?.status === "queued" || job?.status === "running";
  const copy = mode === 'koubo' ? EXPORT_PRESET_COPY : {...EXPORT_PRESET_COPY,
    quick: {label: exportState.film.video.codec === 'prores422' ? '成片 MOV' : '成片 MP4', description: '画面、字幕、配乐音效合成一条视频'},
    jianying: {label: '剪映草稿', description: '按分轨导出，到剪映里接着改'}};
  useEffect(() => {
    if (!capabilities?.defaultDestination || defaultsApplied.current) return;
    const controller = new AbortController();
    const d = capabilities.defaults;
    const initial = d ? {...exportSettingsForPreset(d.preset), destinationDir: capabilities.defaultDestination,
      resolution: d.resolution, revealWhenDone: d.revealWhenDone,
      video: {container:d.container,codec:'h264' as const,quality:d.quality,encoder:'auto' as const}}
      : {...exportSettingsForPreset('quick'), destinationDir:capabilities.defaultDestination};
    fetch(`${apiBase}/preferences`, {signal:controller.signal}).then(async r => {
      const data = await r.json(); if (!r.ok || !data.ok) throw Error(data.error || '无法读取导出设置');
      const saved = data.result ? ExportSettingsSchema.parse(data.result) : initial;
      if (!controller.signal.aborted) {setExportState(createExportDialogSettings({...saved,destinationDir:saved.destinationDir||capabilities.defaultDestination})); defaultsApplied.current = true; setLoaded(true);}
    }).catch(cause => {if (!controller.signal.aborted) setError(String(cause));});
    return () => controller.abort();
  }, [apiBase, capabilities]);
  const choosePreset = (preset: ExportPreset) => {
    setExportState(current => switchExportDialogPreset(current, preset));
    setError(undefined);
  };
  const persist = async () => {
    if (!loaded) return;
    const r = await fetch(`${apiBase}/preferences`, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(exportDialogPreferences(exportState))});
    const data = await r.json(); if (!r.ok || !data.ok) throw Error(data.error || '无法保存导出设置');
  };
  const action = async (run:()=>Promise<void>) => {setError(undefined);try{await run();}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}};
  const close = async () => {try {await persist(); onClose();} catch(cause) {setError(String(cause));}};
  const chooseFolder = async () => {
    setChoosing(true);
    setError(undefined);
    try {
      const destinationDir = await onChooseDestination();
      setSettings((current) => ({ ...current, destinationDir }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "未能选择导出位置");
    } finally {
      setChoosing(false);
    }
  };
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return()=>previous?.focus();
  },[]);
  const [allowUnfinished,setAllowUnfinished]=useState(false);
  useEffect(()=>setAllowUnfinished(false),[unfinishedCards]);
  const submit = async () => {
    if(unfinishedCards&&!allowUnfinished){setError('请确认是否跳过尚未完成的动效卡');return;}
    if (!hasSelectedExport(settings.selection)) {
      setError("至少选择一项导出内容");
      return;
    }
    setError(undefined);
    try {
      await persist();
      await onStart(exportDialogSubmission(exportState));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法启动导出");
    }
  };

  // 统一挂到 body，避开口播 workspace-content 的 z-index:1 层叠上下文。
  return createPortal(
    <div className={`export-backdrop${exporting ? " is-exporting" : ""}${job ? " wait-host" : ""}`} onMouseDown={() => void close()}>
      {job && <WaitBackdrop />}
      <div ref={dialogRef} className="export-dialog" onKeyDown={event=>{
        if(event.key==='Escape'){event.stopPropagation();void close();}
        if(event.key==='Tab'){
          const nodes=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href]')).filter(n=>n.getClientRects().length);
          const first=nodes[0],last=nodes.at(-1);
          if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
          else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
        }
      }} role="dialog" aria-modal="true" aria-label="导出工程" onMouseDown={(event) => event.stopPropagation()}>
        {job ? <>{unfinishedCards>0&&!exporting&&<label className="export-mode-summary"><input type="checkbox" checked={allowUnfinished} onChange={e=>setAllowUnfinished(e.currentTarget.checked)}/>当前工程仍有 {unfinishedCards} 张动效卡未完成，我确认跳过空卡位重新导出。</label>}{error&&<p role="alert">{error}</p>}<ProgressView reuseSnapshot={mode==='koubo'} job={job} retrying={starting} onClose={onClose} onPublish={onPublish} onReveal={onReveal} onRetry={() => void action(onRetry)} onStop={() => void action(onStop)} onRestart={() => {if(unfinishedCards&&!allowUnfinished){setError("请确认是否跳过尚未完成的动效卡");return;}void action(onRestart);}} /></> : (
          <>
            <header className="export-header">
              <div><h2>导出</h2><p>{projectName}</p>{notice&&<p className="export-notice" role="status">{notice}</p>}</div>
              <button type="button" onClick={() => void close()} aria-label="关闭导出设置"><X /></button>
            </header>
            <div className="export-shell">
              <aside className="export-presets" aria-label="导出预设">
                <span>导出方式</span>
                {PRESETS.map(id => (
                  <button key={id} type="button" className={settings.preset === id ? "is-active" : ""} onClick={() => choosePreset(id)}>
                    <ExportMethodIcon kind={id==='jianying'?'jianying':'video'} /><span><b>{copy[id].label}</b><small>{copy[id].description}</small></span><ChevronRight />
                  </button>
                ))}
              </aside>
              <main className="export-content">
                <section className="export-destination">
                  <div className="export-section-title"><span>01</span><div><b>保存位置</b><small>{formatBytes(capabilities?.freeBytes)}</small></div></div>
                  <div className="export-path-row">
                    <input value={settings.destinationDir} onChange={(event) => setSettings((current) => ({ ...current, destinationDir: event.target.value }))} placeholder="请选择导出文件夹" aria-label="导出目标文件夹" />
                    <button type="button" onClick={() => void chooseFolder()} disabled={choosing}><FolderOpen /> {choosing ? "选择中" : "选择"}</button>
                  </div>
                </section>
                <section className="export-resolution" aria-label="导出参数" aria-disabled={!filmOptionsEnabled}>
                  <h3>导出画质</h3>
                  <div role="group" aria-label="导出画质">
                    {([['original', '原片', '工程原始分辨率'], ['4k', '4K', '最高 2160P'], ['1080p', '清晰', '1080P'], ['720p', '流畅', '720P']] as const).map(([value, label, detail]) => (
                      <button key={value} type="button" disabled={!filmOptionsEnabled} aria-pressed={(settings.resolution || 'original') === value}
                        onClick={() => setSettings(current => ({...current, resolution: value}))}>
                        <b>{label}</b><small>{value === 'original' && canvas ? `${canvas.width} × ${canvas.height}` : detail}</small>
                      </button>
                    ))}
                  </div>
                  <p>保持画面比例，不提高工程原始分辨率。此选择独立于预览画质。</p>
                  <h3 className="export-option-heading">编码</h3>
                  <div role="group" aria-label="编码">
                    {([['h264','H.264','兼容性最好 · 推荐'],['h265','HEVC','体积更小 · 新设备'],['prores422','ProRes 422','交给剪辑软件 · 文件很大']] as const).map(([codec,label,detail]) =>
                      <button key={codec} type="button" disabled={!filmOptionsEnabled} aria-pressed={settings.video.codec === codec}
                        onClick={() => setSettings(current => ({...current,video:{...current.video,codec,container:codec === 'prores422' ? 'mov' : 'mp4'}}))}><b>{label}</b><small>{detail}</small></button>)}
                  </div>
                  <p>发抖音、小红书、B 站选 H.264；要在 Final Cut、达芬奇里继续调色选 ProRes。</p>
                  <h3 className="export-option-heading">帧率</h3>
                  <div role="group" aria-label="帧率">
                    {([['project','跟工程',canvas?.fps ? `${canvas.fps} fps` : '工程原始帧率'],[24,'24','电影感'],[60,'60','更流畅 · 文件更大']] as const).map(([fps,label,detail]) =>
                      <button key={fps} type="button" disabled={!filmOptionsEnabled} aria-pressed={(settings.fps || 'project') === fps}
                        onClick={() => setSettings(current => ({...current,fps}))}><b>{label}</b><small>{detail}</small></button>)}
                  </div>
                  <p>不会凭空补帧：选比工程更高的帧率时，画面动效按新帧率重新渲染。</p>
                </section>
                <section className="export-mode-summary">
                  <h3>{copy[settings.preset].label}</h3>
                  <p>{settings.preset === 'jianying'
                    ? '自动整理视频、人声、音乐、音效、字幕、动效卡片和章节进度条，在剪映中继续剪辑。'
                    : mode === 'koubo' ? '保留完整画面、声音、字幕、动效和进度条，导出可直接使用的视频。' : '按选好的清晰度、编码和帧率重新渲染整条片子，导出可以直接发布的视频。'}</p>
                  {settings.preset === 'jianying' && <p>{capabilities?.jianying.available
                    ? '已找到本机剪映，完成后自动导入。'
                    : capabilities?.jianying.warning || '正在检测本机剪映…'}</p>}
                </section>
                {unfinishedCards>0&&<label className="export-mode-summary"><input type="checkbox" checked={allowUnfinished} onChange={e=>setAllowUnfinished(e.target.checked)}/>仍有 {unfinishedCards} 张动效卡未完成，我确认跳过空卡位继续导出。</label>}
                {error ? <div className="export-error"><CircleAlert /> {error}</div> : null}
              </main>
            </div>
            <footer className="export-footer">
              <div><ExportMethodIcon kind={settings.preset==='jianying'?'jianying':'video'} /><span><b>{copy[settings.preset].label}</b><small>导出会在后台执行，可继续编辑</small></span></div>
              <button type="button" className="export-secondary" onClick={() => void close()}>取消</button>
              <button type="button" className="export-primary" disabled={!loaded || starting || !hasSelectedExport(settings.selection)} onClick={() => void submit()}><Download /> {starting ? "正在启动…" : settings.preset === "jianying" ? mode === "koubo" ? "导出并导入剪映" : "导出剪映草稿" : "导出成片"}</button>
            </footer>
          </>
        )}
        {history ?? <ExportHistory key={projectId} projectId={projectId} refreshKey={`${job?.id||''}:${job?.status||''}`} />}
      </div>
    </div>, document.body
  );
}
