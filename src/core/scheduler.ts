/** Cooperative, configurable main-realm budget. Each batch yields even on fast hosts. */
export function yieldTask(): Promise<void> {
  const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield(): Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
    channel.port2.postMessage(null);
  });
}
export interface IngestOptions { chunkRows: number; budgetMs: number }
export async function sliced<T>(items: Iterable<T>, options: IngestOptions, consume: (item: T) => void, yieldNow = yieldTask): Promise<void> {
  let start = performance.now(), count = 0;
  for (const item of items) {
    consume(item); count++;
    if (count >= options.chunkRows || performance.now() - start >= options.budgetMs) {
      await yieldNow(); start = performance.now(); count = 0;
    }
  }
  if (count) await yieldNow();
}
