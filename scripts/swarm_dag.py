#!/usr/bin/env python3
import asyncio
import subprocess
import sys
from dataclasses import dataclass
from typing import List, Set
import argparse

@dataclass
class Task:
    id: str
    file: str
    deps: Set[str]
    parallel: bool = False

# DAG Definition
TASKS = {
    "001a": Task("001a", ".kimi/tasks/001a-panel-spec.md", set(), parallel=True),
    "001b": Task("001b", ".kimi/tasks/001b-knobs-spec.md", set(), parallel=True),
    "001c": Task("001c", ".kimi/tasks/001c-rings-spec.md", set(), parallel=True),
    "001d": Task("001d", ".kimi/tasks/001d-merge-specs.md", {"001a", "001b", "001c"}),
    "002": Task("002", ".kimi/tasks/002-shader-gen.md", {"001d"}),
    "003": Task("003", ".kimi/tasks/003-audio-reactive.md", {"002"}),
    "004": Task("004", ".kimi/tasks/004-frontend-integrate.md", {"003"}),
}

async def run_task(task_id: str, design_name: str, vars: dict):
    """Execute a single Kimi task"""
    task = TASKS[task_id]
    cmd = ["kimi", "task", "run", task.file, "--var", f"design_name={design_name}"]
    
    for k, v in vars.items():
        cmd.extend(["--var", f"{k}={v}"])
    
    print(f"[{task_id}] Starting...")
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await proc.communicate()
    
    if proc.returncode == 0:
        print(f"[{task_id}] ✅ Complete")
        return True
    else:
        print(f"[{task_id}] ❌ Failed: {stderr.decode()}")
        return False

async def run_parallel(tasks: List[str], design_name: str, vars: dict):
    """Execute tasks in parallel (swarm)"""
    await asyncio.gather(*[run_task(tid, design_name, vars) for tid in tasks])

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("design_name")
    parser.add_argument("--var", action="append", default=[])
    args = parser.parse_args()
    
    # Parse extra vars
    vars = {}
    for v in args.var:
        k, val = v.split("=", 1)
        vars[k] = val
    
    # Phase 1: Parallel group
    parallel_tasks = [t.id for t in TASKS.values() if t.parallel]
    print(f"🚀 Starting parallel swarm: {parallel_tasks}")
    await run_parallel(parallel_tasks, args.design_name, vars)
    
    # Phase 2: Sequential dependency chain
    sequential = ["001d", "002", "003", "004"]
    for task_id in sequential:
        success = await run_task(task_id, args.design_name, vars)
        if not success:
            print("❌ Pipeline halted due to failure")
            sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
