/** Stable fields in a realm-shared queue. A stuck operation retains at most one
 * pending request: service the latest inventory, not every intermediate one. */
export interface WorkQueue { work: Promise<void>; next?: () => Promise<void>; draining?: boolean }
export function latestWork(queue: WorkQueue, action: () => Promise<void>) {
  queue.next = action;
  if (!queue.draining) {
    queue.draining = true;
    queue.work = queue.work.then(async () => {
      try { while (queue.next) { const next = queue.next; queue.next = undefined; await next(); } }
      finally { queue.draining = false; }
    }).catch(() => {});
  }
  return queue.work;
}
