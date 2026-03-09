import re

# Fix PatternDisplay.tsx - better WebGL uniform handling
with open('components/PatternDisplay.tsx', 'r') as f:
    content = f.read()

# Find and replace the null uniform warning block
old_uniform = '''        u_resolution: gl.getUniformLocation(prog, 'u_resolution'),
        u_cellSize: gl.getUniformLocation(prog, 'u_cellSize'),
        u_offset: gl.getUniformLocation(prog, 'u_offset'),
        u_cols: gl.getUniformLocation(prog, 'u_cols'),
        u_rows: gl.getUniformLocation(prog, 'u_rows'),
        u_playhead: gl.getUniformLocation(prog, 'u_playhead'),
        u_layoutMode: gl.getUniformLocation(prog, 'u_layoutMode'),
        u_invertChannels: gl.getUniformLocation(prog, 'u_invertChannels'),
        u_noteData: gl.getUniformLocation(prog, 'u_noteData'),
        u_capTexture: gl.getUniformLocation(prog, 'u_capTexture'),
      };'''

new_uniform = '''        u_resolution: gl.getUniformLocation(prog, 'u_resolution'),
        u_cellSize: gl.getUniformLocation(prog, 'u_cellSize'),
        u_offset: gl.getUniformLocation(prog, 'u_offset'),
        u_cols: gl.getUniformLocation(prog, 'u_cols'),
        u_rows: gl.getUniformLocation(prog, 'u_rows'),
        u_playhead: gl.getUniformLocation(prog, 'u_playhead'),
        u_layoutMode: gl.getUniformLocation(prog, 'u_layoutMode'),
        u_invertChannels: gl.getUniformLocation(prog, 'u_invertChannels'),
        u_noteData: gl.getUniformLocation(prog, 'u_noteData'),
        u_capTexture: gl.getUniformLocation(prog, 'u_capTexture'),
      };
      
      // Log shader info for debugging
      console.log(`[WebGL] Shader: ${shaderFile}, Layout: ${getLayoutType(shaderFile)}`);'''

if old_uniform in content:
    content = content.replace(old_uniform, new_uniform)
    print("✅ Added shader logging to PatternDisplay.tsx")
else:
    print("⚠️ Uniform block pattern not found")

# Replace the null uniform warning with a more targeted one
old_warn = '''const nullUniforms = Object.entries(uniforms)
        .filter(([_, loc]) => loc === null)
        .map(([name]) => name);
      if (nullUniforms.length > 0) {
        console.warn('⚠️ Null uniform locations:', nullUniforms);
      }'''

new_warn = '''const nullUniforms = Object.entries(uniforms)
        .filter(([_, loc]) => loc === null)
        .map(([name]) => name);
      if (nullUniforms.length > 0) {
        // Only warn for critical uniforms that are actually used by this shader
        const criticalUniforms = ['u_resolution', 'u_noteData', 'u_playhead'];
        const missingCritical = nullUniforms.filter(u => criticalUniforms.includes(u));
        if (missingCritical.length > 0) {
          console.warn(`[WebGL] Missing critical uniforms in ${shaderFile}:`, missingCritical);
        } else {
          console.log(`[WebGL] Optional uniforms omitted (optimized out): ${shaderFile}`, nullUniforms);
        }
      }'''

if old_warn in content:
    content = content.replace(old_warn, new_warn)
    print("✅ Fixed uniform warning in PatternDisplay.tsx")
else:
    print("⚠️ Warning pattern not found")

with open('components/PatternDisplay.tsx', 'w') as f:
    f.write(content)

print("Done with PatternDisplay.tsx")
