import type {IncomingMessage,ServerResponse} from 'node:http';
import {sendJson} from '../../http.ts';
export async function handleSettingsMigrations(_req:IncomingMessage,res:ServerResponse,parts:string[]){if(parts[1]!=='migrations')return false;sendJson(res,404,{ok:false,error:'此版本不提供工程迁移；可添加已有工程库'});return true}
