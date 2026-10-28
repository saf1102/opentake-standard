// Stand-in for @hono/node-server: HyperFrames' file server hands us its fetch handler instead of opening a port
// (the agent sandbox forbids listening). Requests go straight to the handler in-process.
export function serve(options, onListen) {
  globalThis.__hfFetch = options.fetch;
  queueMicrotask(() => onListen?.({ port: 0, address: '127.0.0.1', family: 'IPv4' }));
  return { on() { return this; }, once() { return this; }, close(cb) { cb?.(); return this; }, address: () => ({ port: 0 }) };
}
export const createAdaptorServer = () => { throw new Error('not available offline'); };
