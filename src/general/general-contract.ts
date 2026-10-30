import type {AgentConnectionId} from '../../shared/agent-connections';
import type {ExportSettings} from '../types/editor';
/**
 * 通用剪辑 (general editing): the contract between the pages (src/pages/General*.tsx) and the server (server/general/).
 * A general project lives in the shared projects root as its own folder with general-project.json, so the 0.2.40
 * release (which reads only project.json) neither sees nor rewrites it. Every type here is plain JSON.
 */
export type GeneralAspect = '16:9' | '9:16';
export type GeneralLength = 15 | 30 | 60 | 'auto';
export type GeneralInputKind = 'footage' | 'topic';
/** 不用风格: no style rules, the film follows the person's own words (server/general/brief.ts FREE_STYLE). */
export const FREE_STYLE_ID = 'free';
/** Seconds as decimals; times are ISO strings. */
export type GeneralSettings = { aspect: GeneralAspect; length: GeneralLength };

export type GeneralMedia = { id: string; name: string; duration: number; width: number; height: number; poster?: string; /** its file in media/ (id + extension); older projects lack it */ file?: string };
export type GeneralInputs = { kind: GeneralInputKind; media: GeneralMedia[]; text: string; note: string };

/** The steps of one run, in the order a run shows them (the Codex trial's real flow). */
export const GENERAL_STEP_IDS = ['read-style', 'read-input', 'plan', 'code', 'self-check', 'render', 'review', 'deliver'] as const;
export type GeneralStepId = typeof GENERAL_STEP_IDS[number];
export type GeneralStepState = 'waiting' | 'running' | 'done' | 'failed' | 'skipped';
export type GeneralStep = {
  id: GeneralStepId; state: GeneralStepState; label: string; detail?: string;
  /** frames the agent or the reviewer looked at (urls served by the server) */
  thumbs?: string[];
  /** render: seconds rendered so far / total */
  progress?: { done: number; total: number };
  startedAt?: string; endedAt?: string;
};
export type GeneralPlan = { title: string; logline: string; duration: number; segments: GeneralSegment[]; markdownUrl?: string };
export type GeneralSegment = { name: string; start: number; end: number; id?: string; transition?: GeneralTransition };
/** Between a segment and the one before it (docs/通用剪辑-分轨出片格式.md); OpenTake renders them. */
export type GeneralTransition = 'cut' | 'dissolve' | 'fade' | 'dip-black' | 'dip-white';

export type GeneralRunState = 'idle' | 'running' | 'stopping' | 'stopped' | 'needs-network' | 'done' | 'failed';
export type GeneralRun = {
  id: string; state: GeneralRunState; agent: 'codex' | 'claude'; method?: 'cli' | 'api'; model?: string; effort?: string;
  /** what this run makes: the first cut, or the next version from a message */
  purpose: 'first' | 'revision' | 'resume';
  steps: GeneralStep[]; startedAt: string; endedAt?: string; error?: string;
  /** the agent asked to reach the network; the page shows the question until it is answered */
  networkRequest?: { reason: string; hosts: string[] };
  /** messages the person sent while the run worked; the agent sees them when its current step ends */
  queued: number;
  round?: number; repairReason?: string;
  rounds?: { round: number; steps: GeneralStep[] }[];
};

export type GeneralVersion = {
  n: number; createdAt: string; duration: number; videoUrl: string; posterUrl: string;
  segments: GeneralSegment[]; note?: string;
  /** a layered film (film.json version 2): versions/vN/layers.json, the tracks the page edits */
  layersUrl?: string;
};
/**
 * A layered version's tracks, in the 口播 editor's timeline shape (src/types/editor.ts), plus what the timeline itself
 * has no field for. Paths inside clips are relative to `base` (the version's snapshot of the agent's work folder).
 */
