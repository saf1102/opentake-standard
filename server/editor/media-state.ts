import type {MediaAsset} from '../../src/types/editor.ts';
import {findProject, save} from './store.ts';

/** Only apply probe/cache results. Never write an asynchronous snapshot over user edits. */
export function mergeMediaResult(projectId: string, assetId: string, updates: Partial<MediaAsset>) {
  const {dir, project} = findProject(projectId);
  const asset = project.media.find(item => item.id === assetId);
  if (!asset) throw new Error('素材已不存在');
  Object.assign(asset, updates);
  return {dir, project, asset};
}

export function saveMediaResult(projectId: string, assetId: string, updates: Partial<MediaAsset>) {
  const latest = mergeMediaResult(projectId, assetId, updates);
  latest.project.revision++;
  save(latest.dir, latest.project);
  return latest.asset;
}
