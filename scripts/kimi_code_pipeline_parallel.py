#!/usr/bin/env python3
# scripts/kimi_code_pipeline_parallel.py
# Parallel Kimi Code API pipeline (uses Allegro quota faster)
# Usage: KIMI_CODE_API_KEY=your-key python scripts/kimi_code_pipeline_parallel.py [design_name]

import os
import sys
import asyncio
import aiohttp
from pathlib import Path

API_KEY = os.getenv("KIMI_CODE_API_KEY", "")
BASE_URL = os.getenv("KIMI_CODE_BASE_URL", "https://api.kimi.com/v1")

if not API_KEY:
    print("Error: KIMI_CODE_API_KEY environment variable not set")
    sys.exit(1)

HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

async def run_task_async(session, task_file, design_name, **extra_vars):
    """Execute task via Kimi Code API (async)"""
    
    # Read prompt template
    prompt = Path(task_file).read_text()
    
    # Remove YAML frontmatter
    if prompt.startswith("---"):
        parts = prompt.split("---", 2)
        if len(parts) >= 3:
            prompt = parts[2].strip()
    
    # Variable substitution
    prompt = prompt.replace("{{design_name}}", design_name)
    for k, v in extra_vars.items():
        prompt = prompt.replace(f"{{{{{k}}}}}", str(v))
    
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
    
    async with session.post(
        f"{BASE_URL}/chat/completions",
        headers=HEADERS,
        json=payload,
        timeout=aiohttp.ClientTimeout(total=120)
    ) as response:
        response.raise_for_status()
        result = await response.json()
        return result["choices"][0]["message"]["content"]

async def run_parallel_specs(session, design, vars_dict):
    """Run panel, knobs, rings specs in parallel"""
    tasks = [
        run_task_async(session, ".kimi/tasks/001a-panel-spec.md", design, **vars_dict),
        run_task_async(session, ".kimi/tasks/001b-knobs-spec.md", design, **vars_dict),
        run_task_async(session, ".kimi/tasks/001c-rings-spec.md", design, **vars_dict)
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # Check for errors
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            component = ["panel", "knobs", "rings"][i]
            print(f"   ❌ {component} failed: {result}")
            raise result
    
    return {
        "panel": results[0],
        "knobs": results[1],
        "rings": results[2]
    }

async def main():
    design = sys.argv[1] if len(sys.argv) > 1 else "polar"
    
    vars_dict = {
        "primary_color": "white/silver",
        "accent_color": "purple",
        "emissive_color": "cyan/blue",
        "finish": "satin metallic",
        "ring_count": "4",
        "segment_count": "32"
    }
    
    specs_dir = Path(f"specs/{design}")
    specs_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"🚀 Parallel pipeline for '{design}' via Kimi Code API...")
    print(f"   API: {BASE_URL}\n")
    
    # Phase 1: Parallel specs
    print("[Phase 1/2] Generating specs in parallel...")
    async with aiohttp.ClientSession() as session:
        try:
            results = await run_parallel_specs(session, design, vars_dict)
            
            # Save results
            (specs_dir / "panel_spec.md").write_text(results["panel"])
            (specs_dir / "knobs_spec.md").write_text(results["knobs"])
            (specs_dir / "rings_spec.md").write_text(results["rings"])
            
            print("   ✅ Panel spec saved")
            print("   ✅ Knobs spec saved")
            print("   ✅ Rings spec saved")
            
        except Exception as e:
            print(f"   ❌ Parallel generation failed: {e}")
            return
    
    # Phase 2: Sequential merge (requires all specs)
    print("\n[Phase 2/2] Merging specifications...")
    async with aiohttp.ClientSession() as session:
        try:
            merge_vars = vars_dict.copy()
            merge_vars["panel_spec"] = results["panel"][:3000]
            merge_vars["knobs_spec"] = results["knobs"][:3000]
            merge_vars["rings_spec"] = results["rings"][:3000]
            
            final_spec = await run_task_async(
                session, ".kimi/tasks/001d-merge-specs.md", 
                design, **merge_vars
            )
            
            merged_path = Path(f"specs/{design}_chassis_spec.md")
            merged_path.write_text(final_spec)
            print("   ✅ Merged spec saved")
            
        except Exception as e:
            print(f"   ❌ Merge failed: {e}")
            return
    
    print(f"\n✅ Complete! Check specs/{design}/")

if __name__ == "__main__":
    asyncio.run(main())
