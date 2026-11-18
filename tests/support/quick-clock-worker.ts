import { LayoutEngineSession } from '../../src/layout-engine';

// Keep the production worker, solver and reply paths. Only its solve clock is synthetic.
let elapsed = 0;
const clocked = new LayoutEngineSession({ now: () => elapsed }), run = LayoutEngineSession.prototype.run;
LayoutEngineSession.prototype.run = function (input, options, controls) {
  elapsed = 0;
  return run.call(clocked, input, options, { ...controls, yieldNow: async () => { elapsed += 2100; await controls.yieldNow(); } });
};
await import('../../src/layout-worker');