export type GeneralLayers = {
  /** Optional source metadata retained by the reversible snapshot conversion. */
  filmMetadata?: { title?: string; logline?: string; locked?: string[] };
  format: 'opentake.general.layers'; version: 1;
  /** a HyperFrames film: the page (`entry`, under `base`) is the project; its clips are read from it */
  engine?: 'hyperframes'; entry?: string;
  width: number; height: number; fps: number; duration: number;
  segments: (GeneralSegment & { id: string; transition: GeneralTransition })[];
  ending: 'cut' | 'fade'; finish: string; base: string;
  timeline: import('../types/editor.ts').Timeline;
};
/** A HyperFrames film's edits, by clip id, as its page applies them (server/general/hf-edit-bridge.js). */
export type HfPageEdits = { text?: Record<string, Record<string, string>>; moves?: Record<string, Record<string, unknown>> };
export function hfPageEdits(layers: Pick<GeneralLayers, 'timeline'>): HfPageEdits {
  const text: NonNullable<HfPageEdits['text']> = {}, moves: NonNullable<HfPageEdits['moves']> = {};
  for (const track of layers.timeline.tracks) for (const clip of track.clips) {
    if (!clip.params.hf) continue;
    const words = clip.params.textEdits as Record<string, string> | undefined, moved = clip.params.overrides as Record<string, unknown> | undefined;
    if (words && Object.keys(words).length) text[clip.id] = words;
    if (moved && Object.keys(moved).length) moves[clip.id] = moved;
  }
  return { text, moves };
}
export type GeneralReference = { time: number; rect: { x: number; y: number; w: number; h: number }; imageDataUrl?: string };
export type GeneralMessage = {
  id: string; role: 'person' | 'agent' | 'system'; text: string; at: string;
  reference?: GeneralReference; version?: number;
};

/** Export status is additive: old projects have no exportTask until their first export. */
export type GeneralExport = {
  id: string; version: number; format: 'mp4' | 'jianying'; state: 'running' | 'done' | 'failed' | 'cancelled';
  step: string; progress: number; startedAt: string; endedAt?: string; error?: string; downloadUrl?: string;
  /** a 剪映 export: the 剪映工程 folder (with its double-click importers), shown in Finder */
  folder?: string;
  outputDir?: string; settings?: ExportSettings; media?: {width:number;height:number;fps:number};
};
export type GeneralProject = {
  exportTask?: GeneralExport;
  id: string; kind: 'general'; name: string; styleId: string; createdAt: string; updatedAt: string;
  settings: GeneralSettings; inputs: GeneralInputs; plan?: GeneralPlan;
  versions: GeneralVersion[]; run?: GeneralRun; messages: GeneralMessage[];
  /** the version the page shows by default (the newest) */
  current?: number;
  /** the model and reasoning effort this project's agent uses; absent = 系统默认 (settings → 通用剪辑出片) */
  agent?: GeneralAgentChoice;
  /** 联网: the agent's commands may reach the network from the start (default off; it can still ask) */
  network?: boolean;
};
export type GeneralAgentChoice = { agent?: AgentConnectionId; model: string; effort: string };
/** One row of the shared project library (home page, /studio) for a general project. */
export type GeneralProjectSummary = {
  id: string; kind: 'general'; name: string; styleId: string; updatedAt: string; createdAt: string;
  duration?: number; posterUrl?: string; runState?: GeneralRunState; versions: number;
};

/**
 * HTTP API, all under /api/general (local requests only, same rules as the other AI routes):
 *   GET    /projects                          → GeneralProjectSummary[]
 *   POST   /projects        {styleId, settings, inputs:{kind,text,note}} → GeneralProject
 *   GET    /projects/:id                       → GeneralProject
 *   PATCH  /projects/:id    {name?, settings?, inputs?:{text?,note?}} → GeneralProject
 *   DELETE /projects/:id                       → moves it to the trash like other projects
 *   POST   /projects/:id/media   body = the file, header x-file-name (URI-encoded) → GeneralMedia
 *   DELETE /projects/:id/media/:mediaId        → GeneralProject
 *   POST   /projects/:id/generate               → GeneralProject (starts the first cut)
 *   POST   /projects/:id/stop                   → GeneralProject (keeps plan, code and frames)
 *   POST   /projects/:id/resume                 → GeneralProject (continues a stopped run)
 *   POST   /projects/:id/messages {text, reference?} → GeneralProject (queued while running; otherwise starts a revision → next version)
 *   POST   /projects/:id/network  {allow: boolean} → GeneralProject
 *   GET    /projects/:id/events                 → text/event-stream; each event `data:` is a full GeneralProject
 *   GET    /projects/:id/files/*                → versions, posters, thumbs, plan (range requests for video)
 */
export const GENERAL_API = '/api/general';
