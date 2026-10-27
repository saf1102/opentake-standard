import {MEDIA_FILE_ACCEPT,mediaFileKind} from '../media-file-types';
import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  ClipboardPaste,
  Film,
  FolderOpen,
  GripVertical,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Music2,
  Search,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { mediaUrl } from "@/studio/api";
import { STUDIO_MEDIA_DRAG_TYPE } from "@/studio/media-drag";
import { timecode } from "@/studio/timecode";
import { usedAssetIds } from "@/studio/media-usage";
import type { EditProject, MediaAsset, Timeline } from "@/types";

function AudioAssetPreview({src}: {src: string}) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const audio = ref.current;
    return () => { if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); } };
  }, [src]);
  return <audio ref={ref} src={src} controls />;
}

type MediaFilter = "all" | MediaAsset["type"] | "recording" | "b-roll" | "general";
type MediaView = "grid" | "list";

const MEDIA_FILTERS: Array<{ id: MediaFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "video", label: "视频" },
  { id: "recording", label: "录屏" },
  { id: "b-roll", label: "B-roll视频" },
  { id: "audio", label: "音频" },
  { id: "image", label: "B-roll图片" },
  { id: "general", label: "通用素材" },
];

function canDragAsset(asset: MediaAsset) {
  return asset.status === "ready";
}

function mediaCategory(asset: MediaAsset): Exclude<MediaFilter, "all"> {
  if (asset.origin === "general" && (asset.type === "image" || asset.type === "video")) return "general";
  if (asset.type !== "video") return asset.type;
  if (asset.origin === "b-roll") return "b-roll";
  if (asset.origin === "screen-recording" || asset.origin === "openscreen-published"
    || (Boolean(asset.capture) && !asset.origin)) return "recording";
  return "video";
}

function assetTypeLabel(asset: MediaAsset) {
  return MEDIA_FILTERS.find(item => item.id === mediaCategory(asset))?.label;
}

function namedClipboardFile(file: File, index: number): File {
  if (file.name && !/^(?:image|clipboard)(?:\s*\(\d+\))?\.[^.]+$/i.test(file.name)) return file;
  const extension = file.type.split('/')[1]?.split('+')[0] || 'png';
  const name = `剪贴板素材-${Date.now()}-${index + 1}.${extension === 'jpeg' ? 'jpg' : extension}`;
  return new File([file], name, {type: file.type, lastModified: file.lastModified});
}

function AssetTypeIcon({ type }: { type: MediaAsset["type"] }) {
  if (type === "video") return <Film aria-hidden />;
  if (type === "audio") return <Music2 aria-hidden />;
  return <ImageIcon aria-hidden />;
}

/** A video's still that plays (muted, looping) while the pointer is over it; a `#t=a,b` source loops that stretch. */
function HoverPlay({ projectId, asset, children }: { projectId: string; asset: MediaAsset; children: ReactNode }) {
  const [on, setOn] = useState(false);
  const src = mediaUrl(projectId, asset.id, "proxy");
  const range = /#t=([\d.]+),([\d.]+)$/.exec(src);
  const [from, to] = range ? [Number(range[1]), Number(range[2])] : [0, Infinity];
  return (
    <span className="media-hover-play" onPointerEnter={() => setOn(true)} onPointerLeave={() => setOn(false)}>
      {children}
      {on && <video src={src} muted autoPlay playsInline preload="auto" aria-hidden
        onTimeUpdate={event => { const v = event.currentTarget; if (v.currentTime >= to - 0.05) v.currentTime = from; }}
        onEnded={event => { const v = event.currentTarget; v.currentTime = from; void v.play().catch(() => {}); }} />}
    </span>
  );
}

export function AssetPreview({ projectId, asset }: { projectId: string; asset: MediaAsset }) {
  if (asset.type === "audio" && asset.waveformFile) {
    return (
      <div
        className="media-waveform"
        style={{ backgroundImage: `url(${mediaUrl(projectId, asset.id, "waveform")})` }}
        aria-label={`${asset.name} 音频波形`}
      >
        <Music2 aria-hidden />
      </div>
    );
  }

  if (asset.thumbnailFile || asset.type === "image") {
    const still = (
      <img
        src={mediaUrl(projectId, asset.id, asset.thumbnailFile ? "thumbnail" : "original")}
        loading="lazy"
        alt={`${asset.name} 缩略图`}
        draggable={false}
      />
    );
    return asset.type === "video" ? <HoverPlay projectId={projectId} asset={asset}>{still}</HoverPlay> : still;
  }

  return (
    <div className={`media-placeholder media-placeholder--${asset.type}`}>
      <AssetTypeIcon type={asset.type} />
    </div>
  );
}

