import { runLayout, type LayoutInput, type LayoutOptions } from './core/layout';
self.onmessage = (event: MessageEvent<{ input: LayoutInput; options: LayoutOptions }>) => {
  try {
    const start = performance.now();
    const positions = runLayout(event.data.input, event.data.options);
    self.postMessage({ positions, milliseconds: performance.now() - start }, { transfer: [positions.buffer] });
  } catch (error) { self.postMessage({ error: String(error) }); }
};
