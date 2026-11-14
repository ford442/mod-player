export const GENERATED_TS_REL: string;
export const SW_REL: string;
export function readSupportedExtensions(options?: { root?: string }): Promise<string[]>;
export function normalizeExtensions(exts: string[]): string[];
export function renderGeneratedTs(exts: string[], libopenmptVersion: string): string;
export function renderServiceWorker(swText: string, exts: string[]): string;
export function expectedOutputs(options?: { root?: string }): Promise<{ exts: string[]; ts: string; sw: string }>;
export function staleOutputs(options?: { root?: string }): Promise<string[]>;
