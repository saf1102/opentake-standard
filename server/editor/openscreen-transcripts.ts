import type { EditProject } from '../../src/types/editor.ts';
// Standard owns recording documents only; speech transcript synchronization is Pro-only.
export function syncProjectSourceTranscriptsFromOpenScreen(_project: EditProject, _document: Record<string, unknown>, _options?: { onlyMissing?: boolean }) { return false; }
export function hydrateOpenScreenSourceTranscripts(_project: EditProject, document: Record<string, unknown>) { return structuredClone(document); }
export function archiveLegacyScreenMotion(_projectId: string): never { throw new Error('标准版不提供旧口播录屏归档'); }
