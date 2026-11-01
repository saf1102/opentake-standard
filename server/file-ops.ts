import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
// Match platform.ts: keep the CommonJS runtime external to Vite's ESM config bundle.
const ops=require('../desktop/file-ops.cjs') as typeof import('../desktop/file-ops.cjs');
export const {atomicJsonSync,atomicWriteFileSync,renameWithRetrySync,removeWithRetrySync,cleanupPathSync}=ops;
