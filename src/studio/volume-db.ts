export const volumeDb=(gain:number)=>gain<=0?-60:Math.max(-60,Math.min(20,20*Math.log10(gain)));
export const volumeGain=(db:number)=>db<=-60?0:10**(db/20);
export const volumeLabel=(gain:number)=>gain<=0?'−∞ dB':`${volumeDb(gain)>0?'+':''}${volumeDb(gain).toFixed(1)} dB`;
export const snapVolumeDb=(db:number)=>Math.round(db*2)/2;
