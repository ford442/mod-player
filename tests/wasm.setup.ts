/** wasm project: start compiling the worklet's libopenmpt before the first test asks for it (tests/helpers/sharedWasm.ts). */
import { sharedWasmModule } from './helpers/sharedWasm';

void sharedWasmModule('libopenmpt-worklet.wasm');
