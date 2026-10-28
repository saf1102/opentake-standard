import type {EnvironmentCheck} from '../../shared/creation-tools'
export function EnvironmentResults({value}:{value:EnvironmentCheck}) {
 return <section aria-label="出片工具检查" aria-live="polite" style={{overflowWrap:'anywhere'}}>
  {!value.ok && <p style={{color:'#9869dc'}}>先准备好以下工具，再开始做片。填写的内容已保留。</p>}
  {value.items.map(item=><div key={item.id} style={{color:item.ok?'inherit':'#9869dc',marginBlock:12}}>
   <strong>{item.label} · {item.ok?'通过':'需要处理'}</strong>
   <p style={{whiteSpace:'pre-wrap',marginBlock:4}}>{item.ok?item.version:item.message}</p>
   {item.ok?<small style={{whiteSpace:'pre-wrap'}}>{item.path}</small>:<p style={{whiteSpace:'pre-wrap',marginBlock:4}}>{item.install}</p>}
  </div>)}
 </section>
}
