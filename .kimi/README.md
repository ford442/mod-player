# Kimi Agent Tasks for mod-player

These are **prompt templates** for use with Kimi (via web interface or this chat).

## Usage

### Option 1: Run with me (Current Chat)
Since we're already talking, I can execute these tasks sequentially. Just say:
- "Run the polar chassis pipeline" 
- Or run individual tasks: "Execute 001-sdf-spec for design 'cyberpunk'"

### Option 2: Manual (Web Interface)
1. Open [kimi.com](https://kimi.com) in 3 browser tabs
2. Copy/paste the prompt from `tasks/001a-panel-spec.md` into Tab 1
3. Copy/paste `tasks/001b-knobs-spec.md` into Tab 2  
4. Copy/paste `tasks/001c-rings-spec.md` into Tab 3
5. When all complete, copy results into `specs/{design}/` and run the merge task in Tab 4

### Option 3: API Automation (Unified Pipeline)
Auto-detects Kimi Code API (Allegro) or Moonshot API:

```bash
# Set your API key (Kimi Code preferred, Moonshot fallback)
export KIMI_API_KEY="your-kimi-code-key"      # From kimi.com/code/console
# OR
export MOONSHOT_API_KEY="your-moonshot-key"   # From platform.moonshot.cn

# Run the full pipeline (parallel specs → sequential shader gen)
python scripts/run_chassis_pipeline.py polar
```

**What it does:**
1. **Phase 1 (Parallel)**: Panel + Knobs + Rings specs simultaneously
2. **Phase 2 (Sequential)**: Merge → Static shader → Audio reactive → Integration
3. **Auto-saves** to `specs/`, `src/shaders/`, `logs/` automatically

## File Structure

- `tasks/001a-panel-spec.md` - Panel SDF specification prompt
- `tasks/001b-knobs-spec.md` - Knobs SDF specification prompt
- `tasks/001c-rings-spec.md` - Rings SDF specification prompt
- `tasks/001d-merge-specs.md` - Merge task prompt
- `tasks/002-shader-gen.md` - Static shader generation prompt
- `tasks/003-audio-reactive.md` - Audio reactivity prompt
- `tasks/004-frontend-integrate.md` - Frontend integration prompt
- `config/chassis-pipeline.yaml` - Pipeline configuration

## Variables

All tasks accept these variables (replace in prompts manually):

| Variable | Default | Description |
|----------|---------|-------------|
| design_name | required | Identifier for the design (e.g., "polar", "cyber") |
| aesthetic_reference | "Access Virus Polar" | Visual style reference |
| primary_color | "white/silver" | Main chassis color |
| accent_color | "purple" | Knob/accent color |
| emissive_color | "cyan" | LED/Ring glow color |
| quality_preset | "high" | Raymarching quality |
| target_component | "Studio3D.tsx" | React component to modify |

## Quick Start

```bash
# Create output directory
mkdir -p specs/polar

# Then use one of the methods above to generate and save:
# specs/polar/panel_spec.md
# specs/polar/knobs_spec.md
# specs/polar/rings_spec.md
# specs/polar_chassis_spec.md (merged)
# src/shaders/polar_chassis.wgsl
```
