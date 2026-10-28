const formats = {
  video: ['mp4','mov','m4v','mkv','webm','avi','mpeg','mpg','mts','m2ts','ts','3gp'],
  audio: ['mp3','wav','m4a','aac','flac','ogg','oga','opus','aif','aiff','aifc','wma'],
  image: ['png','jpg','jpeg','webp','gif','bmp','heic','heif','avif','tif','tiff','svg'],
} as const;
export type ImportMediaKind = keyof typeof formats;
export const MEDIA_FILE_ACCEPT = ['video/*','audio/*','image/*',...Object.values(formats).flat().map(ext=>'.'+ext)].join(',');
export function mediaFileKind(name: string, mime = ''): ImportMediaKind | undefined {
  const ext = name.split('.').at(-1)?.toLowerCase();
  for (const [kind, extensions] of Object.entries(formats)) if ((extensions as readonly string[]).includes(ext || '')) return kind as ImportMediaKind;
  const family=mime.split(';')[0].trim().toLowerCase().split('/')[0];
  return family==='video'||family==='audio'||family==='image'?family:undefined;
}
