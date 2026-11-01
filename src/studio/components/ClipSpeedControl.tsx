import './clip-speed.css';

/** Clip speed 0.1×–100× on a logarithmic slider (S先生 10-31); the new length shows as it moves. */
export const SPEED_MIN = 0.1, SPEED_MAX = 100;
const MARKS = [0.1, 1, 2, 5, 10, 100];
const label = (rate: number) => `${rate < 1 ? rate.toFixed(2).replace(/0$/, '') : rate < 10 ? rate.toFixed(1).replace(/\.0$/, '') : Math.round(rate)}×`;

export function ClipSpeedControl({ rate, sourceSeconds, minRate, onChange, range = [SPEED_MIN, SPEED_MAX], marks = MARKS, animation = false }: {
  rate: number;
  /** The stretch of source the clip plays; its length on the timeline is this divided by the speed. */
  sourceSeconds: number;
  /** The slowest the clip may go without running into the next clip. */
  minRate?: number;
  onChange: (rate: number) => void;
  /** The slowest and fastest it may go. */
  range?: [number, number];
  marks?: number[];
  /** 动效卡变速 (S先生 11-01): an animation played whole at the speed, with no sound to keep the pitch of. */
  animation?: boolean;
}) {
  const [low, high] = range;
  const toPosition = (value: number) => Math.log(value / low) / Math.log(high / low);
  const toRate = (position: number) => {
    const raw = low * (high / low) ** position;
    // Snap to the marked speeds when close, and round the rest sensibly.
    for (const mark of animation ? marks : [0.25, 0.5, 1, 2, 5, 10, 100]) if (Math.abs(Math.log(raw / mark)) < 0.035) return mark;
    return raw < 1 ? Math.round(raw * 100) / 100 : raw < 10 ? Math.round(raw * 10) / 10 : Math.round(raw);
  };
  const floor = Math.max(low, Math.min(high, minRate ?? low));
  const set = (value: number) => onChange(Math.max(floor, Math.min(high, value)));
  return <div className={`clip-speed${animation ? ' clip-speed--animation' : ''}`}>
    <div className="clip-speed__head"><span>速度</span><b>{label(rate)}</b></div>
    <input type="range" min={0} max={1} step={0.001} value={toPosition(rate)} aria-label="片段速度" aria-valuetext={label(rate)}
      onChange={event => set(toRate(Number(event.currentTarget.value)))} onDoubleClick={() => set(1)} />
    <div className="clip-speed__marks" aria-hidden="true">{marks.map(mark => <span key={mark} style={{ left: `${toPosition(mark) * 100}%` }}>{mark}×</span>)}</div>
    <div className="clip-speed__row"><span>片段时长</span><span><em>{(sourceSeconds).toFixed(1)} 秒 →</em> <b>{(sourceSeconds / rate).toFixed(1)} 秒</b></span></div>
    {floor > low && <p className="clip-speed__note">后面有片段，最慢 {label(floor)}</p>}
    <div className="clip-speed__row">{animation ? <><span>动画</span><span>完整播完</span></> : <><span>音调</span><span>保持原声音调</span></>}</div>
    {rate !== 1 && <button type="button" className="clip-speed__reset" onClick={() => set(1)}>恢复 1×</button>}
  </div>;
}
