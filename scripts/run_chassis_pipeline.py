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
        
        # Allow custom base URL via environment
        custom_base = os.getenv("KIMI_BASE_URL")
        
        if self.kimi_key:
            self.key = self.kimi_key
            # Try multiple possible endpoints for Kimi Code
            # Order: user override > code.kimi.com (known working) > others
            self.base_urls = [
                custom_base,  # User override first
                "https://code.kimi.com/api",  # Known working from test
                "https://api.kimi.com/v1",
                "https://kimi.com/api/v1",
            ]
            self.base_url = self.base_urls[0] if custom_base else self.base_urls[1]
            self.provider = "kimi-code"
            self.model = os.getenv("KIMI_MODEL", "kimi-code-latest")
            print(f"🔑 Using Kimi Code API (Allegro)")
            print(f"   Endpoint: {self.base_url}")
            if not custom_base:
                print(f"   Tip: Set KIMI_BASE_URL to override")
        elif self.moonshot_key:
            self.key = self.moonshot_key
            self.base_url = custom_base or "https://api.moonshot.cn/v1"
            self.base_urls = [self.base_url]
            self.provider = "moonshot"
            self.model = os.getenv("MOONSHOT_MODEL", "kimi-latest")
            print("🔑 Using Moonshot API")
            print(f"   Endpoint: {self.base_url}")
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
        """Make API call with retry logic and endpoint fallback"""
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
        
        last_error = None
        
        # Try each endpoint in order
        for base_url in self.config.base_urls:
            if not base_url:
                continue
                
            try:
                async with session.post(
                    f"{base_url}/chat/completions",
                    headers=self.headers,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=120)
                ) as resp:
                    if resp.status == 404:
                        # Endpoint not found, try next
                        last_error = f"404 from {base_url}"
                        continue
                    
                    if resp.status != 200:
                        text = await resp.text()
                        raise Exception(f"API Error {resp.status} from {base_url}: {text}")
                    
                    data = await resp.json()
                    return data["choices"][0]["message"]["content"]
                    
            except aiohttp.ClientConnectorError as e:
                last_error = f"Cannot connect to {base_url}: {e}"
                continue
            except Exception as e:
                last_error = str(e)
                # Don't retry on auth errors
                if "401" in str(e) or "403" in str(e):
                    raise
                continue
        
        # All endpoints failed
        print(f"❌ Error in {task_name}: All endpoints failed")
        print(f"   Last error: {last_error}")
        print(f"\n   Troubleshooting:")
        print(f"   1. Check your API key is correct: echo $KIMI_API_KEY")
        print(f"   2. Verify the endpoint URL in your Kimi Code console")
        print(f"   3. Set custom endpoint: export KIMI_BASE_URL=https://correct.endpoint.com/v1")
        raise Exception(f"All API endpoints failed. Last: {last_error}")
    
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
    
    async def run_parallel_specs(self):
        """Run 001a, 001b, 001c in parallel with individual sessions"""
        print("🚀 Phase 1: Parallel spec generation...")
        
        tasks = {
            "panel": self.load_task("001a-panel-spec.md", primary_color="white/silver", finish="satin metallic"),
            "knobs": self.load_task("001b-knobs-spec.md", accent_color="purple"),
            "rings": self.load_task("001c-rings-spec.md", emissive_color="cyan", ring_count=4, segment_count=32)
        }
        
        async def run_component(name: str, prompt: str):
            print(f"  🎨 Starting {name}...")
            # Each component gets its own session to avoid conflicts
            async with aiohttp.ClientSession() as session:
                result = await self.call_api(session, prompt, f"001-{name}")
            cleaned = self.clean_output(result, "md")
            
            output_path = f"specs/{self.design}/{name}_spec.md"
            Path(output_path).write_text(cleaned)
            print(f"  ✅ {name} saved to {output_path}")
            return name, cleaned
        
        # Execute all three in parallel
        results = await asyncio.gather(*[
            run_component(name, prompt) for name, prompt in tasks.items()
        ], return_exceptions=True)
        
        # Check for errors
        final_results = {}
        for i, (name, _) in enumerate(tasks.items()):
            result = results[i]
            if isinstance(result, Exception):
                print(f"  ❌ {name} failed: {result}")
                raise result
            final_results[name] = result[1]  # result is (name, content) tuple
        
        return final_results
    
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
        
        # Phase 1: Parallel (each component has its own session)
        specs = await self.run_parallel_specs()
        
        # Phase 2-5: Sequential (uses new session)
        async with aiohttp.ClientSession() as session:
            final_shader, integration = await self.run_sequential_pipeline(session, specs)
        
        print(f"\n✅ Pipeline complete!")
        print(f"   Spec: specs/{self.design}_chassis_spec.md")
        print(f"   Shader: src/shaders/{self.design}_chassis.wgsl")
        print(f"   Integration: logs/{self.design}_integration.md")
        
        return final_shader

async def test_endpoints():
    """Test which endpoints are available"""
    key = os.getenv("KIMI_API_KEY") or os.getenv("MOONSHOT_API_KEY")
    if not key:
        print("No API key set. Set KIMI_API_KEY or MOONSHOT_API_KEY")
        return
    
    endpoints = [
        ("Kimi Code (api.kimi.com)", "https://api.kimi.com/v1"),
        ("Kimi Code (code.kimi.com)", "https://code.kimi.com/api"),
        ("Kimi Code (kimi.com/api)", "https://kimi.com/api/v1"),
        ("Moonshot", "https://api.moonshot.cn/v1"),
    ]
    
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    
    print("🔍 Testing API endpoints...\n")
    
    async with aiohttp.ClientSession() as session:
        for name, url in endpoints:
            try:
                async with session.get(f"{url}/models", headers=headers, timeout=10) as resp:
                    status = "✅ Working" if resp.status == 200 else f"❌ HTTP {resp.status}"
                    print(f"  {name}: {status}")
            except Exception as e:
                print(f"  {name}: ❌ {type(e).__name__}")
    
    print("\nSet the working endpoint with:")
    print("  export KIMI_BASE_URL=https://working.endpoint.com/v1")

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Generate chassis shaders via Kimi API")
    parser.add_argument("design_name", nargs="?", help="Design identifier (e.g., polar, cyberpunk)")
    parser.add_argument("--test", action="store_true", help="Test API endpoints and exit")
    parser.add_argument("--sequential", action="store_true", help="Force sequential execution (slower but safer)")
    args = parser.parse_args()
    
    if args.test:
        asyncio.run(test_endpoints())
        return
    
    if not args.design_name:
        parser.print_help()
        print("\nExample: python scripts/run_chassis_pipeline.py polar")
        sys.exit(1)
    
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
        print("\nRun with --test to check available endpoints:")
        print("  python scripts/run_chassis_pipeline.py --test")
        sys.exit(1)

if __name__ == "__main__":
    main()
