import {useEffect} from 'react';
import {runAll} from './onboarding-store';
export {DEPLOY_ITEMS,deployDescription,pendingAgents} from './edition-config';
export function useAccountAndFirstRun(){useEffect(()=>{void runAll()},[])}
