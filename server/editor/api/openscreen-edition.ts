import type {ScreenRouteContext} from './openscreen.ts';
/** 标准版没有口播发布、私有识别及旧口播归档接口。 */
export async function handleScreenEditionApi(_ctx:ScreenRouteContext):Promise<boolean> {return false;}
