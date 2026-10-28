import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const installations=require('../desktop/agent-installation.cjs') as typeof import('../desktop/agent-installation.cjs').default;
export default installations;
