/**
 * addModule() for the character stage, once per context (#453). Every
 * BaseAudioContext — the live one and each export OfflineAudioContext — has
 * its own AudioWorkletGlobalScope and needs its own addModule. A failed load
 * is forgotten so a later enable can retry.
 */
const loads = new WeakMap<BaseAudioContext, Promise<void>>();

export function ensureCharacterWorklet(ctx: BaseAudioContext, url: string): Promise<void> {
  let load = loads.get(ctx);
  if (!load) {
    load = ctx.audioWorklet.addModule(url).catch((err: unknown) => {
      loads.delete(ctx);
      throw err;
    });
    loads.set(ctx, load);
  }
  return load;
}
