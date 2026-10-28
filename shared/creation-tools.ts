export type CreationTools = {python:string;chromium:string;ffmpeg:string;ffprobe:string;codex:string};
export type EnvironmentItem = {id:string;label:string;ok:boolean;path?:string;version?:string;message?:string;install?:string};
export type EnvironmentCheck = {ok:boolean;checkedAt:string;items:EnvironmentItem[];tools?:CreationTools};
