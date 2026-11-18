/** Stable fields in a realm-shared queue. A stuck operation retains at most one
 * pending request: service the latest inventory, not every intermediate one. */
export interface WorkQueue { work: Promise<void>; next?: () => Promise<void>; draining?: boolean }
export function latestWork(queue: WorkQueue, action: () => Promise<void>) {
  queue.next = action;
  if (!queue.draining) {
    queue.draining = true;
    queue.work = queue.work.then(async () => {
      try { while (queue.next) { const next = queue.next; queue.next = undefined; try { await next(); } catch { /* Each request reports its own failure. Keep draining. */ } } }
      finally { queue.draining = false; }
    }).catch(() => {});
  }
  return queue.work;
}

// Multiple room settlements can observe the same physical view refresh. Attach
// one handler pair to it, never a Promise.race tail per retired room.
type Reply = (ok: boolean, error?: unknown) => void;
const acknowledgements = new WeakMap<Promise<unknown>, Set<Reply>>();
function replies(work: Promise<unknown>) {
  let set = acknowledgements.get(work);
  if (!set) {
    acknowledgements.set(work, set = new Set());
    const finish = (ok: boolean, error?: unknown) => { acknowledgements.delete(work); for (const reply of set!) reply(ok, error); };
    void work.then(() => finish(true), e => finish(false, e));
  }
  return set;
}
export function waitForView(work: Promise<unknown>, signal: AbortSignal) {
  const set = replies(work);
  return new Promise<void>((resolve, reject) => {
    const reply: Reply = (ok, error) => { set.delete(reply); signal.removeEventListener('abort', cancel); if (ok) resolve(); else reject(error); };
    const cancel = () => reply(true);
    if (signal.aborted) resolve(); else { set.add(reply); signal.addEventListener('abort', cancel); }
  });
}
