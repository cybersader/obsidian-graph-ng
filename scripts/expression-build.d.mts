/** SPDX-License-Identifier: MIT */
import type { BuildResult, Plugin } from 'esbuild';
export function expressionBuild(root?: string): Promise<{
  plugin(worker: boolean): Plugin;
  readonly core: BuildResult<{ metafile: true; write: false }>;
  workerSource(): string;
  trim(outputs: string[]): Promise<void>;
}>;
