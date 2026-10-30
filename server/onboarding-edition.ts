import {unifiedAgentCheck} from './onboarding-agents.ts';
import {disk,openscreen,type CheckResult,type OnboardingCheck} from './onboarding-common.ts';
export const CHECKS:Partial<Record<OnboardingCheck,()=>CheckResult|Promise<CheckResult>>>={agent:unifiedAgentCheck,disk,openscreen};
