# Kimi Agent Tasks for mod-player

These are **prompt templates** for generating chassis shaders.

## Usage Options

### Option 1: Run with me (Current Chat) ✅ RECOMMENDED
Since we're already in chat, I can execute these tasks directly. Just tell me:
- **"Run the polar chassis pipeline"** - I'll execute all 5 tasks
- **"Execute task 001a for design 'cyberpunk'"** - Run individual task
- **"Generate chassis spec for design X"** - Quick start

### Option 2: Manual (Web Interface)
1. Open [kimi.com](https://kimi.com) 
2. Copy/paste the prompt from a task file into the chat
3. Save the output to the appropriate file

### Option 3: Copy Task Files as Prompts
Each `.md` file in `tasks/` is a self-contained prompt. Variables like `{{design_name}}` need to be replaced manually.

## Task Files

| Task | File | Purpose |
|------|------|---------|
| 001a | `tasks/001a-panel-spec.md` | Panel SDF specification |
| 001b | `tasks/001b-knobs-spec.md` | Knobs SDF specification |
| 001c | `tasks/001c-rings-spec.md` | Rings SDF specification |
| 001d | `tasks/001d-merge-specs.md` | Merge specs into one |
| 002 | `tasks/002-shader-gen.md` | Generate WGSL shader |
| 003 | `tasks/003-audio-reactive.md` | Add audio reactivity |
| 004 | `tasks/004-frontend-integrate.md` | React integration |

## Quick Start (With Me)

Just say:
```
"Run the chassis pipeline for design 'polar' with Access Virus Polar aesthetic"
```

I'll:
1. Generate panel/knobs/rings specs
2. Merge them
3. Create the WGSL shader
4. Add audio reactivity
5. Provide integration code

## Variables

All tasks accept these variables:

| Variable | Default | Description |
|----------|---------|-------------|
| design_name | required | Identifier (e.g., "polar", "cyber") |
| aesthetic_reference | "Access Virus Polar" | Visual style reference |
| primary_color | "white/silver" | Main chassis color |
| accent_color | "purple" | Knob/accent color |
| emissive_color | "cyan" | LED/Ring glow color |

## Output Structure

```
specs/
├── {design}/
│   ├── panel_spec.md
│   ├── knobs_spec.md
│   └── rings_spec.md
└── {design}_chassis_spec.md

src/shaders/
└── {design}_chassis.wgsl
```
