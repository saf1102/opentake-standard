import {timelineHasCards, diagramCardTracks, cardSlotState, CARD_SLOT_LEGEND, CutRangeOverlay, voiceAnnotationsForClip, VoiceTimelineAnnotations, VoiceWaveform, MOTION_CARD_TIMELINE_LABELS, timelineClipAppearance, timelineClipLabel, presentationLayoutIntervals, librarySlotDropPreview, TimelineSmartTools, type CardTaskState, type PendingCut, type VoiceClipAnnotations, type LibrarySlotDropPreview, type SlotDropPreview} from '../timeline-edition';
import type { ReactNode } from "react";
import { timelineZoomShortcut } from '../timeline-shortcuts';
import {volumeDb,volumeGain,volumeLabel,snapVolumeDb} from '../volume-db';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  DragEvent as ReactDragEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import {
  Focus,
  Link2,
  Captions,
  Eye,
  EyeOff,
  Lock,
  Magnet,
  Maximize2,
  Mic2,
  Music2,
  Redo2,
  Scissors,
  Trash2,
  Undo2,
  Unlock,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { mediaUrl } from "@/studio/api";
import { ToolbarHint } from "./ToolbarHint";
import {
  isMediaTrackCompatible,
  STUDIO_MEDIA_DRAG_TYPE,
} from "@/studio/media-drag";
import { quantizeToFrame } from "@/studio/playback-time";
import { nextClipBoundarySeek } from "@/studio/clip-boundary-seek";
import type { ClipBoundarySeek } from "@/studio/clip-boundary-seek";
import {
  mergeMarqueeSelection,
  normalizedSelectionRect,
  selectionRectsIntersect,
} from "@/studio/marquee-selection";
import {
  fitTimelineZoom,
  MAX_TIMELINE_ZOOM,
  MIN_TIMELINE_ZOOM,
  stepTimelineZoom,
  timelineContentEnd,
  timelineRulerStep,
} from "@/studio/timeline-math";
import { timecode } from "@/studio/timecode";
import type {
  EditProject,
  MediaAsset,
  Timeline,
  TimelineClip,
  TimelineTrack,
} from "@/types";
import { FilmIcon } from "./StudioIcons";

const TimelineMediaStrip = memo(function TimelineMediaStrip({
  projectId,
  asset,
  clip,
  trackKind,
  voiceAnnotations,
  pixelsPerSecond,
}: {
  projectId: string;
  asset?: MediaAsset;
  clip: TimelineClip;
  trackKind: TimelineTrack["kind"];
  voiceAnnotations?: VoiceClipAnnotations;
  pixelsPerSecond: number;
}) {
  if (!asset) return <b>{clip.name}</b>;
  const mediaWidth = Math.max(1, asset.duration * pixelsPerSecond);
  const offset = -clip.sourceStart * pixelsPerSecond;
  const sharedStyle = {
    backgroundSize: `${mediaWidth}px 100%`,
    backgroundPosition: `${offset}px center`,
  };
  const isAudioTrack = ["voice", "source-bed", "music", "sfx"].includes(trackKind);
  const showVideoFrames = asset.type === "video" && !isAudioTrack;
  const showImage = asset.type === "image" && !isAudioTrack;
  const showWaveform = trackKind !== "voice" && (isAudioTrack || Boolean(asset.waveformFile));
  return (
    <span
      className={`timeline-media-strip ${isAudioTrack ? "is-audio" : "is-video"}`}
      data-timeline-media={isAudioTrack ? "audio-waveform" : asset.type}
    >
      {showVideoFrames ? (
        <span
          className="timeline-video-frames"
          style={{
            ...sharedStyle,
            backgroundImage: `url(${mediaUrl(
              projectId,
              asset.id,
              asset.filmstripFile ? "filmstrip" : "thumbnail",
            )})`,
          }}
        />
      ) : null}
      {showImage ? (
        <span
          className="timeline-video-frames"
          style={{
            ...sharedStyle,
            backgroundImage: `url(${mediaUrl(projectId, asset.id, "thumbnail")})`,
          }}
        />
      ) : null}
      {showWaveform ? (
        <span
          className={`timeline-waveform ${asset.waveformFile ? "" : "is-pending"}`}
          style={{
            ...sharedStyle,
            ...(asset.waveformFile
              ? { backgroundImage: `url(${mediaUrl(projectId, asset.id, "waveform")})` }
              : {}),
          }}
          aria-hidden="true"
        />
      ) : null}
      {trackKind === "voice" ? (
        <VoiceWaveform projectId={projectId} asset={asset} clip={clip} />
      ) : null}
      {trackKind === "voice" ? (
        voiceAnnotations ? (
          <VoiceTimelineAnnotations
            clip={clip}
            annotations={voiceAnnotations}
            pixelsPerSecond={pixelsPerSecond}
          />
        ) : null
      ) : <b>{clip.name}</b>}
    </span>
  );
});


type TrackToggle = "hidden" | "locked" | "muted";

export function TimelineEditor({
  project,
  timeline,cardTasks=[],onAddEmptyCard,
  zoom,
  onZoomChange,
  playhead,
  selectedClipIds,
  draggingClip,
  resizingClip,
  snapGuide,
  slotDrop,
  snappingEnabled,
  onSnappingChange,
  mainTrackLinked,onMainTrackLinkedChange,pendingCut,onMarkCutEdge,onCutBoundaryChange,onRestoreCut,onCancelCut,onPreviewCut,cutBusy,
  onSmartMusic, smartMusicBusy, onSmartRoughcut,
  onGlobalMotion, onGlobalSfx,
  onSmartBroll,
  onAutoPlace, autoPlaceRunning,
  globalMotionDisabled,
  suppressTimelineClickRef,
  timelinePlayheadRef,
  onUndo,
  onRedo,
  onSplit,
  onInsertDirectorGap,
  onEditDirectorSlot,
  onOpenDirectorSlot,
  onDelete,
  focusTimeline, onToggleFocus,
  onTrackVolume,
  onToggleTrack,
  onSeek,
  onSelectClip,
  onSelectClips,
  onClearSelection,
  onBeginClipDrag,
  onBeginClipDurationResize,
  onOpenClipMenu,
  onEditOverlay,
  onOpenDirectorScene,
  draggingAssetId,
  onDropMedia,
  generalTools,
}: {
  project: EditProject;
  timeline: Timeline;
  cardTasks?:CardTaskState[];onAddEmptyCard?:()=>void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  playhead: number;
  selectedClipIds: string[];
  draggingClip?: string;
  resizingClip?: string;
  snapGuide?: number;
  slotDrop?: SlotDropPreview;
  mainTrackLinked:boolean;
  onMainTrackLinkedChange:(enabled:boolean)=>void;
  pendingCut?:PendingCut;
  onMarkCutEdge:(edge:'start'|'end')=>void;
  onCutBoundaryChange:(edge:'start'|'end',at:number)=>void;
  onRestoreCut:(range:PendingCut)=>void;
  onCancelCut:()=>void;
  onPreviewCut:()=>void;
  cutBusy:boolean;
  snappingEnabled: boolean;
  onSnappingChange: (enabled: boolean) => void;
  onSmartMusic: () => void;
  onSmartRoughcut: () => void;
  smartMusicBusy?: boolean;
  onGlobalMotion: () => void;
  onGlobalSfx: () => void;
  onSmartBroll: () => void;
  onAutoPlace: () => void;
  autoPlaceRunning?: boolean;
  globalMotionDisabled?: boolean;
  suppressTimelineClickRef: RefObject<boolean>;
  timelinePlayheadRef: RefObject<HTMLDivElement | null>;
  onUndo: () => void;
  onRedo: () => void;
  onSplit: () => void;
  onInsertDirectorGap: (at: number) => void;
  onEditDirectorSlot: (slot: TimelineClip, action: "clear"|"delete") => void;
  onOpenDirectorSlot: (slot: TimelineClip) => void;
  onDelete: () => void;
  focusTimeline: boolean; onToggleFocus: () => void;
  onTrackVolume: (trackId:string,volume:number)=>void;
  onToggleTrack: (trackId: string, field: TrackToggle) => void;
  onSeek: (time: number) => void;
  onSelectClip: (clipId: string, additive: boolean) => void;
  onSelectClips: (clipIds: string[]) => void;
  onClearSelection: () => void;
  onBeginClipDrag: (
    event: ReactPointerEvent<HTMLButtonElement>,
    clip: TimelineClip,
    track: TimelineTrack,
  ) => void;
  onBeginClipDurationResize: (
    event: ReactPointerEvent<HTMLElement>,
    clip: TimelineClip,
    track: TimelineTrack,
    edge?: 'left' | 'right',
  ) => void;
  onOpenClipMenu: (clipId: string, x: number, y: number) => void;
  onEditOverlay: (clipId: string) => void;
  onOpenDirectorScene: (sceneId: string) => void;
  draggingAssetId?: string;
  onDropMedia: (
    asset: MediaAsset,
    trackId: string,
    start: number,
  ) => void;
  /** 通用剪辑: replaces the smart tools; the 口播-only split, cut range and main-track link are hidden */
  generalTools?: ReactNode;
}) {
  const hasCardTracks = timelineHasCards(timeline);
  const [slotMenu,setSlotMenu]=useState<{clip:TimelineClip;x:number;y:number}|null>(null);
  const [displayMode, setDisplayMode] = useState<"media" | "concept">(() =>
    localStorage.getItem("studio-timeline-display-mode") === "concept" ? "concept" : "media",
  );
  const updateDisplayMode = (mode: "media" | "concept") => {
    setDisplayMode(mode);
    localStorage.setItem("studio-timeline-display-mode", mode);
  };
  useEffect(()=>{if(!slotMenu)return;const close=()=>setSlotMenu(null);window.addEventListener("pointerdown",close);window.addEventListener("blur",close);return()=>{window.removeEventListener("pointerdown",close);window.removeEventListener("blur",close);};},[slotMenu]);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const timelineContentRef = useRef<HTMLDivElement>(null);
  const suppressMarqueeClickRef = useRef(false);
  const boundarySeekRef = useRef<ClipBoundarySeek | undefined>(undefined);
  useEffect(() => { boundarySeekRef.current = undefined; }, [project.id, project.activeTimelineVersionId]);
  useEffect(() => {
    if (selectedClipIds.length !== 1 || selectedClipIds[0] !== boundarySeekRef.current?.clipId) boundarySeekRef.current = undefined;
  }, [selectedClipIds]);
  const [segmentSelectedClipId,setSegmentSelectedClipId] = useState<string>();
  const selectLayoutSegment = (clip: TimelineClip, targetTime: number) => {
    const interval=presentationLayoutIntervals(timeline,clip).find(item=>targetTime>=item.start&&targetTime<item.end)
      || presentationLayoutIntervals(timeline,clip).at(-1);
    if(!interval)return;
    setSegmentSelectedClipId(clip.id);
    onSelectClip(clip.id,false);
    onSeek(Math.max(interval.start,Math.min(interval.end-1/(timeline.fps*4),targetTime)));
  };
  const [clipFocus, setClipFocus] = useState<{start:number;duration:number;viewport:number;zoom:number;nonce:number} | null>(null);
  const focusLeadingSpace = clipFocus ? Math.max(0,clipFocus.viewport/2-(clipFocus.start+clipFocus.duration/2)*42*zoom) : 0;
  useLayoutEffect(() => {
    if (!clipFocus || zoom !== clipFocus.zoom) return;
    timelineScrollRef.current?.scrollTo({left:Math.max(0,focusLeadingSpace+(clipFocus.start+clipFocus.duration/2)*42*zoom-clipFocus.viewport/2),behavior:'instant'});
  }, [clipFocus, zoom, focusLeadingSpace]);
  const focusClip = (clip:TimelineClip) => {
    const viewport=timelineScrollRef.current?.clientWidth || 900;
    const nextZoom=Math.max(MIN_TIMELINE_ZOOM,viewport/(3*42*Math.max(clip.duration,1/timeline.fps)));
    setClipFocus({start:clip.start,duration:clip.duration,viewport,zoom:nextZoom,nonce:(clipFocus?.nonce ?? 0)+1});
    onZoomChange(nextZoom);
    if (!clip.params.layoutSlot) onSelectClip(clip.id,false);
  };
  const contentEnd = Math.max(timelineContentEnd(timeline), 1);
  const width = Math.max(900, contentEnd * 42 * zoom + Math.max(160, 6 * 42 * zoom, clipFocus?.viewport || 0));
  // The old 段落布局 (composition) lane is no longer shown in the editor.
  const displayTracks = useMemo(() => diagramCardTracks(timeline).filter((track) => !track.hiddenInEditor && track.kind !== "openscreen" && track.kind !== "composition").sort((left, right) => {
    const layers=['overlay','enhanced','visual','camera'];
    const l=layers.indexOf(left.kind),r=layers.indexOf(right.kind);
    if(l>=0||r>=0)return (l<0?layers.length:l)-(r<0?layers.length:r);
    return left.order - right.order;
  }), [timeline]);
  // How many card slots are in each state and size, for the legend above the card lanes.
  const cardCounts = useMemo(() => {
    const states: Record<string, number> = {}, sizes: Record<string, number> = {};
    if (!hasCardTracks) return { states, sizes };
    for (const track of displayTracks) {
      if (track.kind !== "overlay" && track.kind !== "enhanced") continue;
      for (const clip of track.clips) {
        const kind = cardSlotState(clip, cardTasks).kind;
        states[kind] = (states[kind] || 0) + 1;
        const appearance = timelineClipAppearance(track.kind, clip);
        const type = "cardType" in appearance ? appearance.cardType : undefined;
        if (type) sizes[type] = (sizes[type] || 0) + 1;
      }
    }
    return { states, sizes };
  }, [displayTracks, cardTasks, hasCardTracks]);
  const [trackViewportHeight,setTrackViewportHeight]=useState(0);
  useLayoutEffect(()=>{
    const element=timelineScrollRef.current;if(!element)return;
    const update=()=>setTrackViewportHeight(element.clientHeight);
    const observer=new ResizeObserver(update);observer.observe(element);update();
    return()=>observer.disconnect();
  },[timelineScrollRef]);
  const trackMinimums=displayTracks.map(track=>['voice','source-bed','music','sfx'].includes(track.kind)?38:['video','proxy'].includes(track.kind)?34:26);
  const minimumTrackHeight=30+trackMinimums.reduce((sum,height)=>sum+height,0);
  const extraTrackHeight=Math.max(0,trackViewportHeight-minimumTrackHeight)/Math.max(1,displayTracks.length);
  const timelineTrackRows=`30px ${trackMinimums.map(height=>`${height+extraTrackHeight}px`).join(' ')}`;
  const directorLayoutClipIds = useMemo(() => new Set(
    timeline.tracks.find((track) => track.kind === "composition")?.clips.map((clip) => clip.id) || [],
  ), [timeline.tracks]);
  const hasDirectorLayoutSelection = selectedClipIds.some((clipId) => directorLayoutClipIds.has(clipId));
  const [dropTarget, setDropTarget] = useState<{
    assetId: string;
    trackId: string;
  }>();
  const [marquee, setMarquee] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>();
  const dropIndicatorRef = useRef<HTMLSpanElement>(null);
  const dropIndicatorLabelRef = useRef<HTMLElement>(null);
  const draggingAsset = project.media.find(
    (asset) => asset.id === draggingAssetId,
  );
  const pixelsPerSecond = 42 * zoom;
  const voiceAnnotationsByClip = useMemo(() => {
    const annotations = new Map<string, VoiceClipAnnotations>();
    const voiceTrack = timeline.tracks.find((track) => track.kind === "voice");
    for (const clip of voiceTrack?.clips || []) {
      annotations.set(clip.id, voiceAnnotationsForClip(clip, project.transcript));
    }
    return annotations;
  }, [project.transcript, timeline.tracks]);
  const rulerStep = timelineRulerStep(pixelsPerSecond);
  const activeDropTargetTrackId =
    dropTarget && dropTarget.assetId === draggingAssetId
      ? dropTarget.trackId
      : undefined;

  const fitTimeline = useCallback(() => {
    setClipFocus(null);
    const viewportWidth = timelineScrollRef.current?.clientWidth || 0;
    onZoomChange(fitTimelineZoom(contentEnd, viewportWidth));
    timelineScrollRef.current?.scrollTo({ left: 0 });
  }, [contentEnd, onZoomChange]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const action = timelineZoomShortcut(event);
      if (!action) return;
      event.preventDefault();
      if (action === 'fit') fitTimeline();
      else onZoomChange(stepTimelineZoom(zoom, action === 'in' ? 1 : -1));
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [fitTimeline, onZoomChange, zoom]);

  const dropTimeForEvent = (
    event: ReactDragEvent<HTMLDivElement>,
  ) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return quantizeToFrame(
      Math.max(0, (event.clientX - bounds.left) / pixelsPerSecond),
      timeline.fps,
    );
  };

  const updateDropIndicator = (trackId: string, time: number, preview?: LibrarySlotDropPreview) => {
    const apply = () => {
      if (dropIndicatorRef.current) {
        dropIndicatorRef.current.style.left = `${(preview?.start ?? time) * pixelsPerSecond}px`;
        dropIndicatorRef.current.style.width = preview ? `${preview.duration * pixelsPerSecond}px` : "";
        dropIndicatorRef.current.className = preview
          ? `timeline-slot-drop-preview is-${preview.mode} is-library-drop-preview`
          : "track-drop-indicator";
      }
      if (dropIndicatorLabelRef.current) {
        dropIndicatorLabelRef.current.textContent = preview?.label ?? `放到 ${timecode(time)}`;
      }
    };
    if (activeDropTargetTrackId !== trackId && draggingAsset) {
      setDropTarget({ assetId: draggingAsset.id, trackId });
      window.requestAnimationFrame(apply);
    } else {
      apply();
    }
  };

  const handleMediaDragOver = (
    event: ReactDragEvent<HTMLDivElement>,
    track: TimelineTrack,
  ) => {
    if (!draggingAsset || !isMediaTrackCompatible(draggingAsset, track)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    const time = dropTimeForEvent(event);
    updateDropIndicator(track.id, time, librarySlotDropPreview(timeline, draggingAsset, track.id, time));
  };

  const handleMediaDrop = (
    event: ReactDragEvent<HTMLDivElement>,
    track: TimelineTrack,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const assetId =
      draggingAssetId ||
      event.dataTransfer.getData(STUDIO_MEDIA_DRAG_TYPE) ||
      event.dataTransfer.getData("text/plain");
    const asset = project.media.find((item) => item.id === assetId);
    setDropTarget(undefined);
    if (!asset || !isMediaTrackCompatible(asset, track)) return;
    onDropMedia(asset, track.id, dropTimeForEvent(event));
  };

  const beginMarqueeSelection = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (
      target.closest(
        ".timeline-clip, .timeline-ruler, .playhead, .track-drop-indicator, .timeline-cut-range",
      )
    ) return;
    const content = timelineContentRef.current;
    if (!content) return;
    event.preventDefault();
    const contentBounds = content.getBoundingClientRect();
    const originClientX = event.clientX;
    const originClientY = event.clientY;
    const originX = originClientX - contentBounds.left;
    const originY = originClientY - contentBounds.top;
    const initialSelection = [...selectedClipIds];
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    let moved = false;

    const move = (nextEvent: PointerEvent) => {
      if (
        !moved &&
        Math.hypot(
          nextEvent.clientX - originClientX,
          nextEvent.clientY - originClientY,
        ) < 4
      ) return;
      moved = true;
      suppressMarqueeClickRef.current = true;
      const currentX = nextEvent.clientX - contentBounds.left;
      const currentY = nextEvent.clientY - contentBounds.top;
      const localRect = normalizedSelectionRect(
        originX,
        originY,
        currentX,
        currentY,
      );
      setMarquee({
        left: localRect.left,
        top: localRect.top,
        width: localRect.right - localRect.left,
        height: localRect.bottom - localRect.top,
      });
      const clientRect = normalizedSelectionRect(
        originClientX,
        originClientY,
        nextEvent.clientX,
        nextEvent.clientY,
      );
      const hits = Array.from(
        content.querySelectorAll<HTMLElement>("[data-timeline-clip-id]"),
      ).flatMap((element) => {
        const bounds = element.getBoundingClientRect();
        return selectionRectsIntersect(clientRect, {
          left: bounds.left,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
        })
          ? [element.dataset.timelineClipId || ""]
          : [];
      }).filter(Boolean);
      onSelectClips(mergeMarqueeSelection(initialSelection, hits, additive));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setMarquee(undefined);
      if (moved) {
        window.setTimeout(() => {
          suppressMarqueeClickRef.current = false;
        }, 0);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <section className={`timeline-shell timeline-shell--${displayMode} ${hasCardTracks?'has-card-actions':''} ${pendingCut ? "has-cut-range" : ""}`}>
      <div className="timeline-toolbar">
        <ToolbarHint title="撤销" shortcut="⌘Z">
          <button onClick={onUndo} aria-label="撤销">
            <Undo2 />
          </button>
        </ToolbarHint>
        <ToolbarHint title="重做" shortcut="⇧⌘Z">
          <button onClick={onRedo} aria-label="重做">
            <Redo2 />
          </button>
        </ToolbarHint>
        <span />
        <div className="timeline-tool-group" role="group" aria-label="剪切">
          {!generalTools && <ToolbarHint title="分割" shortcut="B" detail="在播放头处把选中的素材切成两段；按住 Alt/Option 点击素材可精确定位。">
            <button onClick={onSplit} aria-label="分割" disabled={selectedClipIds.length !== 1 || hasDirectorLayoutSelection}>
              <Scissors />
            </button>
          </ToolbarHint>}
          <ToolbarHint title={pendingCut ? "删除区间" : "删除"} shortcut="⌫" detail={pendingCut ? "删除〈 〉标出的区间。" : "删除选中的素材，可多选。"}>
            <button
              onClick={onDelete}
              aria-label={pendingCut ? "删除区间" : selectedClipIds.length > 1 ? `删除 ${selectedClipIds.length} 个素材` : "删除"}
              disabled={cutBusy || (!pendingCut && (!selectedClipIds.length || hasDirectorLayoutSelection))}
            >
              <Trash2 />
              {pendingCut ? <small>区间</small> : selectedClipIds.length > 1 ? <small>{selectedClipIds.length}</small> : null}
            </button>
          </ToolbarHint>
          {!generalTools && <><ToolbarHint title="删除起点" shortcut="," detail="从播放头开始标一段要删的区间，默认向后 2 秒；按住 Alt/Option 点击素材定位。">
            <button onClick={()=>onMarkCutEdge('start')} aria-label="设置删除起点" disabled={!selectedClipIds.length && !pendingCut}>〈</button>
          </ToolbarHint>
          <ToolbarHint title="删除终点" shortcut="." detail="把播放头设为要删区间的终点，默认向前 2 秒。">
            <button onClick={()=>onMarkCutEdge('end')} aria-label="设置删除终点" disabled={!selectedClipIds.length && !pendingCut}>〉</button>
          </ToolbarHint></>}
        </div>
        <span />
        {/* Left to right follows the editing order: cut the talk, build the picture, then the sound. */}
        {generalTools ?? <TimelineSmartTools onSmartMusic={onSmartMusic} smartMusicBusy={smartMusicBusy} onSmartRoughcut={onSmartRoughcut}
          onGlobalMotion={onGlobalMotion} onGlobalSfx={onGlobalSfx} onSmartBroll={onSmartBroll} onAutoPlace={onAutoPlace}
          autoPlaceRunning={autoPlaceRunning} globalMotionDisabled={globalMotionDisabled}/>}
        <i />
        <div className="timeline-display-mode" role="group" aria-label="轨道显示模式">
          <button
            className={displayMode === "media" ? "is-active" : ""}
            aria-pressed={displayMode === "media"}
            onClick={() => updateDisplayMode("media")}
            title="显示视频缩略图和音频波形"
          >素材</button>
          <button
            className={displayMode === "concept" ? "is-active" : ""}
            aria-pressed={displayMode === "concept"}
            onClick={() => updateDisplayMode("concept")}
            title="使用轨道角色色块概览剪辑结构"
          >色块</button>
        </div>
        <span />
        <ToolbarHint title={`吸附 · ${snappingEnabled ? "已开启" : "已关闭"}`} detail="拖动素材时，自动贴住时间线开头和其他片段（包括字幕）的边缘。">
          <button
            className={snappingEnabled ? "is-active" : ""}
            aria-pressed={snappingEnabled}
            aria-label="吸附"
            onClick={() => onSnappingChange(!snappingEnabled)}
          >
            <Magnet />
          </button>
        </ToolbarHint>
        {!generalTools && <ToolbarHint title={`主轨联动 · ${mainTrackLinked ? "已开启" : "已关闭"}`} detail="视频和人声一起分割；删除主轨或区间时，所有轨道一起收拢。">
          <button aria-label="主轨联动" aria-pressed={mainTrackLinked} className={mainTrackLinked?'is-active':''} onClick={()=>onMainTrackLinkedChange(!mainTrackLinked)}><Link2 /></button>
        </ToolbarHint>}
        <span />
        <ToolbarHint title="时间线专注" detail="收起预览和素材区，把整个窗口留给时间线；再点一次恢复。">
          <button aria-pressed={focusTimeline} onClick={onToggleFocus} className={focusTimeline ? "is-active" : ""} aria-label="时间线专注"><Focus /></button>
        </ToolbarHint>
        <button
          className="timeline-zoom-button"
          onClick={() => onZoomChange(stepTimelineZoom(zoom, -1))}
          title="缩小（Ctrl/Cmd -）"
          aria-label="缩小时间线"
        >
          <ZoomOut />
        </button>
        <input
          type="range"
          min={MIN_TIMELINE_ZOOM}
          max={Math.max(MAX_TIMELINE_ZOOM,zoom)}
          step="0.05"
          value={zoom}
          aria-label="时间线缩放"
          onChange={(event) => onZoomChange(Number(event.target.value))}
        />
        <button
          className="timeline-zoom-button"
          onClick={() => onZoomChange(stepTimelineZoom(zoom, 1))}
          title="放大（Ctrl/Cmd +）"
          aria-label="放大时间线"
        >
          <ZoomIn />
        </button>
        <button
          className="timeline-zoom-button"
          onClick={fitTimeline}
          title="完整显示全部轨道（Ctrl/Cmd 0）"
          aria-label="完整显示全部轨道"
        >
          <Maximize2 />
        </button>
        <b>{Math.round(zoom * 100)}%</b>
      </div>
      {pendingCut&&<div className="timeline-cut-controls" role="group" aria-label="待删除区间">
        <strong>待删除 · {(pendingCut.end-pendingCut.start).toFixed(2)} 秒</strong>
        <span>{pendingCut.ripple?'全轨道 · 预览时跳过':'仅所选素材 · 预览时隐藏'}</span>
        <label>起点 <input aria-label="删除起点秒数" type="number" min={0} max={pendingCut.end-1/timeline.fps} step={1/timeline.fps} value={Number(pendingCut.start.toFixed(3))} onChange={e=>{if(e.currentTarget.value!==''&&Number.isFinite(e.currentTarget.valueAsNumber))onCutBoundaryChange('start',e.currentTarget.valueAsNumber);}} /></label>
        <label>终点 <input aria-label="删除终点秒数" type="number" min={pendingCut.start+1/timeline.fps} max={timeline.duration} step={1/timeline.fps} value={Number(pendingCut.end.toFixed(3))} onChange={e=>{if(e.currentTarget.value!==''&&Number.isFinite(e.currentTarget.valueAsNumber))onCutBoundaryChange('end',e.currentTarget.valueAsNumber);}} /></label>
        <button onClick={onPreviewCut}>试听剪口</button><button onClick={onDelete} disabled={cutBusy||globalMotionDisabled}>删除区间</button><button onClick={onCancelCut}>取消 Esc</button>
      </div>}
      {hasCardTracks&&<div className="timeline-card-actions"><button disabled={globalMotionDisabled} onClick={onAddEmptyCard}>＋ 新增空卡位</button>
        <div className="timeline-card-legend" role="list" aria-label="卡位状态">
          {CARD_SLOT_LEGEND.map(item => <span role="listitem" key={item.kind} data-card-state={item.kind} className={cardCounts.states[item.kind] ? "" : "is-zero"}>
            <i className="timeline-card-state-icon" aria-hidden="true">{item.icon}</i>{item.label}<b>{cardCounts.states[item.kind] || 0}</b>
          </span>)}
        </div>
        <div className="timeline-card-legend timeline-card-legend--sizes" role="list" aria-label="卡型">
          {(["small", "half", "full"] as const).map(type => <span role="listitem" key={type} data-motion-card-type={type} className={cardCounts.sizes[type] ? "" : "is-zero"}>
            <i className="motion-card-size-badge" aria-hidden="true">{MOTION_CARD_TIMELINE_LABELS[type]}</i>{{small: "小卡", half: "半卡", full: "全卡"}[type]}<b>{cardCounts.sizes[type] || 0}</b>
          </span>)}
        </div>
      </div>}
      <div className="timeline-body">
        <div className="track-heads" style={{ gridTemplateRows: timelineTrackRows }}>
          <div className="ruler-spacer" />
          {displayTracks.map((track) => (
            <div
              className={`track-head track-head--${track.kind}`}
              key={track.id}
            >
              <span>
                {track.kind === "subtitle" ? (
                  <Captions />
                ) : track.kind === "voice" ? (
                  <Mic2 />
                ) : track.kind === "music" ? (
                  <Music2 />
                ) : (
                  <FilmIcon />
                )}
              </span>
              <b title={track.kind === "visual" ? (track.brollMediaType === "image" ? "B-roll 图片：原比例图片叠加" : "B-roll 视频：补充视频") : track.kind === "camera" ? "录屏视频：放置录屏素材" : track.name}>{track.kind === "visual" && track.name === "补充画面" ? "B-roll" : track.kind === "camera" && track.name === "录屏运镜" ? "录屏视频" : track.name}</b>
              <button aria-label={`${track.hidden ? "显示" : "隐藏"}${track.name}`} aria-pressed={!!track.hidden} onClick={() => onToggleTrack(track.id, "hidden")}>
                {track.hidden ? <EyeOff /> : <Eye />}
              </button>
              <button aria-label={`${track.locked ? "解锁" : "锁定"}${track.name}`} aria-pressed={!!track.locked} onClick={() => onToggleTrack(track.id, "locked")}>
                {track.locked ? <Lock /> : <Unlock />}
              </button>
              <button aria-label={`${track.muted ? "取消静音" : "静音"}${track.name}`} aria-pressed={!!track.muted} onClick={() => onToggleTrack(track.id, "muted")}>
                {track.muted ? <VolumeX /> : <Volume2 />}
              </button>
              {['voice','music','sfx','source-bed'].includes(track.kind)&&<div className="track-volume-control" aria-label={`${track.name}整轨音量`}>
                <input aria-label={`${track.name}音量 dB`} aria-valuetext={volumeLabel(track.volume??1)} title="0 dB 保持原音量；最高 +20 dB；双击恢复 0 dB" type="range" min="-60" max="20" step="0.5" value={volumeDb(track.volume??1).toFixed(1)} disabled={track.locked||globalMotionDisabled}
                  onDoubleClick={()=>{if(!track.locked&&!globalMotionDisabled)onTrackVolume(track.id,1);}}
                  onKeyDown={e=>{const direction=['ArrowRight','ArrowUp'].includes(e.key)?1:['ArrowLeft','ArrowDown'].includes(e.key)?-1:0;if(direction){e.preventDefault();onTrackVolume(track.id,volumeGain(Math.max(-60,Math.min(20,snapVolumeDb(volumeDb(track.volume??1))+direction*.5))));}}}
                  onChange={e=>onTrackVolume(track.id,volumeGain(snapVolumeDb(Number(e.currentTarget.value))))}/>
                <output>{volumeLabel(track.volume??1)}</output>
              </div>}
            </div>
          ))}
        </div>
        <div ref={timelineScrollRef} className="timeline-scroll" onScroll={event=>{const heads=event.currentTarget.previousElementSibling;if(heads instanceof HTMLElement)heads.scrollTop=event.currentTarget.scrollTop}}>
          <div
            ref={timelineContentRef}
            className="timeline-content"
            style={{ width, marginLeft: focusLeadingSpace, gridTemplateRows: timelineTrackRows }}
            onPointerDown={beginMarqueeSelection}
            onClick={(event) => {
              if (suppressMarqueeClickRef.current) return;
              boundarySeekRef.current = undefined;
              const rect = event.currentTarget.getBoundingClientRect();
              onClearSelection();
              onSeek((event.clientX - rect.left) / (42 * zoom));
            }}
          >
            <div className="timeline-ruler" onClick={event=>{event.stopPropagation();boundarySeekRef.current=undefined;const bounds=event.currentTarget.getBoundingClientRect();onSeek(quantizeToFrame((event.clientX-bounds.left)/pixelsPerSecond,timeline.fps));}}>
              {Array.from(
                { length: Math.ceil(contentEnd / rulerStep) + 1 },
                (_, index) => (
                  <span
                    key={index}
                    style={{ left: index * rulerStep * pixelsPerSecond }}
                  >
                    {timecode(index * rulerStep).slice(0, 5)}
                  </span>
                ),
              )}
            </div>
            {displayTracks.map((track) => (
              <div
                className={`track-lane track-lane--${track.kind} ${activeDropTargetTrackId === track.id ? "is-drop-target" : ""}`}
                key={track.id}
                data-studio-track-id={track.id}
                onDragOver={(event) => handleMediaDragOver(event, track)}
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                  if (activeDropTargetTrackId === track.id) {
                    setDropTarget(undefined);
                  }
                }}
                onDrop={(event) => handleMediaDrop(event, track)}
              >
                {activeDropTargetTrackId === track.id ? (
                  <span ref={dropIndicatorRef} className="track-drop-indicator">
                    <b ref={dropIndicatorLabelRef}>放到 00:00</b>
                  </span>
                ) : null}
                {track.kind === "composition" && slotMenu && <div role="menu" className="director-slot-menu" style={{position:'fixed',left:slotMenu.x,top:slotMenu.y}} onPointerDown={e=>e.stopPropagation()} onContextMenu={e=>e.preventDefault()}>
                  <button role="menuitem" disabled={globalMotionDisabled} onClick={()=>{onInsertDirectorGap(slotMenu.clip.start+slotMenu.clip.duration);setSlotMenu(null);}}>增加</button>
                  <button role="menuitem" disabled={globalMotionDisabled} title={slotMenu.clip.params.inserted?'删除该空白段并收回时长':'删除布局安排，保留原视频段落'} onClick={()=>{onEditDirectorSlot(slotMenu.clip,'delete');setSlotMenu(null);}}>删除</button>
                  <button role="menuitem" disabled={globalMotionDisabled} title="清空布局安排，保留段落时长" onClick={()=>{onEditDirectorSlot(slotMenu.clip,'clear');setSlotMenu(null);}}>清空</button>
                </div>}
                {track.clips.map((clip) => {
                  const actualTrack=timeline.tracks.find(t=>t.id===clip.trackId)||track;
                  const state=hasCardTracks&&(track.kind==='overlay'||track.kind==='enhanced')?cardSlotState(clip,cardTasks):undefined;
                  const appearance = timelineClipAppearance(track.kind, clip);
                  const durationTarget = track.kind === "composition" && typeof clip.params.authoredId === "string"
                    ? timeline.tracks.find((item) => item.id === track.id)?.clips.find((item) => item.id === clip.params.authoredId)
                    : clip;
                  // 通用剪辑 (generalTools set): every clip can be moved and trimmed at both ends
                  const hasDurationHandle = Boolean(generalTools) || (track.kind === "overlay" || track.kind === "enhanced") || (track.kind === "subtitle" && !clip.params.timelineGap) || ((track.kind === 'visual' || track.kind === 'camera') && Boolean(clip.assetId)) || (
                    track.kind === "composition" && Boolean(durationTarget) &&
                    Math.abs(clip.start + clip.duration - (durationTarget!.start + durationTarget!.duration)) < 1 / timeline.fps
                  );
                  const layoutIntervals=(track.kind==='overlay'||(['video','visual','camera'].includes(track.kind)&&clip.assetId)) ? presentationLayoutIntervals(timeline,clip) : [];
                  const selectedInterval=segmentSelectedClipId===clip.id&&selectedClipIds.includes(clip.id)
                    ? layoutIntervals.find(item=>playhead>=item.start&&playhead<item.end) : undefined;
                  return (
                  <button
                    key={clip.id}
                    data-timeline-clip-id={clip.id}
                    data-card-state={state?.kind}
                    data-motion-card-type={(track.kind === "overlay" || track.kind === "enhanced") && "cardType" in appearance
                      ? appearance.cardType
                      : undefined}
                    className={`timeline-clip ${clip.params.timelineGap ? "timeline-clip--timeline-gap" : ""} ${clip.params.layoutSlot ? `timeline-clip--slot ${clip.params.edited ? "timeline-clip--edited-slot" : clip.params.inserted ? "timeline-clip--inserted-slot" : ""}` : ""} ${track.kind === "composition" ? "timeline-clip--director" : ""} ${selectedClipIds.includes(clip.id) ? "selected" : ""} ${selectedInterval ? "timeline-clip--segment-selected" : ""} ${draggingClip === clip.id ? "dragging" : ""} ${slotDrop?.targetClipId === clip.id ? "slot-drop-target" : ""} ${resizingClip === clip.id ? "resizing" : ""}`}
                    style={{
                      left: clip.start * 42 * zoom,
                      width: clip.params.layoutSlot || (track.kind === "overlay" || track.kind === "enhanced") ? Math.max(1,clip.duration * pixelsPerSecond) : Math.max(
                        zoom < 0.25 ? 3 : 24,
                        clip.duration * pixelsPerSecond,
                      ),
                      ...((track.kind === "overlay" || track.kind === "enhanced") && clip.duration * pixelsPerSecond < 24 ? {minWidth:0,padding:0,borderWidth:Math.min(1,clip.duration*pixelsPerSecond/2)} : {}),
                      ...(clip.params.layoutSlot ? {borderWidth:Math.min(1,clip.duration*pixelsPerSecond/2),minWidth:0,padding:0} : {}),
                      background: state&&state.kind!=='ready' ? `color-mix(in srgb, ${appearance.background} 28%, transparent)` : clip.params.timelineGap ? "#495159" : displayMode === "concept"
                        ? undefined
                        : clip.params.pendingGeneration ? "#ff453a" : appearance.background,
                      borderStyle:state&&state.kind!=='ready'?'dashed':undefined,
                      color: state&&state.kind!=='ready'?'var(--studio-text)':clip.params.pendingGeneration ? "#fff" : appearance.color,
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      if(suppressTimelineClickRef.current){boundarySeekRef.current=undefined;return;}
                      event.currentTarget.focus({preventScroll:true});
                      if(event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)boundarySeekRef.current=undefined;
                      if(event.altKey){
                        const lane=event.currentTarget.closest('.track-lane')!.getBoundingClientRect();
                        onSelectClip(clip.id,false);
                        onSeek(quantizeToFrame(Math.max(clip.start,Math.min(clip.start+clip.duration,(event.clientX-lane.left)/pixelsPerSecond)),timeline.fps));return;
                      }
                      if(event.ctrlKey && layoutIntervals.length>1){
                        event.preventDefault();
                        if(event.detail===0)return;
                        const bounds=event.currentTarget.getBoundingClientRect();
                        selectLayoutSegment(clip,clip.start+Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width))*clip.duration);
                        return;
                      }
                      setSegmentSelectedClipId(undefined);
                      if (event.metaKey && event.button === 0) {
                        event.preventDefault();
                        focusClip(clip);
                        return;
                      }
                      if (suppressTimelineClickRef.current) return;
                      onSelectClip(
                        clip.id,
                        event.shiftKey || event.ctrlKey || event.metaKey,
                      );
                      if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
                        const next = nextClipBoundarySeek(boundarySeekRef.current, clip, timeline.fps, playhead);
                        boundarySeekRef.current = next;
                        onSeek(next.time);
                      }
                      if (track.kind === "composition" && typeof clip.params.directorSceneId === "string") {
                        onOpenDirectorScene(clip.params.directorSceneId);
                      }
                    }}
                    onPointerDown={(event) => {
                      if (track.kind === "composition") {
                        event.stopPropagation();
                        return;
                      }
                      if(event.ctrlKey && layoutIntervals.length>1){
                        event.preventDefault();event.stopPropagation();
                        const bounds=event.currentTarget.getBoundingClientRect();
                        selectLayoutSegment(clip,clip.start+Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width))*clip.duration);
                        return;
                      }
                      if (clip.params.timelineGap || event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return;
                      onBeginClipDrag(event, clip, actualTrack);
                    }}
                    onKeyDown={(event)=>{
                      if(event.ctrlKey&&(event.key==='Enter'||event.key===' ')&&layoutIntervals.length>1){
                        event.preventDefault();event.stopPropagation();
                        selectLayoutSegment(clip,playhead>=clip.start&&playhead<clip.start+clip.duration?playhead:clip.start+1/timeline.fps);
                      }
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if(event.ctrlKey && layoutIntervals.length>1)return;
                      if (clip.params.layoutSlot) {setSlotMenu({clip,x:Math.min(event.clientX,window.innerWidth-170),y:Math.min(event.clientY,window.innerHeight-140)});return;}
                      if (track.kind === "composition") return;
                      onOpenClipMenu(clip.id, event.clientX, event.clientY);
                    }}
                    onDoubleClick={(event) => {
                      boundarySeekRef.current = undefined;
                      if (clip.params.layoutSlot) { event.preventDefault(); event.stopPropagation(); onOpenDirectorSlot(clip); return; }
                      if (track.kind !== "overlay") return;
                      event.preventDefault();
                      event.stopPropagation();
                      onEditOverlay(clip.id);
                      onSeek(clip.start + clip.duration * 0.38);
                    }}
                    aria-label={track.kind === "composition" ? `${clip.name} · ${clip.params.layoutSlot ? "导演布局槽" : "打开导演场景"}` : undefined}
                    title={track.kind === "composition"
                      ? `${clip.name} · ${clip.params.layoutSlot ? (clip.params.needsReview ? "原卡片已变化，双击复核段落设置" : clip.params.inserted ? "新增空白段，尚未添加内容" : "未配置，沿用原画面") : "点击编辑导演场景"}`
                      : `${state?state.label+' · ':''}${clip.name} · ${clip.duration.toFixed(2)}s · 点击首帧，再点尾帧；Alt/Option + 点击精确定位`}
                  >
                    {state&&<span className="timeline-card-status" aria-label={state.label} title={state.label}><span className="timeline-card-state-icon" aria-hidden="true">{state.icon}</span>{clip.duration*pixelsPerSecond>150&&<span>{state.label}</span>}</span>}
                    {selectedInterval&&<span className="timeline-clip-segment-selection" style={{left:`${(selectedInterval.start-clip.start)/clip.duration*100}%`,width:`${(selectedInterval.end-selectedInterval.start)/clip.duration*100}%`}} aria-hidden="true" />}
                    {displayMode === "concept" ? (
                      <>
                        {(track.kind === "overlay" || track.kind === "enhanced") && "badge" in appearance ? (
                          <span className="motion-card-size-badge" aria-hidden="true">
                            {appearance.badge}
                          </span>
                        ) : null}
                        <b className="timeline-concept-label">{clip.params.layoutSlot && !clip.params.edited ? "" : timelineClipLabel(track.kind, clip, Boolean(state))}</b>
                      </>
                    ) : ([
                      "video",
                      "proxy",
                      "visual",
                      "voice",
                      "source-bed",
                      "music",
                      "sfx",
                    ].includes(track.kind) ? (
                      <TimelineMediaStrip
                        projectId={project.id}
                        asset={project.media.find(
                          (asset) => asset.id === clip.assetId,
                        )}
                        clip={clip}
                        trackKind={track.kind}
                        voiceAnnotations={track.kind === "voice"
                          ? voiceAnnotationsByClip.get(clip.id)
                          : undefined}
                        pixelsPerSecond={42 * zoom}
                      />
                    ) : (track.kind === "overlay" || track.kind === "enhanced") && "badge" in appearance ? (
                      <>
                        <span className="motion-card-size-badge" aria-hidden="true">
                          {appearance.badge}
                        </span>
                        <b>{clip.params.layoutSlot && !clip.params.edited ? "" : timelineClipLabel(track.kind, clip, Boolean(state))}</b>
                      </>
                    ) : (
                      <b>{clip.params.layoutSlot && !clip.params.edited ? "" : timelineClipLabel(track.kind, clip, Boolean(state))}</b>
                    ))}
                    {layoutIntervals.slice(1).map(interval=>interval.start)
                      .map(point=><span key={`layout-${point}`} className="timeline-clip-layout-boundary" style={{left:`${(point-clip.start)/clip.duration*100}%`}} title="布局区间边界；原素材未切割" aria-hidden="true" />)}
                    {(Boolean(generalTools) || track.kind === 'overlay' || track.kind === 'enhanced' || ((track.kind === 'visual' || track.kind === 'camera') && clip.assetId)) && <span
                      className="timeline-clip-duration-handle timeline-clip-duration-handle--left"
                      title={generalTools ? "拖动起点，终点不动；自动吸附其他片段的边缘" : (track.kind === "overlay" || track.kind === "enhanced") ? "拖动起点调整动效卡范围，终点保持不变；自动吸附段落边界" : "拖动左侧调整素材覆盖范围，自动吸附段落边界"}
                      onPointerDown={event => onBeginClipDurationResize(event, clip, actualTrack, 'left')}
                      onClick={event => event.stopPropagation()}
                      onDoubleClick={event => event.stopPropagation()}
                    />}
                    {hasDurationHandle ? (
                      <span
                        className="timeline-clip-duration-handle"
                        title={generalTools ? `拖动尾部调整时长（当前 ${clip.duration.toFixed(2)} 秒）` : (track.kind === "overlay" || track.kind === "enhanced")
                          ? `拖动尾部调整动效时长（当前 ${clip.duration.toFixed(2)} 秒）；入场、停留和退场会完整等比播放`
                          : `拖动尾部调整${track.kind === "subtitle" ? "字幕" : track.kind === 'visual' || track.kind === 'camera' ? '录屏覆盖范围，可跨越连续段落' : "导演段落"}时长（当前 ${(durationTarget?.duration || clip.duration).toFixed(2)} 秒）`}
                        onPointerDown={(event) =>
                          onBeginClipDurationResize(event, clip, actualTrack)
                        }
                        onClick={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                      >
                        <i>{(durationTarget?.duration || clip.duration).toFixed(1)}s</i>
                      </span>
                    ) : null}
                  </button>
                  );
                })}
                {pendingCut && !pendingCut.ripple && track.clips.some(c=>c.id===pendingCut.clipId) && <CutRangeOverlay range={pendingCut} pixelsPerSecond={pixelsPerSecond} fps={timeline.fps} duration={timeline.duration} snapping={snappingEnabled} timelineEdges={timeline.tracks.flatMap(t=>t.clips.flatMap(c=>[c.start,c.start+c.duration]))} onChange={onCutBoundaryChange} onRestore={onRestoreCut} onSeek={onSeek}/>}
                {slotDrop?.trackId === track.id ? <div
                  className={`timeline-slot-drop-preview is-${slotDrop.mode}`}
                  style={{left:slotDrop.start * pixelsPerSecond,width:Math.max(24,slotDrop.duration * pixelsPerSecond)}}
                  aria-label={slotDrop.label}
                ><b>{slotDrop.mode === 'swap' ? '交换' : slotDrop.mode === 'expand' ? '原时长放入' : '移动适配'}</b></div> : null}
              </div>
            ))}
            {pendingCut?.ripple && <CutRangeOverlay range={pendingCut} pixelsPerSecond={pixelsPerSecond} fps={timeline.fps} duration={timeline.duration} snapping={snappingEnabled} timelineEdges={timeline.tracks.flatMap(t=>t.clips.flatMap(c=>[c.start,c.start+c.duration]))} onChange={onCutBoundaryChange} onRestore={onRestoreCut} onSeek={onSeek}/>}
            {snapGuide !== undefined ? (
              <div
                className="timeline-snap-guide"
                style={{ left: snapGuide * 42 * zoom }}
                aria-hidden="true"
              >
                <b>对齐 {timecode(snapGuide)}</b>
              </div>
            ) : null}
            {marquee ? (
              <div
                className="timeline-selection-marquee"
                style={marquee}
                aria-hidden="true"
              />
            ) : null}
            <div
              ref={timelinePlayheadRef}
              className="playhead"
              style={{ left: playhead * 42 * zoom }}
            >
              <i />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