function assetDetail(asset: MediaAsset) {
  if (asset.status === "processing") return "正在生成代理…";
  if (asset.status === "error") return asset.error || "素材处理失败";
  if (asset.type === "image") {
    return asset.width && asset.height ? `${asset.width}×${asset.height}` : "静态图片";
  }
  return `${timecode(asset.duration)}${
    asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""
  }`;
}

export type LeftLibraryTab = "media" | "motion";

export function MediaLibrary({
  project,
  timeline,
  uploadProgress,
  onUpload,
  onRemove,
  onClassify,
  onRevealProject,
  onPreviewOpen,
  onBeginPointerDrag,
  tab = "media",
  onTabChange,
  motionLibrary,
  motionCount,
  libraryTab,
}: {
  /** 素材 | 动效库: the motion library shares the left column (like 素材 / 音频 / 文本 in other editors). */
  tab?: LeftLibraryTab;
  onTabChange?: (tab: LeftLibraryTab) => void;
  motionLibrary?: ReactNode;
  motionCount?: number;
  /** 通用剪辑: the second tab is the style library, not the motion library */
  libraryTab?: { label: string; icon: typeof Sparkles };
  project: EditProject;
  timeline: Timeline;
  uploadProgress?: number;
  onRemove: (asset: MediaAsset) => Promise<void>;
  onUpload: (files: FileList | null, options?: {screenRecording?: boolean}) => Promise<MediaAsset[]>;
  onClassify: (ids: string[], origin: "screen-recording" | "imported" | "b-roll" | "general") => Promise<void>;
  onRevealProject: () => void;
  onPreviewOpen?: () => void;
  onBeginPointerDrag: (
    event: ReactPointerEvent<HTMLDivElement>,
    asset: MediaAsset,
  ) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<MediaAsset | null>(null);
  const [dropping, setDropping] = useState(false);
  const dragDepth = useRef(0);
  const [removing, setRemoving] = useState<string[]>([]);
  const [filter, setFilter] = useState<MediaFilter>("all");
  const listRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef<Record<string, number>>({});
  const [view, setView] = useState<MediaView>("grid");
  const [query, setQuery] = useState("");
  const scrollKey = `${filter}|${query}`;
  useLayoutEffect(() => { if (listRef.current) listRef.current.scrollTop = scrollPositions.current[scrollKey] || 0; }, [scrollKey]);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const usedIds = useMemo(() => usedAssetIds(timeline), [timeline]);
  const tabbed = Boolean(motionLibrary && onTabChange);
  const activeTab: LeftLibraryTab = tabbed ? tab : "media";
  // The motion library mounts the first time it is opened, then stays mounted (hidden) to keep its scroll and filters.
  const [motionMounted, setMotionMounted] = useState(activeTab === "motion");
  if (activeTab === "motion" && !motionMounted) setMotionMounted(true);
  // Coming back from 动效库 keeps the media list where it was.
  useLayoutEffect(() => { if (activeTab === "media" && listRef.current) listRef.current.scrollTop = scrollPositions.current[scrollKey] || 0; }, [activeTab, scrollKey]);
  const tabKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next: LeftLibraryTab = event.key === "Home" ? "media" : event.key === "End" ? "motion" : activeTab === "media" ? "motion" : "media";
    onTabChange?.(next);
    event.currentTarget.querySelector<HTMLElement>(`#left-library-tab-${next}`)?.focus();
  };

  const importPastedFiles = async (files: File[]) => {
    const accepted = files.filter(file => mediaFileKind(file.name, file.type)).map(namedClipboardFile);
    if (!accepted.length) { toast.info('剪贴板中没有可导入的图片、视频或音频'); return; }
    if (accepted.length < files.length) toast.info('已跳过不支持的文件');
    const transfer = new DataTransfer();
    accepted.forEach(file => transfer.items.add(file));
    const imported = await onUpload(transfer.files, {screenRecording: filter === 'recording'});
    const origin = filter === 'recording' ? 'screen-recording' : filter === 'b-roll' ? 'b-roll' : filter === 'general' ? 'general' : undefined;
    const matching = origin === 'screen-recording' || origin === 'b-roll'
      ? imported.filter(asset => asset.type === 'video')
      : origin === 'general' ? imported.filter(asset => asset.type === 'video' || asset.type === 'image') : [];
    let classified = true;
    if (origin && matching.length) {
      try { await onClassify(matching.map(asset => asset.id), origin); }
      catch (error) { classified = false; toast.error(error instanceof Error ? error.message : '素材分类失败'); }
    }
    if (imported.length) {
      onTabChange?.('media');
      setQuery('');
      if (filter !== 'all' && imported.some(asset => mediaCategory({...asset, origin: classified && matching.some(item => item.id === asset.id) ? origin : asset.origin}) !== filter)) setFilter('all');
      toast.success(`已导入 ${imported.length} 个素材`);
    }
  };

  const pasteFromEvent = (event: ReactClipboardEvent<HTMLElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest('input,textarea,[contenteditable="true"]')) return;
    const files = Array.from(event.clipboardData.files);
    for (const item of Array.from(event.clipboardData.items)) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file && !files.includes(file) && !files.some(existing => existing.name === file.name && existing.size === file.size && existing.type === file.type)) files.push(file);
    }
    if (!files.length) { toast.info('剪贴板中没有可导入的图片、视频或音频'); event.preventDefault(); return; }
    event.preventDefault();
    void importPastedFiles(files);
  };

  const pasteFromButton = async () => {
    try {
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const item of items) for (const type of item.types) {
        if (!mediaFileKind('', type)) continue;
        const blob = await item.getType(type);
        const extension = type.split('/')[1]?.split('+')[0] || 'png';
        files.push(new File([blob], `剪贴板素材-${Date.now()}-${files.length + 1}.${extension === 'jpeg' ? 'jpg' : extension}`, {type}));
        break;
      }
      await importPastedFiles(files);
    } catch { toast.error('无法读取剪贴板，请点击素材分类后按 ⌘V 或 Ctrl+V'); }
  };

  useEffect(()=>{
    const classify=(event:Event)=>{
      const {assetId,category}=(event as CustomEvent<{assetId:string;category:string}>).detail;
      const asset=project.media.find(a=>a.id===assetId);
      if(!asset || !(asset.type==='video' && ['video','recording','b-roll','general'].includes(category) || asset.type==='image' && ['image','general'].includes(category)))return;
      void onClassify([assetId],category==='recording'?'screen-recording':category==='b-roll'?'b-roll':category==='general'?'general':'imported')
        .then(()=>toast.success('素材分类已更新')).catch(error=>toast.error(String(error)));
    };
    window.addEventListener('studio-classify-media',classify);
    return ()=>window.removeEventListener('studio-classify-media',classify);
  },[project.media,onClassify]);

  const counts = useMemo(() => {
    const next: Record<MediaFilter, number> = {
      all: project.media.filter(asset => !asset.removedFromLibrary).length,
      video: 0,
      audio: 0,
      image: 0,
      recording: 0,
      "b-roll": 0,
      general: 0,
    };
    for (const asset of project.media) {
      if (asset.removedFromLibrary) continue;
      next[mediaCategory(asset)] += 1;
    }
    return next;
  }, [project.media]);

  const visibleMedia = useMemo(
    () =>
      project.media.filter((asset) => {
        if (asset.removedFromLibrary) return false;
        if (filter !== "all" && mediaCategory(asset) !== filter) return false;
        return !deferredQuery || asset.name.toLocaleLowerCase().includes(deferredQuery);
      }),
    [deferredQuery, filter, project.media],
  );

  return (
    <aside className={`media-panel ${dropping ? 'media-panel--drop' : ''}`}
      tabIndex={0}
      aria-label="素材库，支持粘贴图片、视频和音频"
      onPaste={pasteFromEvent}
      onDragEnter={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault(); dragDepth.current++; setDropping(true);
      }}
      onDragOver={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDropping(false);
      }}
      onDrop={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault(); event.stopPropagation(); dragDepth.current = 0; setDropping(false);
        const accepted = new DataTransfer();
        for (const file of Array.from(event.dataTransfer.files)) {
          if (mediaFileKind(file.name,file.type)) accepted.items.add(file);
        }
        if (accepted.files.length !== event.dataTransfer.files.length) toast.info('仅支持视频、音频和图片文件');
        if (accepted.files.length) { onTabChange?.('media'); onUpload(accepted.files); }
      }}
    >
      {dropping && <div className="media-drop-hint">松开鼠标，导入素材</div>}
      {tabbed ? (
        <div className="left-library-tabs" role="tablist" aria-label="左栏内容" onKeyDown={tabKeys}>
          {([["media", "素材", counts.all, Film], ["motion", libraryTab?.label ?? "动效库", motionCount, libraryTab?.icon ?? Sparkles]] as const).map(([id, label, count, Icon]) => (
            <button
              key={id}
              id={`left-library-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              aria-controls={`left-library-panel-${id}`}
              tabIndex={activeTab === id ? 0 : -1}
              onClick={() => onTabChange?.(id)}
            >
              <Icon aria-hidden /> {label}{count !== undefined ? <span>{count}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      <div className="media-library-pane" id="left-library-panel-media" role={tabbed ? "tabpanel" : undefined}
        aria-labelledby={tabbed ? "left-library-tab-media" : undefined} hidden={activeTab !== "media"}>
      <div className="media-library-toolbar">
        <label className="upload-button">
          <Upload size={17} /> 导入素材
          <input
            type="file"
            multiple
            accept={MEDIA_FILE_ACCEPT}
            onChange={(event) => { onUpload(event.target.files); event.target.value = ""; }}
          />
        </label>
        <button type="button" className="media-paste-button" onClick={() => void pasteFromButton()} aria-label="粘贴素材" title="粘贴剪贴板中的图片、视频或音频（⌘V / Ctrl+V）"><ClipboardPaste aria-hidden /></button>
        <div className="media-view-toggle" aria-label="素材显示方式">
          <button
            className={view === "grid" ? "active" : ""}
            aria-label="网格显示"
            aria-pressed={view === "grid"}
            onClick={() => setView("grid")}
          >
            <LayoutGrid />
          </button>
          <button
            className={view === "list" ? "active" : ""}
            aria-label="列表显示"
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            <List />
          </button>
        </div>
      </div>

      {uploadProgress !== undefined ? (
        <div className="task-progress-fill" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress} aria-label="上传进度">
          <i style={{ width: `${uploadProgress}%` }} /><span>上传素材 · {Math.round(uploadProgress)}%</span>
        </div>
      ) : null}

      <label className="media-search">
        <Search aria-hidden />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索素材名称"
          aria-label="搜索素材名称"
        />
      </label>

      <section className="media-category-overlap">
      <nav className="media-type-filters" aria-label="素材类型分类">
        {MEDIA_FILTERS.map((item) => (
          <button
            key={item.id}
            data-media-category={item.id}
            onDragOver={event=>{if(['video','recording','b-roll','image','general'].includes(item.id)&&event.dataTransfer.types.includes(STUDIO_MEDIA_DRAG_TYPE)){event.preventDefault();event.stopPropagation();event.currentTarget.classList.add('is-classification-target');}}}
            onDragLeave={event=>event.currentTarget.classList.remove('is-classification-target')}
            onDrop={event=>{event.preventDefault();event.stopPropagation();event.currentTarget.classList.remove('is-classification-target');window.dispatchEvent(new CustomEvent('studio-classify-media',{detail:{assetId:event.dataTransfer.getData(STUDIO_MEDIA_DRAG_TYPE),category:item.id}}));}}
            className={filter === item.id ? "active" : ""}
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
            <span>{counts[item.id]}</span>
          </button>
        ))}
      </nav>
      </section>

      <div className="media-library-summary">
        <span aria-live="polite">{visibleMedia.length} 个素材</span>
        <details><summary>拖拽帮助</summary><p>录屏拖入录屏轨道；B-roll 与通用素材拖入 B-roll 轨道。也可把素材拖到分类标签上重新分类。</p></details>
      </div>

      <div ref={listRef} onScroll={event=>{scrollPositions.current[scrollKey]=event.currentTarget.scrollTop;}} className={`media-list media-list--${view}`}>
        {visibleMedia.map((asset) => {
          const draggable = canDragAsset(asset);
          const used = usedIds.has(asset.id);
          return (
            <div
              className={`media-item media-item--${asset.type} ${
                `${draggable ? "is-draggable" : ""} ${selected === asset.id ? "is-selected" : ""}`
              }`}
              key={asset.id}
              tabIndex={0}
              aria-label={`${asset.name}${used ? '，已使用' : '，未使用'}`}
              onClick={event => { setSelected(asset.id); event.currentTarget.focus(); }}
              onFocus={() => setSelected(asset.id)}
              onKeyDown={event => {
                if (event.target !== event.currentTarget || (event.code !== 'Space' && event.key !== ' ') || event.repeat) return;
                event.preventDefault(); event.stopPropagation();
                if (asset.status === 'ready') { onPreviewOpen?.(); setPreview(asset); }
                else toast.info('素材尚未处理完成，请稍后预览');
              }}
              draggable={draggable}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData(STUDIO_MEDIA_DRAG_TYPE, asset.id);
                event.dataTransfer.setData("text/plain", asset.id);
              }}
              onPointerDown={(event) => {
                if (draggable) onBeginPointerDrag(event, asset);
              }}
              title={
                draggable
                  ? `拖动「${asset.name}」到时间线`
                  : undefined
              }
            >
              <button
                type="button"
                className="media-item__remove"
                aria-label={`删除素材 ${asset.name}`}
                title={used ? '从素材库及时间线删除' : '从素材库删除'}
                disabled={removing.includes(asset.id)}
                draggable={false}
                onPointerDown={event => event.stopPropagation()}
                onDragStart={event => { event.preventDefault(); event.stopPropagation(); }}
                onClick={async event => {
                  event.stopPropagation();
                  setRemoving(current => [...current, asset.id]);
                  try { await onRemove(asset); }
                  finally { setRemoving(current => current.filter(id => id !== asset.id)); }
                }}
              ><X aria-hidden /></button>
              <div className="media-item__preview">
                <AssetPreview projectId={project.id} asset={asset} />
                {used && <span className="media-used-badge">已使用</span>}
                <span className="media-type-badge">
                  <AssetTypeIcon type={asset.type} />
                  {assetTypeLabel(asset)}
                </span>
                {asset.type !== "image" && asset.status === "ready" ? (
                  <time>{timecode(asset.duration)}</time>
                ) : null}
              </div>
              <div className="media-item__meta">
                <b title={asset.name}>{asset.name}</b>
                <span>{assetDetail(asset)}</span>
              </div>
              {draggable ? (
                <GripVertical className="media-drag-handle" aria-hidden />
              ) : null}
            </div>
          );
        })}

        {!visibleMedia.length ? (
          <div className="media-library-empty">
            <AssetTypeIcon
              type={filter === "all" || filter === "recording" || filter === "b-roll" || filter === "general" ? "video" : filter}
            />
            <b>{deferredQuery ? "没有匹配的素材" : "这个分类还没有素材"}</b>
            <span>{deferredQuery ? "换个名称搜索" : "点击上方导入按钮添加素材"}</span>
            {query && <button type="button" onClick={()=>setQuery('')}>清除搜索</button>}
            {filter !== 'all' && <button type="button" onClick={()=>setFilter('all')}>查看全部素材</button>}
          </div>
        ) : null}
      </div>

      <button className="plain-action media-reveal-button" onClick={onRevealProject}>
        <FolderOpen /> 打开工程目录
      </button>
      </div>
      {tabbed && motionMounted ? (
        <div className="motion-library-pane" id="left-library-panel-motion" role="tabpanel"
          aria-labelledby="left-library-tab-motion" hidden={activeTab !== "motion"}>
          {motionLibrary}
        </div>
      ) : null}
      <Dialog open={!!preview} onOpenChange={open => { if (!open) setPreview(null); }}>
        <DialogContent className="media-preview-dialog">
          <DialogTitle>{preview?.name || '素材预览'}</DialogTitle>
          <DialogDescription>素材预览 · 按 Esc 关闭</DialogDescription>
          {preview?.type === 'image' ? (
            <img src={mediaUrl(project.id, preview.id, 'original')} alt={preview.name} />
          ) : preview?.type === 'audio' ? (
            <AudioAssetPreview key={preview.id} src={mediaUrl(project.id, preview.id)} />
          ) : preview ? (
            <video key={preview.id} src={mediaUrl(project.id, preview.id)} controls autoPlay playsInline />
          ) : null}
        </DialogContent>
      </Dialog>
    </aside>
  );
}
