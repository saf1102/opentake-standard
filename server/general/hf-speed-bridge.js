// 动效卡变速 (S先生 11-01), in the root page of a HyperFrames film, in the editor's preview and in OpenTake's export alike:
// a scene host with data-ot-speed plays its CSS animations that much faster. HyperFrames seeks a CSS animation by
// setting its currentTime to the time since its clip started; under such a host that time is scaled. The scene's
// frame scripts and timed elements are scaled in its own page (hf-speed.ts).
(() => {
  if (typeof Animation === 'undefined' || Animation.prototype.__otSpeed) return;
  const time = Object.getOwnPropertyDescriptor(Animation.prototype, 'currentTime');
  if (!time?.get || !time.set) return;
  const rateOf = el => {
    const host = el && el.closest ? el.closest('[data-ot-speed]') : null;
    const k = host ? Number(host.getAttribute('data-ot-speed')) : 1;
    return k > 0 ? k : 1;
  };
  Object.defineProperty(Animation.prototype, '__otSpeed', { value: true });
  Object.defineProperty(Animation.prototype, 'currentTime', {
    configurable: true,
    get() { return time.get.call(this); },
    set(value) {
      const k = typeof value === 'number' ? rateOf(this.effect && this.effect.target) : 1;
      time.set.call(this, k === 1 ? value : value * k);
    },
  });
})();
