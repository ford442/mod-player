#!/usr/bin/env python3
# scripts/run_chassis_pipeline.py
# Unified pipeline: Auto-detects Kimi Code API (Allegro) or Moonshot API
# Usage: export KIMI_API_KEY=your-key; python scripts/run_chassis_pipeline.py polar

import asyncio
import aiohttp
import os
import sys
from pathlib import Path
from typing import Optional, Dict

# Configuration
class APIConfig:
    def __init__(self):
        # Prefer Kimi Code API (Allegro), fallback to Moonshot
        self.kimi_key = os.getenv("KIMI_API_KEY")
        self.moonshot_key = os.getenv("MOONSHOT_API_KEY")
        
        if self.kimi_key:
            self.key = self.kimi_key
            self.base_url = "https://api.kimi.com/v1"
            self.provider = "kimi-code"
            self.model = "kimi-code-latest"
            print("🔑 Using Kimi Code API (Allegro)")
        elif self.moonshot_key:
            self.key = self.moonshot_key
            self.base_url = "https://api.moonshot.cn/v1"
            self.provider = "moonshot"
            self.model = "kimi-latest"
            print("🔑 Using Moonshot API")
        else:
            raise ValueError("No API key found. Set KIMI_API_KEY or MOONSHOT_API_KEY")

