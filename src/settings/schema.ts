import { z } from 'zod';
export const SystemPreferencesSchema = z.object({
  paths: z.object({ projects: z.string().max(2048), cache: z.string().max(2048), exports: z.string().max(2048), backups: z.string().max(2048) }).strict(),
  export: z.object({ preset: z.enum(['quick','jianying']), container: z.enum(['mp4','mov']), quality: z.enum(['fast','balanced','high']), resolution: z.enum(['original','4k','1080p','720p']), revealWhenDone: z.boolean() }).strict(),
  backup: z.object({ automatic: z.boolean(), intervalMinutes: z.number().int().min(5).max(1440), keep: z.number().int().min(3).max(100) }).strict(),
  reserveGB: z.number().min(0).max(500),
}).strict();
export type SystemPreferences = z.infer<typeof SystemPreferencesSchema>;
export type PathStatus = { path:string; online:boolean; writable:boolean; freeBytes?:number; error?:string };
export type SettingsView = { revision:number; preferences:SystemPreferences; libraries:PathStatus[]; paths:Record<keyof SystemPreferences['paths'],PathStatus>; cacheRoots:string[]; backupRoots:string[]; projectPathOverridden:boolean };
