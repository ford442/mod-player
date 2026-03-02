#!/usr/bin/env python3
# scripts/kimi_api_swarm.py
# Parallel task execution via Kimi HTTP API
# Requires: KIMI_API_KEY environment variable
# Usage: KIMI_API_KEY=your-key python scripts/kimi_api_swarm.py <design_name>

import asyncio
import aiohttp
import os
import sys

API_KEY = os.getenv("KIMI_API_KEY", "")
API_URL = "https://api.moonshot.cn/v1/chat/completions"

TASKS = {
    "panel": ".kimi/tasks/001a-panel-spec.md",
    "knobs": ".kimi/tasks/001b-knobs-spec.md", 
    "rings": ".kimi/tasks/001c-rings-spec.md"
}

async def run_agent(session, component, design_name, vars_dict):
    """Send task to Kimi API"""
    # Read the task prompt template
    with open(TASKS[component], 'r') as f:
        prompt_template = f.read()
    
    # Replace variables
    prompt = prompt_template
    for key, value in vars_dict.items():
        prompt = prompt.replace(f"{{{{{key}}}}}", value)
    prompt = prompt.replace("{{design_name}}", design_name)
    
    payload = {
        "model": "kimi-latest",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2
    }
    
    headers = {"Authorization": f"Bearer {API_KEY}"}
    
    async with session.post(API_URL, json=payload, headers=headers) as resp:
        result = await resp.json()
        if 'choices' not in result:
            print(f"❌ {component} failed: {result.get('error', 'Unknown error')}")
            return component, False
            
        output = result['choices'][0]['message']['content']
        
        # Save output
        os.makedirs(f"specs/{design_name}", exist_ok=True)
        with open(f"specs/{design_name}/{component}_spec.md", 'w') as f:
            f.write(output)
        print(f"✅ {component} complete")
        return component, True

async def main():
    if not API_KEY:
        print("Error: KIMI_API_KEY environment variable not set")
        print("Usage: KIMI_API_KEY=your-key python scripts/kimi_api_swarm.py <design_name>")
        sys.exit(1)
    
    design = sys.argv[1] if len(sys.argv) > 1 else "polar"
    
    # Default variables
    vars_dict = {
        "primary_color": "white/silver",
        "accent_color": "purple",
        "emissive_color": "cyan/blue",
        "finish": "satin metallic",
        "ring_count": "4",
        "segment_count": "32"
    }
    
    print(f"🚀 Starting API swarm for: {design}")
    
    async with aiohttp.ClientSession() as session:
        # Launch all three in parallel
        tasks = [
            run_agent(session, "panel", design, vars_dict),
            run_agent(session, "knobs", design, vars_dict),
            run_agent(session, "rings", design, vars_dict)
        ]
        results = await asyncio.gather(*tasks)
    
    # Check if all succeeded
    if all(success for _, success in results):
        # Sequential merge (run locally)
        print("🔗 Merging specifications...")
        os.system(f"kimi task run .kimi/tasks/001d-merge-specs.md --var design_name={design}")
        print("✅ Phase 1 complete!")
    else:
        print("❌ Some parallel tasks failed")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
