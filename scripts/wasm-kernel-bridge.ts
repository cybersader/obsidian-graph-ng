import { WorkerPipeline } from '../src/pipeline';
import { defaultDeclaration } from '../src/core/declaration';
import { packRows } from '../src/core/columns';
import { DEFAULT_LAYOUT, initialPositions } from '../src/core/layout';
import { kernelFixture } from '../tests/support/kernel-fixture';
Object.assign(globalThis, { WorkerPipeline, defaultDeclaration, packRows, DEFAULT_LAYOUT, initialPositions, kernelFixture });
