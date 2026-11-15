import { LayoutSolver, DEFAULT_LAYOUT } from '../../src/core/layout';
self.onmessage = e => {
  try {
    const start = performance.now(), solver = new LayoutSolver(e.data, DEFAULT_LAYOUT);
    while (!solver.done) solver.step();
    self.postMessage({ milliseconds: performance.now() - start, iterations: solver.iteration, movement: solver.movement, stop: solver.iteration >= solver.limit ? 'iteration-limit' : 'converged', positions: solver.positions });
  } catch (error) { self.postMessage({ error: String(error) }); }
};
