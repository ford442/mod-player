export function resolveIncludes(filePath: string, seen?: Set<string>): string;

export function expandShader(srcPath: string): {
  flat: string;
  includes: string[];
};