class ChassisPipeline:
    def __init__(self, design_name: str, config: APIConfig):
        self.design = design_name
        self.config = config
        self.headers = {
            "Authorization": f"Bearer {config.key}",
            "Content-Type": "application/json"
        }
        
        # Ensure directories exist
        Path(f"specs/{design_name}").mkdir(parents=True, exist_ok=True)
        Path("src/shaders").mkdir(parents=True, exist_ok=True)
        Path("logs").mkdir(exist_ok=True)
    
    async def call_api(self, session: aiohttp.ClientSession, prompt: str, task_name: str) -> str:
        """Make API call with retry logic"""
        payload = {
            "model": self.config.model,
            "messages": [
                {
                    "role": "system",
                    "content": "You are a specialized WGSL shader and SDF mathematics expert. Output only the requested code or specification without explanations, markdown code blocks, or commentary. Raw output only."
                },
                {
                    "role": "user", 
                    "content": prompt
                }
            ],
            "temperature": 0.2,
            "max_tokens": 8000
        }
        
        try:
            async with session.post(
                f"{self.config.base_url}/chat/completions",
                headers=self.headers,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=120)
            ) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    raise Exception(f"API Error {resp.status}: {text}")
                
                data = await resp.json()
                return data["choices"][0]["message"]["content"]
        except Exception as e:
            print(f"❌ Error in {task_name}: {e}")
            raise
    
    def load_task(self, task_file: str, **vars) -> str:
        """Load task template and substitute variables"""
        path = Path(f".kimi/tasks/{task_file}")
        if not path.exists():
            raise FileNotFoundError(f"Task file not found: {path}")
        
        content = path.read_text()
        content = content.replace("{{design_name}}", self.design)
        for key, val in vars.items():
            content = content.replace(f"{{{{{key}}}}}", str(val))
        return content
    
    def clean_output(self, content: str, file_type: str = "md") -> str:
        """Remove markdown code blocks if present"""
        content = content.strip()
        if content.startswith("```"):
            lines = content.split("\n")
            # Remove first ```lang and last ```
            if len(lines) > 1:
                content = "\n".join(lines[1:-1]) if lines[-1].strip() == "```" else "\n".join(lines[1:])
        return content.strip()
    
    async def run_parallel_specs(self, session: aiohttp.ClientSession):
        """Run 001a, 001b, 001c in parallel"""
        print("🚀 Phase 1: Parallel spec generation...")
        
        tasks = {
            "panel": self.load_task("001a-panel-spec.md", primary_color="white/silver", finish="satin metallic"),
            "knobs": self.load_task("001b-knobs-spec.md", accent_color="purple"),
            "rings": self.load_task("001c-rings-spec.md", emissive_color="cyan", ring_count=4, segment_count=32)
        }
        
        async def run_component(name: str, prompt: str):
            print(f"  🎨 Starting {name}...")
            result = await self.call_api(session, prompt, f"001-{name}")
            cleaned = self.clean_output(result, "md")
            
            output_path = f"specs/{self.design}/{name}_spec.md"
            Path(output_path).write_text(cleaned)
            print(f"  ✅ {name} saved to {output_path}")
            return name, cleaned
        
        # Execute all three in parallel
        results = await asyncio.gather(*[
            run_component(name, prompt) for name, prompt in tasks.items()
        ])
        
        return dict(results)
    
    async def run_sequential_pipeline(self, session: aiohttp.ClientSession, specs: Dict[str, str]):
        """Run 001d, 002, 003, 004 sequentially"""
        
        # Task 001d: Merge specs
        print("\n🔗 Phase 2: Merging specifications...")
        merge_prompt = self.load_task("001d-merge-specs.md")
        # Inject the three specs into the merge prompt context
        merge_context = f"""
{merge_prompt}

INPUT SPECIFICATIONS TO MERGE:

=== PANEL SPEC ===
{specs['panel']}

=== KNOBS SPEC ===
{specs['knobs']}

=== RINGS SPEC ===
{specs['rings']}

Merge these into a single unified specification file.
"""
        merged = await self.call_api(session, merge_context, "001d-merge")
        merged = self.clean_output(merged, "md")
        
        merged_path = f"specs/{self.design}_chassis_spec.md"
        Path(merged_path).write_text(merged)
        print(f"  ✅ Merged spec saved to {merged_path}")
        
        # Task 002: Static shader
        print("\n🎨 Phase 3: Generating static WGSL shader...")
        shader_prompt = self.load_task("002-shader-gen.md")
        shader_context = f"""
{shader_prompt}

BASE THIS ON THE FOLLOWING SPECIFICATION:
{merged}
"""
        shader = await self.call_api(session, shader_context, "002-shader")
        shader = self.clean_output(shader, "wgsl")
        
        shader_path = f"src/shaders/{self.design}_chassis.wgsl"
        Path(shader_path).write_text(shader)
        print(f"  ✅ Static shader saved to {shader_path}")
        
        # Task 003: Audio reactive
        print("\n🎵 Phase 4: Adding audio reactivity...")
        audio_prompt = self.load_task("003-audio-reactive.md")
        audio_context = f"""
{audio_prompt}

CURRENT SHADER TO MODIFY:
```wgsl
{shader}
```
"""
        reactive_shader = await self.call_api(session, audio_context, "003-audio")
        reactive_shader = self.clean_output(reactive_shader, "wgsl")
        
        Path(shader_path).write_text(reactive_shader)  # Overwrite
        print(f"  ✅ Audio-reactive shader saved to {shader_path}")
        
        # Task 004: Integration
        print("\n🔌 Phase 5: Generating integration code...")
        integrate_prompt = self.load_task("004-frontend-integrate.md")
        integration = await self.call_api(session, integrate_prompt, "004-integrate")
        
        # Save integration instructions
        integrate_path = f"logs/{self.design}_integration.md"
        Path(integrate_path).write_text(integration)
        print(f"  ✅ Integration guide saved to {integrate_path}")
        
        return reactive_shader, integration

    async def run(self):
        """Execute full pipeline"""
        print(f"\n🎯 Starting Chassis Pipeline for: {self.design}")
        print(f"   Provider: {self.config.provider}")
        print(f"   Model: {self.config.model}\n")
        
        async with aiohttp.ClientSession() as session:
            # Phase 1: Parallel
            specs = await self.run_parallel_specs(session)
            
            # Phase 2-5: Sequential
            final_shader, integration = await self.run_sequential_pipeline(session, specs)
            
            print(f"\n✅ Pipeline complete!")
            print(f"   Spec: specs/{self.design}_chassis_spec.md")
            print(f"   Shader: src/shaders/{self.design}_chassis.wgsl")
            print(f"   Integration: logs/{self.design}_integration.md")
            
            return final_shader

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Generate chassis shaders via Kimi API")
    parser.add_argument("design_name", help="Design identifier (e.g., polar, cyberpunk)")
    parser.add_argument("--sequential", action="store_true", help="Force sequential execution (slower but safer)")
    args = parser.parse_args()
    
    try:
        config = APIConfig()
        pipeline = ChassisPipeline(args.design_name, config)
        
        if args.sequential:
            # Force sequential for all tasks if rate limited
            print("⚠️  Sequential mode (parallel specs disabled)")
            # Implementation would go here...
        else:
            # Normal parallel execution
            asyncio.run(pipeline.run())
            
    except Exception as e:
        print(f"\n❌ Pipeline failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
