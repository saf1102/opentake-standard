export async function resolve(specifier, context, next) {
  if (specifier === '@hono/node-server') return { url: new URL('./hono-stub.mjs', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
