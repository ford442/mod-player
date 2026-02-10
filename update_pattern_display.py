import re

file_path = 'components/PatternDisplay.tsx'

with open(file_path, 'r') as f:
    content = f.read()

# 1. Update glResourcesRef type definition
content = content.replace(
    'useRef<{ program: WebGLProgram; vao: WebGLVertexArrayObject; texture: WebGLTexture; buffer: WebGLBuffer; uniforms: any } | null>(null);',
    'useRef<{ program: WebGLProgram; vao: WebGLVertexArrayObject; texture: WebGLTexture; capTexture?: WebGLTexture; buffer: WebGLBuffer; uniforms: any } | null>(null);'
)

# 2. Update vsSource
vs_source_old = """    const vsSource = `#version 300 es
      in vec2 position;
      void main() {
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;"""

vs_source_new = """    // --- 1. WEBGL VERTEX SHADER ---
    const vsSource = `#version 300 es
    precision highp float;

    in vec2 a_pos;
    in vec2 a_uv;

    out vec2 v_uv;
    out float v_active;  // 1.0 if Playhead matches this step
    out float v_hasNote; // 1.0 if Note data exists here

    uniform vec2 u_resolution;
    uniform vec2 u_cellSize;
    uniform vec2 u_offset;
    uniform float u_cols;
    uniform float u_playhead;
    uniform int u_invertChannels;
    uniform int u_layoutMode; // 1=Circ, 2=Horiz32, 3=Horiz64
    uniform highp usampler2D u_noteData;

    const float PI = 3.14159265359;

    void main() {
        int id = gl_InstanceID;
        int col = id % int(u_cols); // Track Index
        int row = id / int(u_cols); // Step Index

        // 1. Check for Note Data
        uint note = texelFetch(u_noteData, ivec2(col, row), 0).r;
        v_hasNote = (note > 0u) ? 1.0 : 0.0;

        // 2. Calculate Scale/Size
        float scale = (note > 0u) ? 0.92 : 0.0; // Hide empty steps, shrink valid ones slightly for gap

        // 3. Playhead Logic
        float stepsPerPage = (u_layoutMode == 3) ? 64.0 : 32.0;
        float relativePlayhead = mod(u_playhead, stepsPerPage);

        if (abs(float(row) - relativePlayhead) < 0.5) {
             scale *= 1.15; // Pop effect on hit
             v_active = 1.0;
        } else {
             v_active = 0.0;
        }

        // 4. Positioning Logic
        if (u_layoutMode == 2 || u_layoutMode == 3) {
            // --- HORIZONTAL ---
            float xPos = float(row) * u_cellSize.x;
            float yPos = float(col) * u_cellSize.y;

            vec2 center = vec2(xPos, yPos) + u_cellSize * 0.5 + u_offset;
            // Use standard quad positions (-0.5 to 0.5)
            vec2 pos = center + (a_pos * u_cellSize * scale);

            vec2 ndc = (pos / u_resolution) * 2.0 - 1.0;
            ndc.y = -ndc.y;
            gl_Position = vec4(ndc, 0.0, 1.0);

        } else {
            // --- CIRCULAR (Basic Support) ---
            int ringIndex = col;
            if (u_invertChannels == 0) { ringIndex = int(u_cols) - 1 - col; }

            vec2 center = u_resolution * 0.5;
            float minDim = min(u_resolution.x, u_resolution.y);
            float maxRadius = minDim * 0.45;
            float minRadius = minDim * 0.15;
            float ringDepth = (maxRadius - minRadius) / u_cols;
            float radius = minRadius + float(ringIndex) * ringDepth;

            float totalSteps = 64.0;
            float anglePerStep = (2.0 * PI) / totalSteps;
            float theta = -1.570796 + float(row) * anglePerStep;

            float circumference = 2.0 * PI * radius;
            float arcLength = circumference / totalSteps;
            float btnW = arcLength * 0.95;
            float btnH = ringDepth * 0.95;

            vec2 localPos = a_pos * vec2(btnW, btnH) * scale;

            // Rotate
            float rotAng = theta + 1.570796;
            float cA = cos(rotAng); float sA = sin(rotAng);
            float rotX = localPos.x * cA - localPos.y * sA;
            float rotY = localPos.x * sA + localPos.y * cA;

            float worldX = center.x + cos(theta) * radius + rotX;
            float worldY = center.y + sin(theta) * radius + rotY;

            vec2 ndc = vec2((worldX / u_resolution.x) * 2.0 - 1.0, 1.0 - (worldY / u_resolution.y) * 2.0);
            gl_Position = vec4(ndc, 0.0, 1.0);
        }

        // Pass standard UV (0-1) for texture mapping
        v_uv = a_pos + 0.5;
    }
    `;"""

content = content.replace(vs_source_old, vs_source_new)

# 3. Update isOverlayShader (definition inside initWebGL)
content = content.replace(
    "const isOverlayShader = shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44');",
    "const isOverlayShader = shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46');"
)

