import {randomInt} from 'node:crypto';
import {builtinProtocol,builtinPresets} from '../shared/builtin-models.ts';
import type {ConnectionConfig} from '../shared/agent-connections.ts';
const swatches=[
  {answer:/\bred\b|红/i, data:'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdLep8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3IPanc8OLDQitxAAAAAElFTkSuQmCC'},
  {answer:/\bblue\b|蓝/i, data:'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdNvJ8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ2oPcf88OIhvJ6vAAAAAElFTkSuQmCC'},
  {answer:/\bgreen\b|绿/i, data:'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdLu58QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ24Pbjs8OLsrFddAAAAAElFTkSuQmCC'},
  {answer:/\byellow\b|黄/i, data:'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAdklEQVR4nO3PQQkAMAzAwPo33Yno4xgEIuAyu/N1XtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWjBsQcyl+HSnr9raQAAAABJRU5ErkJggg=='}
];
export async function testBuiltinVision(config:ConnectionConfig, request:(route:string,body:unknown)=>Promise<Record<string,unknown>>) {
  if(!config.model||config.model==='default')throw Error('请选择要用于出片的模型，再测试看图。');
  const {answer,data}=swatches[randomInt(swatches.length)];
  const text='这幅图是什么颜色？只回复一个颜色词。';
  const url='data:image/png;base64,'+data;
  const protocol=builtinProtocol(config.baseUrl,config.format);
  let reply:unknown;
  const model=config.model;
  const recommended=builtinPresets.find(p=>new URL(p.baseUrl).hostname===new URL(config.baseUrl).hostname)?.model||'deepseek-flash';
  const unreadable=()=>Object.assign(Error('模型没有正确识别测试图。请核对模型的看图权限，或换用 '+recommended+' 等支持图片的模型。'),{category:'model'});
  try {
    if(protocol==='responses'){
      const result=await request('responses',{model,store:false,input:[{role:'user',content:[{type:'input_text',text},{type:'input_image',image_url:url}]}]});
      reply=(result.output as {content?:{text?:string}[]}[]|undefined)?.flatMap(m=>m.content||[]).map(c=>c.text).join('');
    } else if(protocol==='anthropic'){
      const result=await request(/\/v1$/.test(config.baseUrl)?'messages':'v1/messages',{model,max_tokens:256,messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type:'image/png',data}},{type:'text',text}]}]});
      reply=(result.content as {type:string;text?:string}[]|undefined)?.filter(c=>c.type==='text').map(c=>c.text).join('');
    } else {
      const result=await request('chat/completions',{model,messages:[{role:'user',content:[{type:'image_url',image_url:{url}},{type:'text',text}]}]});
      reply=(result.choices as {message?:{content?:unknown}}[]|undefined)?.[0]?.message?.content;
    }
  }catch(error){if([400,415,422].includes((error as {httpStatus:number}).httpStatus))throw unreadable();throw error}
  if(typeof reply!=='string'||!answer.test(reply)||swatches.some(s=>s.answer!==answer&&s.answer.test(reply)))throw unreadable();
  return '连接正常，模型已正确识别测试图，可以用于出片。';
}
