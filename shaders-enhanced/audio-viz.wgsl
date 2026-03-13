// Audio Visualization Compute Shader
// Generates waveform and frequency visualization data

struct AudioUniforms {
  // Time and playback
  time: f32,
  sampleRate: f32,
  bufferSize: u32,
  
  // Display settings
  waveformHeight: f32,
  frequencyScale: f32,
  smoothing: f32,
  
  // Color settings
  baseColorR: f32,
  baseColorG: f32,
  baseColorB: f32,
  accentColorR: f32,
  accentColorG: f32,
  accentColorB: f32,
};

// Input: Raw audio buffer (interleaved stereo)
@group(0) @binding(0) var<storage, read> audioBuffer: array<f32>;

// Output: Visualization data
@group(0) @binding(1) var<storage, write> waveformData: array<vec4<f32>>;
@group(0) @binding(2) var<storage, write> frequencyData: array<vec4<f32>>;
@group(0) @binding(3) var<uniform> uniforms: AudioUniforms;

// FFT helper functions
fn bitReverse(n: u32, bits: u32) -> u32 {
  var reversed = 0u;
  var x = n;
  for (var i = 0u; i < bits; i = i + 1u) {
    reversed = (reversed << 1u) | (x & 1u);
    x = x >> 1u;
  }
  return reversed;
}

// Complex multiplication
fn complexMul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    a.x * b.x - a.y * b.y,
    a.x * b.y + a.y * b.x
  );
}

// Cooley-Tukey FFT (simplified for 256 samples)
fn fft256(input: ptr<function, array<vec2<f32>, 256>>, output: ptr<function, array<vec2<f32>, 256>>) {
  // Copy with bit reversal
  for (var i = 0u; i < 256u; i = i + 1u) {
    let j = bitReverse(i, 8u);
    (*output)[j] = (*input)[i];
  }
  
  // Butterfly operations
  var stage = 1u;
  while (stage < 256u) {
    var angle = -6.28318530718 / f32(stage * 2u);
    var wlen = vec2<f32>(cos(angle), sin(angle));
    
    for (var i = 0u; i < 256u; i = i + stage * 2u) {
      var w = vec2<f32>(1.0, 0.0);
      for (var j = 0u; j < stage; j = j + 1u) {
        let u = (*output)[i + j];
        let v = complexMul((*output)[i + j + stage], w);
        (*output)[i + j] = u + v;
        (*output)[i + j + stage] = u - v;
        w = complexMul(w, wlen);
      }
    }
    stage = stage << 1u;
  }
}

// Hann window function
fn hannWindow(n: u32, size: u32) -> f32 {
  return 0.5 * (1.0 - cos(6.28318530718 * f32(n) / f32(size - 1u)));
}

// Main compute shader
@compute @workgroup_size(256, 1, 1)
fn visualize(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = globalId.x;
  
  if (idx >= 256u) {
    return;
  }
  
  // Calculate waveform sample position
  let bufferOffset = (idx * uniforms.bufferSize) / 256u;
  
  // Average multiple samples for anti-aliasing
  var leftSample = 0.0;
  var rightSample = 0.0;
  let samplesToAverage = max(1u, uniforms.bufferSize / 256u / 4u);
  
  for (var i = 0u; i < samplesToAverage; i = i + 1u) {
    let sampleIdx = (bufferOffset + i) * 2u; // Interleaved stereo
    if (sampleIdx + 1u < arrayLength(&audioBuffer)) {
      leftSample = leftSample + audioBuffer[sampleIdx];
      rightSample = rightSample + audioBuffer[sampleIdx + 1u];
    }
  }
  
  leftSample = leftSample / f32(samplesToAverage);
  rightSample = rightSample / f32(samplesToAverage);
  
  // Mix channels
  let mixedSample = (leftSample + rightSample) * 0.5;
  
  // Store waveform data
  // x: sample value, y: left channel, z: right channel, w: time offset
  waveformData[idx] = vec4<f32>(
    mixedSample * uniforms.waveformHeight,
    leftSample * uniforms.waveformHeight,
    rightSample * uniforms.waveformHeight,
    f32(idx) / 256.0
  );
  
  // FFT for frequency visualization (simplified - only compute for workgroup 0)
  if (idx < 128u) {
    var fftInput: array<vec2<f32>, 256>;
    var fftOutput: array<vec2<f32>, 256>;
    
    // Load samples with window function
    for (var i = 0u; i < 256u; i = i + 1u) {
      let sampleIdx = i * 2u;
      var sample = 0.0;
      if (sampleIdx < arrayLength(&audioBuffer)) {
        sample = (audioBuffer[sampleIdx] + audioBuffer[sampleIdx + 1u]) * 0.5;
      }
      fftInput[i] = vec2<f32>(sample * hannWindow(i, 256u), 0.0);
    }
    
    // Perform FFT
    fft256(&fftInput, &fftOutput);
    
    // Calculate magnitude and store frequency bins
    if (idx < 128u) {
      let magnitude = length(fftOutput[idx]);
      let db = 20.0 * log(max(1e-10, magnitude)) / log(10.0); // Convert to dB
      let normalizedDb = (db + 60.0) / 60.0; // Normalize -60dB to 0dB
      
      // Apply frequency scale (logarithmic for better perception)
      let freqBin = f32(idx);
      let logFreq = log(1.0 + freqBin) / log(1.0 + 128.0);
      
      // Color based on frequency
      let baseColor = vec3<f32>(uniforms.baseColorR, uniforms.baseColorG, uniforms.baseColorB);
      let accentColor = vec3<f32>(uniforms.accentColorR, uniforms.accentColorG, uniforms.accentColorB);
      let color = mix(baseColor, accentColor, logFreq);
      
      // Store frequency data
      // x: magnitude, y: normalized dB, z: color intensity, w: frequency bin
      frequencyData[idx] = vec4<f32>(
        magnitude * uniforms.frequencyScale,
        clamp(normalizedDb, 0.0, 1.0),
        logFreq,
        freqBin
      );
    }
  }
}

