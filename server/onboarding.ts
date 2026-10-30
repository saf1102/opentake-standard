import {CHECKS} from './onboarding-edition.ts';
import type {CheckResult,OnboardingCheck} from './onboarding-common.ts';
export {OPENSCREEN_MIN,versionBelow,onboardingSeen,markOnboardingSeen,openSystemPane,generalAgentOnboardingSeen,markGeneralAgentOnboardingSeen} from './onboarding-common.ts';
export type {CheckResult,CheckAction,CheckState,OnboardingCheck} from './onboarding-common.ts';
export const ONBOARDING_CHECKS=Object.keys(CHECKS) as OnboardingCheck[];
export async function runOnboardingCheck(id:string):Promise<CheckResult>{
 const check=CHECKS[id as OnboardingCheck];if(!check)throw Error('没有这一项检查');
 try{return await check()}catch(error){return {id:id as OnboardingCheck,state:'warn',text:`这一项没查成：${error instanceof Error?error.message:String(error)}`}}
}
