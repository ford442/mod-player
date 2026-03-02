#!/usr/bin/env python3
# scripts/run_pipeline.py
# Sequential pipeline execution using OpenAI-compatible API
# Usage: KIMI_API_KEY=your-key python scripts/run_pipeline.py [design_name]

import os
import sys
from pathlib import Path

try:
    from openai import OpenAI
except ImportError:
    print("Error: openai package not installed")
    print("Install with: pip install openai")
    sys.exit(1)

API_KEY = os.getenv("KIMI_API_KEY", "")
if not API_KEY:
    print("Error: KIMI_API_KEY environment variable not set")
    print("Get your key from: https://platform.moonshot.cn/")
    print("Then run: export KIMI_API_KEY=your-key")
    sys.exit(1)

client = OpenAI(
    api_key=API_KEY,
    base_url="https://api.moonshot.cn/v1"
)

def run_task(task_file, design_name, **vars):
    """Execute a single task file"""
    with open(task_file) as f:
        prompt = f.read()
    
    # Simple variable substitution
    for key, val in vars.items():
        prompt = prompt.replace(f"{{{{{key}}}}}", str(val))
    prompt = prompt.replace("{{design_name}}", design_name)
    
    # Remove YAML frontmatter if present
    if prompt.startswith("---"):
        prompt = prompt.split("---", 2)[-1].strip()
    
    response = client.chat.completions.create(
        model="kimi-latest",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2
    )
    
    return response.choices[0].message.content

def main():
    design = sys.argv[1] if len(sys.argv) > 1 else "polar"
    
    # Default variables
    vars_dict = {
        "primary_color": "white/silver",
        "accent_color": "purple",
        "emissive_color": "cyan/blue",
        "finish": "satin metallic",
        "ring_count": "4",
        "segment_count": "32",
        "quality_preset": "high",
        "animation_style": "smooth",
        "target_component": "Studio3D.tsx"
    }
    
    # Create output directory
    specs_dir = Path(f"specs/{design}")
    specs_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"🚀 Running pipeline for: {design}\n")
    
    # Task 1: Panel Spec
    print("🎨 Task 1/4: Panel Spec...")
    try:
        panel = run_task(".kimi/tasks/001a-panel-spec.md", design, **vars_dict)
        (specs_dir / "panel_spec.md").write_text(panel)
        print("   ✅ Saved to specs/{}/panel_spec.md\n".format(design))
    except Exception as e:
        print(f"   ❌ Failed: {e}\n")
        return
    
    # Task 2: Knobs Spec
    print("🎛️  Task 2/4: Knobs Spec...")
    try:
        knobs = run_task(".kimi/tasks/001b-knobs-spec.md", design, **vars_dict)
        (specs_dir / "knobs_spec.md").write_text(knobs)
        print("   ✅ Saved to specs/{}/knobs_spec.md\n".format(design))
    except Exception as e:
        print(f"   ❌ Failed: {e}\n")
        return
    
    # Task 3: Rings Spec
    print("💍 Task 3/4: Rings Spec...")
    try:
        rings = run_task(".kimi/tasks/001c-rings-spec.md", design, **vars_dict)
        (specs_dir / "rings_spec.md").write_text(rings)
        print("   ✅ Saved to specs/{}/rings_spec.md\n".format(design))
    except Exception as e:
        print(f"   ❌ Failed: {e}\n")
        return
    
    # Task 4: Merge
    print("🔗 Task 4/4: Merging specifications...")
    try:
        # Read the individual specs for context
        panel_content = (specs_dir / "panel_spec.md").read_text()
        knobs_content = (specs_dir / "knobs_spec.md").read_text()
        rings_content = (specs_dir / "rings_spec.md").read_text()
        
        merge_prompt = f"""Merge these three chassis component specifications into a unified specification:

## Panel Spec:
{panel_content[:2000]}

## Knobs Spec:
{knobs_content[:2000]}

## Rings Spec:
{rings_content[:2000]}

Create a single markdown file with:
1. Panel Geometry section
2. Knob Geometry section  
3. Ring Geometry section
4. Unified Uniform Structs
5. PBR Lighting Model (global settings)

Design name: {design}
"""
        
        response = client.chat.completions.create(
            model="kimi-latest",
            messages=[{"role": "user", "content": merge_prompt}],
            temperature=0.2
        )
        merged = response.choices[0].message.content
        
        merged_path = Path(f"specs/{design}_chassis_spec.md")
        merged_path.write_text(merged)
        print("   ✅ Saved to specs/{}_chassis_spec.md\n".format(design))
        
    except Exception as e:
        print(f"   ❌ Failed: {e}\n")
        return
    
    print("✅ Phase 1 complete! Next: Run 002-shader-gen to create the WGSL shader.")

if __name__ == "__main__":
    main()