// Waveform render vertex shader
struct WaveformVertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn waveformVs(@builtin(vertex_index) vertexIndex: u32) -> WaveformVertexOut {
  // Generate line strip vertices from waveform data
  let pointIdx = vertexIndex / 2u;
  let isTop = vertexIndex % 2u == 0u;
  
  if (pointIdx >= 256u) {
    return WaveformVertexOut(vec4<f32>(0.0), vec4<f32>(0.0));
  }
  
  let sample = waveformData[pointIdx];
  let x = (f32(pointIdx) / 256.0) * 2.0 - 1.0; // -1 to 1
  let y = sample.x; // Already scaled
  
  // Create thick line by offsetting
  let thickness = 0.005;
  let yOffset = select(-thickness, thickness, isTop);
  
  // Color based on amplitude
  let intensity = abs(sample.x);
  let baseColor = vec3<f32>(uniforms.baseColorR, uniforms.baseColorG, uniforms.baseColorB);
  let accentColor = vec3<f32>(uniforms.accentColorR, uniforms.accentColorG, uniforms.accentColorB);
  let color = vec4<f32>(mix(baseColor, accentColor, intensity), 1.0);
  
  return WaveformVertexOut(
    vec4<f32>(x, y + yOffset, 0.0, 1.0),
    color
  );
}

@fragment
fn waveformFs(in: WaveformVertexOut) -> @location(0) vec4<f32> {
  return in.color;
}

// Frequency bars render
struct FrequencyVertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) height: f32,
};

@vertex
fn frequencyVs(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> FrequencyVertexOut {
  // Each instance is a frequency bar
  if (instanceIndex >= 128u) {
    return FrequencyVertexOut(vec4<f32>(0.0), vec3<f32>(0.0), 0.0);
  }
  
  let freq = frequencyData[instanceIndex];
  let barWidth = 2.0 / 128.0;
  let x = (f32(instanceIndex) / 128.0) * 2.0 - 1.0 + barWidth * 0.5;
  let barHeight = freq.y * uniforms.frequencyScale;
  
  // Quad vertices
  let localX = select(0.0, barWidth, vertexIndex == 1u || vertexIndex == 2u);
  let localY = select(0.0, barHeight, vertexIndex >= 2u);
  
  // Color gradient based on frequency
  let baseColor = vec3<f32>(uniforms.baseColorR, uniforms.baseColorG, uniforms.baseColorB);
  let accentColor = vec3<f32>(uniforms.accentColorR, uniforms.accentColorG, uniforms.accentColorB);
  let color = mix(baseColor, accentColor, freq.z);
  
  return FrequencyVertexOut(
    vec4<f32>(x + localX - barWidth * 0.5, localY, 0.0, 1.0),
    color,
    barHeight
  );
}

@fragment
fn frequencyFs(in: FrequencyVertexOut) -> @location(0) vec4<f32> {
  // Gradient from bottom to top
  let gradient = in.height > 0.01 ? 0.8 + 0.2 * in.height : 0.5;
  return vec4<f32>(in.color * gradient, 1.0);
}
