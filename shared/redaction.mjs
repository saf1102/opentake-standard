/** Pure ESM so the server's config bundle does not embed a CommonJS filesystem module. */
export function redact(value){
 let text=String(value??'').slice(0,16000);
 if(process.env.USERPROFILE)for(const home of [process.env.USERPROFILE,process.env.USERPROFILE.replace(/\\/g,'/')])text=text.split(home).join('<USER>');
 return text.replace(/Bearer\s+[^\s"',;]+/gi,'Bearer <REDACTED>')
 .replace(/sk-[A-Za-z0-9_-]{12,}/g,'<REDACTED>')
 .replace(/((?:api[_-]?key|token|access[_-]?token|refresh[_-]?token|password|authorization|client[_-]?secret|private[_-]?key)["']?\s*[:=]\s*)[^\r\n]+/gi,'$1<REDACTED>')
 .replace(/(https?:\/\/[^\s?#"']+)\?[^\s"']+/g,'$1?<REDACTED>');
}