# 4. Update fsSource
fs_source_new = """    // --- 2. WEBGL FRAGMENT SHADER (Blue/Orange Logic) ---
    const fsSource = `#version 300 es
    precision highp float;

    in vec2 v_uv;
    in float v_active;  // Playhead Hit
    in float v_hasNote; // Note Exists

    uniform sampler2D u_capTexture;

    out vec4 fragColor;

    void main() {
        // Read the "Frosted Glass" texture
        vec4 cap = texture(u_capTexture, v_uv);

        // Base Lighting (Idle)
        // If note exists, glow Blue. If not, invisible.
        vec3 lightColor = vec3(0.0);
        float intensity = 0.0;

        if (v_hasNote > 0.5) {
            // IDLE STATE: Cool Blue Data Glow
            lightColor = vec3(0.0, 0.6, 1.0);
            intensity = 0.8;
        }

        // Active Lighting (Hit)
        if (v_active > 0.5) {
            // HIT STATE: Warm Orange Energy
            // Mix with channel color if desired, or pure orange for contrast
            lightColor = vec3(1.0, 0.5, 0.1);
            intensity = 1.5; // Bloom boost
        }

        // Apply Light to Material
        vec3 finalRGB = cap.rgb * lightColor * intensity;

        // Final Output
        fragColor = vec4(finalRGB, cap.a * 0.9); // 0.9 alpha for translucency

        if (fragColor.a < 0.01) discard;
    }
    `;"""

content = re.sub(
    r'const fsSource = `.*?`;',
    fs_source_new,
    content,
    flags=re.DOTALL
)

# 5. Inject Texture Loading Logic
old_texture_block = """    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);"""

new_texture_block = """    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // --- NEW: Load Cap Texture (unlit-button.png) ---
    const capTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, capTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const capImg = new Image();
    capImg.onload = () => {
        if (!glCanvasRef.current) return;
        const currentGl = glContextRef.current;
        if (currentGl) {
            currentGl.bindTexture(currentGl.TEXTURE_2D, capTex);
            currentGl.texImage2D(currentGl.TEXTURE_2D, 0, currentGl.RGBA, currentGl.RGBA, currentGl.UNSIGNED_BYTE, capImg);
        }
    };
    capImg.src = 'unlit-button.png';"""

content = content.replace(old_texture_block, new_texture_block)

# 6. Update glResourcesRef assignment
gl_resources_new = """    glResourcesRef.current = {
      program: prog, vao, texture: tex, capTexture: capTex, buffer: buf,
      uniforms: {
        u_resolution: gl.getUniformLocation(prog, 'u_resolution'),
        u_cellSize: gl.getUniformLocation(prog, 'u_cellSize'),
        u_offset: gl.getUniformLocation(prog, 'u_offset'),
        u_cols: gl.getUniformLocation(prog, 'u_cols'),
        u_rows: gl.getUniformLocation(prog, 'u_rows'),
        u_playhead: gl.getUniformLocation(prog, 'u_playhead'),
        u_layoutMode: gl.getUniformLocation(prog, 'u_layoutMode'),
        u_invertChannels: gl.getUniformLocation(prog, 'u_invertChannels'),
        u_noteData: gl.getUniformLocation(prog, 'u_noteData'),
        u_capTexture: gl.getUniformLocation(prog, 'u_capTexture'),
      }
    };"""

content = re.sub(
    r'glResourcesRef\.current = \{.*?\};',
    gl_resources_new,
    content,
    flags=re.DOTALL
)

# 7. Update useEffect for data upload (line ~543)
content = content.replace(
    "if (!shaderFile.includes('v0.38') && !shaderFile.includes('v0.39') && !shaderFile.includes('v0.40') && !shaderFile.includes('v0.43') && !shaderFile.includes('v0.44')) return;",
    "if (!shaderFile.includes('v0.38') && !shaderFile.includes('v0.39') && !shaderFile.includes('v0.40') && !shaderFile.includes('v0.43') && !shaderFile.includes('v0.44') && !shaderFile.includes('v0.45') && !shaderFile.includes('v0.46')) return;"
)

# 8. Update drawWebGL: isOverlayShader check
content = content.replace(
    "const isOverlayShader = shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44');",
    "const isOverlayShader = shaderFile.includes('v0.38') || shaderFile.includes('v0.39') || shaderFile.includes('v0.40') || shaderFile.includes('v0.42') || shaderFile.includes('v0.43') || shaderFile.includes('v0.44') || shaderFile.includes('v0.45') || shaderFile.includes('v0.46');"
)

# 9. Update drawWebGL: Bindings
draw_webgl_bindings = """    gl.uniform1i(uniforms.u_noteData, 0);

    if (res.capTexture) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, res.capTexture);
        gl.uniform1i(uniforms.u_capTexture, 1);
    }"""

content = content.replace(
    'gl.uniform1i(uniforms.u_noteData, 0);',
    draw_webgl_bindings
)

# 10. Update drawWebGL: layoutMode logic
content = content.replace(
    "if (shaderFile.includes('v0.40') || shaderFile.includes('v0.43')) {",
    "if (shaderFile.includes('v0.40') || shaderFile.includes('v0.43') || shaderFile.includes('v0.46')) {"
)

with open(file_path, 'w') as f:
    f.write(content)
