import type { ForceAtlas2Settings } from 'graphology-layout-forceatlas2';
export interface LayoutOptions {
  iterations: number;
  relaxIterations: number;
  initialRadius: number;
  seed: number;
  force: Required<ForceAtlas2Settings>;
}
export const DEFAULT_LAYOUT: LayoutOptions = {
  iterations: 100, relaxIterations: 30, initialRadius: 100, seed: 1,
  force: { linLogMode: false, outboundAttractionDistribution: false, adjustSizes: false,
    edgeWeightInfluence: 1, scalingRatio: 2, strongGravityMode: false, gravity: 1,
    slowDown: 1, barnesHutOptimize: true, barnesHutTheta: 1.2 },
};
