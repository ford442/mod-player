/**
 * ShaderComposer - Modular shader composition system to reduce code duplication
 * across multiple shader versions.
 */

export interface ShaderModule {
  name: string;
  vertex?: string;
  fragment?: string;
  bindings?: ShaderBinding[];
  vertexAttributes?: GPUVertexAttribute[];
  blendState?: GPUBlendState;
  requiredFeatures?: GPUFeatureName[];
}

export interface ShaderBinding {
  binding: number;
  visibility: GPUShaderStageFlags;
  type: 'buffer' | 'texture' | 'sampler' | 'storage';
  config?: object;
}

interface ComposedShader {
  vertex: string;
  fragment: string;
  layout: ShaderLayout;
}

interface ShaderLayout {
  bindings: GPUBindGroupLayoutEntry[];
  vertexBuffers: GPUVertexBufferLayout[];
  blendState?: GPUBlendState;
  requiredFeatures: GPUFeatureName[];
}

/**
 * Base shader modules that can be composed together
 */
export const baseModules: Record<string, ShaderModule> = {
  // Basic vertex transformation
  vertexBase: {
    name: 'vertexBase',
    vertex: /* wgsl */ `
      struct VertexInput {
        @location(0) position: vec2<f32>,
        @location(1) uv: vec2<f32>,
      };

      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) uv: vec2<f32>,
      };

      @vertex
      fn vs_main(input: VertexInput) -> VertexOutput {
        var output: VertexOutput;
        output.position = vec4<f32>(input.position, 0.0, 1.0);
        output.uv = input.uv;
        return output;
      }
    `,
    vertexAttributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x2' },
      { shaderLocation: 1, offset: 8, format: 'float32x2' },
    ],
  },

  // Uniform buffer for transformation matrices and time
  uniforms: {
    name: 'uniforms',
    bindings: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        type: 'buffer',
        config: { type: 'uniform' },
      },
    ],
    vertex: /* wgsl */ `
      struct Uniforms {
        time: f32,
        resolution: vec2<f32>,
        transform: mat4x4<f32>,
      };
      @group(0) @binding(0) var<uniform> uniforms: Uniforms;
    `,
  },

  // Texture sampling
  textureSampling: {
    name: 'textureSampling',
    bindings: [
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        type: 'texture',
        config: { sampleType: 'float' },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        type: 'sampler',
        config: { type: 'filtering' },
      },
    ],
    fragment: /* wgsl */ `
      @group(0) @binding(1) var texture: texture_2d<f32>;
      @group(0) @binding(2) var textureSampler: sampler;

      fn sampleTexture(uv: vec2<f32>) -> vec4<f32> {
        return textureSample(texture, textureSampler, uv);
      }
    `,
  },

  // Alpha blending support
  alphaBlending: {
    name: 'alphaBlending',
    requiredFeatures: ['float32-blendable'],
    blendState: {
      color: {
        srcFactor: 'src-alpha',
        dstFactor: 'one-minus-src-alpha',
        operation: 'add',
      },
      alpha: {
        srcFactor: 'one',
        dstFactor: 'one-minus-src-alpha',
        operation: 'add',
      },
    },
    fragment: /* wgsl */ `
      fn applyAlpha(color: vec4<f32>, alpha: f32) -> vec4<f32> {
        return vec4<f32>(color.rgb, color.a * alpha);
      }
    `,
  },

  // Pattern data buffer for MOD visualization
  patternData: {
    name: 'patternData',
    bindings: [
      {
        binding: 3,
        visibility: GPUShaderStage.FRAGMENT,
        type: 'buffer',
        config: { type: 'read-only-storage' },
      },
    ],
    fragment: /* wgsl */ `
      struct PatternRow {
        note: u32,
        instrument: u32,
        volume: u32,
        effect: u32,
      };

      struct PatternData {
        rows: array<PatternRow>,
      };
      @group(0) @binding(3) var<storage, read> patternData: PatternData;

      fn getPatternRow(rowIndex: u32) -> PatternRow {
        return patternData.rows[rowIndex];
      }
    `,
  },

  // Video texture support
  videoTexture: {
    name: 'videoTexture',
    bindings: [
      {
        binding: 4,
        visibility: GPUShaderStage.FRAGMENT,
        type: 'texture',
        config: { sampleType: 'float', viewDimension: '2d' },
      },
      {
        binding: 5,
        visibility: GPUShaderStage.FRAGMENT,
        type: 'sampler',
        config: { type: 'filtering' },
      },
    ],
    fragment: /* wgsl */ `
      @group(0) @binding(4) var videoTexture: texture_2d<f32>;
      @group(0) @binding(5) var videoSampler: sampler;

      fn sampleVideo(uv: vec2<f32>) -> vec4<f32> {
        return textureSample(videoTexture, videoSampler, uv);
      }
    `,
  },

  // Bezel/chassis rendering
  bezelRendering: {
    name: 'bezelRendering',
    bindings: [
      {
        binding: 6,
        visibility: GPUShaderStage.FRAGMENT,
        type: 'texture',
        config: { sampleType: 'float' },
      },
      {
        binding: 7,
        visibility: GPUShaderStage.FRAGMENT,
        type: 'sampler',
        config: { type: 'filtering' },
      },
    ],
    fragment: /* wgsl */ `
      @group(0) @binding(6) var bezelTexture: texture_2d<f32>;
      @group(0) @binding(7) var bezelSampler: sampler;

      fn renderBezel(uv: vec2<f32>, screenUV: vec2<f32>) -> vec4<f32> {
        let bezelColor = textureSample(bezelTexture, bezelSampler, uv);
        // Blend bezel with screen content
        return bezelColor;
      }
    `,
  },
};

