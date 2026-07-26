import { withBase } from '../../lib/paths';

export async function fetchShaderSource(shaderName: string): Promise<string> {
  const response = await fetch(withBase(`shaders/${shaderName}`));
  if (!response.ok) {
    throw new Error(`Failed to load shader "${shaderName}" (${response.status} ${response.statusText})`);
  }
  const source = await response.text();
  if (!source.trim()) {
    throw new Error(`Shader "${shaderName}" loaded as an empty file`);
  }
  return source;
}
