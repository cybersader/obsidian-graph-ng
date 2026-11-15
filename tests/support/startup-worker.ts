import { runLayoutStream, DEFAULT_LAYOUT } from '../../src/core/layout';
import { yieldTask } from '../../src/core/scheduler';
self.onmessage = async e => {
  const start = performance.now(); let snapshot = 0;
  try {
    const positions = await runLayoutStream(e.data, DEFAULT_LAYOUT, 5, positions => {
      self.postMessage({ iteration: snapshot++ * 5, milliseconds: performance.now() - start, positions }, { transfer: [positions.buffer] });
    }, yieldTask);
    self.postMessage({ done: true, milliseconds: performance.now() - start, positions }, { transfer: [positions.buffer] });
  } catch (error) { self.postMessage({ error: String(error) }); }
};