/**
 * Composes shader modules into a complete shader
 */
export function composeShader(moduleNames: string[]): ComposedShader {
  const modules = moduleNames
    .map(name => baseModules[name])
    .filter(Boolean);

  if (modules.length === 0) {
    throw new Error('No valid shader modules provided');
  }

  // Combine vertex code
  const vertexParts: string[] = [];
  modules.forEach(m => {
    if (m.vertex) vertexParts.push(m.vertex);
  });

  // Combine fragment code
  const fragmentParts: string[] = [];
  modules.forEach(m => {
    if (m.fragment) fragmentParts.push(m.fragment);
  });

  // Add main fragment function
  fragmentParts.push(/* wgsl */ `
    @fragment
    fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
      return main(uv);
    }
  `);

  // Build layout
  const bindings: GPUBindGroupLayoutEntry[] = [];
  const vertexAttributes: GPUVertexAttribute[] = [];
  const requiredFeatures: GPUFeatureName[] = [];
  let blendState: GPUBlendState | undefined;

  modules.forEach(m => {
    // Collect bindings
    m.bindings?.forEach(b => {
      const entry: GPUBindGroupLayoutEntry = {
        binding: b.binding,
        visibility: b.visibility,
      };

      switch (b.type) {
        case 'buffer':
          entry.buffer = b.config as GPUBufferBindingLayout;
          break;
        case 'texture':
          entry.texture = b.config as GPUTextureBindingLayout;
          break;
        case 'sampler':
          entry.sampler = b.config as GPUSamplerBindingLayout;
          break;
        case 'storage':
          entry.storageTexture = b.config as GPUStorageTextureBindingLayout;
          break;
      }

      bindings.push(entry);
    });

    // Collect vertex attributes
    if (m.vertexAttributes) {
      vertexAttributes.push(...m.vertexAttributes);
    }

    // Collect required features
    if (m.requiredFeatures) {
      requiredFeatures.push(...m.requiredFeatures);
    }

    // Use blend state from last module that defines it
    if (m.blendState) {
      blendState = m.blendState;
    }
  });

  // Deduplicate features
  const uniqueFeatures = [...new Set(requiredFeatures)];

  // Build vertex buffer layout
  const vertexBuffers: GPUVertexBufferLayout[] = [];
  if (vertexAttributes.length > 0) {
    // Calculate array stride from attributes
    const maxOffset = Math.max(...vertexAttributes.map(a => a.offset));
    const lastAttr = vertexAttributes.reduce((max, a) => 
      a.offset > max.offset ? a : max
    );
    const formatSizes: Record<string, number> = {
      'float32': 4,
      'float32x2': 8,
      'float32x3': 12,
      'float32x4': 16,
      'uint32': 4,
    };
    const arrayStride = maxOffset + (formatSizes[lastAttr.format] || 4);

    vertexBuffers.push({
      arrayStride,
      attributes: vertexAttributes,
    });
  }

  return {
    vertex: vertexParts.join('\n'),
    fragment: fragmentParts.join('\n'),
    layout: {
      bindings,
      vertexBuffers,
      blendState,
      requiredFeatures: uniqueFeatures,
    },
  };
}

/**
 * Pre-defined shader configurations for different use cases
 */
export const shaderPresets = {
  // Simple pattern display without textures
  simple: () => composeShader(['vertexBase', 'uniforms', 'patternData']),

  // Pattern display with texture support
  textured: () => composeShader([
    'vertexBase',
    'uniforms',
    'textureSampling',
    'patternData',
  ]),

  // Full featured with alpha blending
  extended: () => composeShader([
    'vertexBase',
    'uniforms',
    'textureSampling',
    'alphaBlending',
    'patternData',
  ]),

  // Background with video texture
  videoBackground: () => composeShader([
    'vertexBase',
    'uniforms',
    'videoTexture',
    'bezelRendering',
  ]),

  // Full UI with all features
  fullUI: () => composeShader([
    'vertexBase',
    'uniforms',
    'textureSampling',
    'alphaBlending',
    'patternData',
    'videoTexture',
    'bezelRendering',
  ]),
};

/**
 * Shader cache to avoid recompilation
 */
export class ShaderCache {
  private cache: Map<string, GPUShaderModule> = new Map();

  constructor(private device: GPUDevice) {}

  getOrCreate(key: string, code: string): GPUShaderModule {
    const cached = this.cache.get(key);
    if (cached) return cached;

    const module = this.device.createShaderModule({
      code,
      label: key,
    });

    this.cache.set(key, module);
    return module;
  }

  clear(): void {
    // Note: WebGPU shader modules don't have a destroy method,
    // but we can clear the cache to allow GC
    this.cache.clear();
  }
}

/**
 * Validates shader code for common issues
 */
export function validateShader(code: string): string[] {
  const errors: string[] = [];

  // Check for common WGSL issues
  if (!code.includes('@vertex')) {
    errors.push('Missing @vertex entry point');
  }

  if (!code.includes('@fragment')) {
    errors.push('Missing @fragment entry point');
  }

  // Check for unclosed braces
  const openBraces = (code.match(/{/g) || []).length;
  const closeBraces = (code.match(/}/g) || []).length;
  if (openBraces !== closeBraces) {
    errors.push(`Mismatched braces: ${openBraces} open, ${closeBraces} close`);
  }

  // Check for undefined bindings
  const bindingRefs = code.match(/@binding\((\d+)\)/g) || [];
  const uniqueBindings = new Set(bindingRefs.map(b => b.match(/\d+/)?.[0]));
  if (uniqueBindings.size > 8) {
    errors.push('More than 8 bindings may exceed device limits');
  }

  return errors;
}
