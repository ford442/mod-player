#!/usr/bin/env python3
# scripts/kimi_code_pipeline.py
# Kimi Code API pipeline (Allegro subscription)
# Usage: KIMI_CODE_API_KEY=your-key python scripts/kimi_code_pipeline.py [design_name]

import os
import sys
import requests
from pathlib import Path

# Kimi Code API configuration
API_KEY = os.getenv("KIMI_CODE_API_KEY", "")
BASE_URL = os.getenv("KIMI_CODE_BASE_URL", "https://api.kimi.com/v1")

if not API_KEY:
    print("Error: KIMI_CODE_API_KEY environment variable not set")
    print("\nTo get your key:")
    print("1. Open Kimi Code IDE/Console")
    print("2. Go to Settings → API Keys")
    print("3. Generate a new key")
    print("4. Set it: export KIMI_CODE_API_KEY=your-key")
    sys.exit(1)

HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

def run_task(task_file, design_name, **extra_vars):
    """Execute task via Kimi Code API"""
    
    # Read prompt template
    prompt = Path(task_file).read_text()
    
    # Remove YAML frontmatter if present
    if prompt.startswith("---"):
        # Find the second ---
        parts = prompt.split("---", 2)
        if len(parts) >= 3:
            prompt = parts[2].strip()
    
    # Variable substitution
    prompt = prompt.replace("{{design_name}}", design_name)
    for k, v in extra_vars.items():
        prompt = prompt.replace(f"{{{{{k}}}}}", str(v))
    
    # Kimi Code API payload (OpenAI-compatible)
    payload = {
        "model": "kimi-code-latest",
        "messages": [
            {
                "role": "system", 
                "content": "You are a specialized coding agent for WebGPU shader generation. Output only the requested code/specifications without explanations."
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "temperature": 0.1,
        "max_tokens": 8000
    }
    
    try:
        response = requests.post(
            f"{BASE_URL}/chat/completions",
            headers=HEADERS,
            json=payload,
            timeout=120
        )
        response.raise_for_status()
        
        result = response.json()
        return result["choices"][0]["message"]["content"]
        
    except requests.exceptions.HTTPError as e:
        if response.status_code == 401:
            print(f"   ❌ Authentication failed - check your API key")
        elif response.status_code == 429:
            print(f"   ❌ Rate limit exceeded - wait a moment and retry")
        else:
            print(f"   ❌ HTTP error: {e}")
        raise
    except Exception as e:
        print(f"   ❌ Request failed: {e}")
        raise

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
    
    print(f"🚀 Running pipeline for '{design}' via Kimi Code API...")
    print(f"   API: {BASE_URL}")
    print(f"   Output: specs/{design}/\n")
    
    # Task 1: Panel Spec
    print("[1/4] Generating Panel SDF spec...")
    try:
        panel_spec = run_task(".kimi/tasks/001a-panel-spec.md", design, **vars_dict)
        (specs_dir / "panel_spec.md").write_text(panel_spec)
        print("   ✅ Saved to specs/{}/panel_spec.md".format(design))
    except Exception as e:
        print(f"   ❌ Failed: {e}")
        return
    
    # Task 2: Knobs Spec
    print("[2/4] Generating Knobs SDF spec...")
    try:
        knobs_spec = run_task(".kimi/tasks/001b-knobs-spec.md", design, **vars_dict)
        (specs_dir / "knobs_spec.md").write_text(knobs_spec)
        print("   ✅ Saved to specs/{}/knobs_spec.md".format(design))
    except Exception as e:
        print(f"   ❌ Failed: {e}")
        return
    
    # Task 3: Rings Spec
    print("[3/4] Generating Rings SDF spec...")
    try:
        rings_spec = run_task(".kimi/tasks/001c-rings-spec.md", design, **vars_dict)
        (specs_dir / "rings_spec.md").write_text(rings_spec)
        print("   ✅ Saved to specs/{}/rings_spec.md".format(design))
    except Exception as e:
        print(f"   ❌ Failed: {e}")
        return
    
    # Task 4: Merge
    print("[4/4] Merging specifications...")
    try:
        # For merge, we pass the individual specs as context
        merge_vars = vars_dict.copy()
        merge_vars["panel_spec"] = panel_spec[:3000]  # Truncate for context
        merge_vars["knobs_spec"] = knobs_spec[:3000]
        merge_vars["rings_spec"] = rings_spec[:3000]
        
        final_spec = run_task(".kimi/tasks/001d-merge-specs.md", design, **merge_vars)
        
        merged_path = Path(f"specs/{design}_chassis_spec.md")
        merged_path.write_text(final_spec)
        print("   ✅ Saved to specs/{}_chassis_spec.md".format(design))
        
    except Exception as e:
        print(f"   ❌ Failed: {e}")
        return
    
    print(f"\n✅ Phase 1 complete!")
    print(f"   Next: Run 002-shader-gen to create the WGSL shader")
    print(f"   Command: python scripts/kimi_code_pipeline.py {design}")
    print(f"   Or use:  kimi task run .kimi/tasks/002-shader-gen.md --var design_name={design}")

if __name__ == "__main__":
    main()
