import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const platform=require('../desktop/platform.cjs') as typeof import('../desktop/platform.cjs');
export default platform;
