# Resource Management for Parallel Agent Execution

This document describes resource controls for running parallel shader generation.

## Codespaces Environment

In Codespaces you're containerized with limited privileges—no `nice`, `taskset`, or cgroups. Use these alternatives:

### Option 1: Asyncio/Python (Most Reliable)

Pure Python - no OS privileges needed:

```python
# scripts/swarm_codespace.py
import asyncio
import subprocess

async def run_agent(task_file: str, design: str, component: str):
    """Pure asyncio - no OS privileges needed"""
    proc = await asyncio.create_subprocess_exec(
        "kimi", "task", "run", task_file,
        "--var", f"design_name={design}",
        "--var", f"component={component}",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await proc.communicate()
    return proc.returncode == 0, stdout.decode()

# Run all three specs simultaneously
async def parallel_specs(design):
    results = await asyncio.gather(
        run_agent(".kimi/tasks/001a-panel-spec.md", design, "panel"),
        run_agent(".kimi/tasks/001b-knobs-spec.md", design, "knobs"),
        run_agent(".kimi/tasks/001c-rings-spec.md", design, "rings"),
        return_exceptions=True
    )
    return results
```

### Option 2: GNU Parallel (If installed)

```bash
# Run 3 tasks in parallel, 1 job at a time per CPU
parallel -j 3 ::: \
  "kimi task run .kimi/tasks/001a-panel-spec.md --var design_name=polar" \
  "kimi task run .kimi/tasks/001b-knobs-spec.md --var design_name=polar" \
  "kimi task run .kimi/tasks/001c-rings-spec.md --var design_name=polar"
```

### Option 3: npm concurrently (Node-based, works everywhere)

Add to `package.json`:

```json
{
  "scripts": {
    "swarm:specs": "concurrently -n panel,knobs,rings \"npm run spec:panel\" \"npm run spec:knobs\" \"npm run spec:rings\"",
    "spec:panel": "kimi task run .kimi/tasks/001a-panel-spec.md --var design_name=polar",
    "spec:knobs": "kimi task run .kimi/tasks/001b-knobs-spec.md --var design_name=polar",
    "spec:rings": "kimi task run .kimi/tasks/001c-rings-spec.md --var design_name=polar"
  },
  "devDependencies": {
    "concurrently": "^8.2.0"
  }
}
```

Then: `npm run swarm:specs`

### Option 4: GitHub Actions Matrix (True Cloud Parallelism)

For unlimited parallelism, offload to GitHub Actions:

`.github/workflows/chassis-swarm.yml`:

```yaml
name: Chassis Generation Swarm
on:
  workflow_dispatch:
    inputs:
      design_name:
        description: 'Design identifier'
        required: true
        default: 'polar'

jobs:
  # Parallel job 1
  spec-panel:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Generate Panel Spec
        run: |
          kimi task run .kimi/tasks/001a-panel-spec.md \
            --var design_name=${{ github.event.inputs.design_name }}
      - uses: actions/upload-artifact@v3
        with:
          name: panel-spec
          path: specs/${{ github.event.inputs.design_name }}/panel_spec.md

  # Parallel job 2
  spec-knobs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Generate Knobs Spec
        run: |
          kimi task run .kimi/tasks/001b-knobs-spec.md \
            --var design_name=${{ github.event.inputs.design_name }}
      - uses: actions/upload-artifact@v3
        with:
          name: knobs-spec
          path: specs/${{ github.event.inputs.design_name }}/knobs_spec.md

  # Parallel job 3
  spec-rings:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Generate Rings Spec
        run: |
          kimi task run .kimi/tasks/001c-rings-spec.md \
            --var design_name=${{ github.event.inputs.design_name }}
      - uses: actions/upload-artifact@v3
        with:
          name: rings-spec
          path: specs/${{ github.event.inputs.design_name }}/rings_spec.md

  # Sequential merge (depends on all parallel jobs)
  merge-and-continue:
    needs: [spec-panel, spec-knobs, spec-rings]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/download-artifact@v3
      - name: Merge specs
        run: |
          mkdir -p specs/${{ github.event.inputs.design_name }}
          mv panel-spec/* specs/${{ github.event.inputs.design_name }}/
          mv knobs-spec/* specs/${{ github.event.inputs.design_name }}/
          mv rings-spec/* specs/${{ github.event.inputs.design_name }}/
          kimi task run .kimi/tasks/001d-merge-specs.md \
            --var design_name=${{ github.event.inputs.design_name }}
```

Trigger from Codespaces:

```bash
gh workflow run chassis-swarm.yml -f design_name=cyberpunk
```

### Option 5: Simple Bash Background Jobs (Classic)

Works in any Codespace:

```bash
#!/bin/bash
# scripts/codespace-swarm.sh

DESIGN=$1
mkdir -p logs specs/$DESIGN

echo "🚀 Starting parallel agents..."

# Background with output redirection (no special OS calls)
kimi task run .kimi/tasks/001a-panel-spec.md --var design_name=$DESIGN > logs/panel.log 2>&1 &
P1=$!
kimi task run .kimi/tasks/001b-knobs-spec.md --var design_name=$DESIGN > logs/knobs.log 2>&1 &
P2=$!
kimi task run .kimi/tasks/001c-rings-spec.md --var design_name=$DESIGN > logs/rings.log 2>&1 &
P3=$!

echo "PIDs: Panel($P1) Knobs($P2) Rings($P3)"

# Wait for completion
wait $P1 && echo "✅ Panel done" || echo "❌ Panel failed"
wait $P2 && echo "✅ Knobs done" || echo "❌ Knobs failed"  
wait $P3 && echo "✅ Rings done" || echo "❌ Rings failed"

# Sequential merge
kimi task run .kimi/tasks/001d-merge-specs.md --var design_name=$DESIGN
```

### Recommendation for Codespaces

Use **Option 5 (Bash)** for local testing, **Option 4 (GitHub Actions)** for heavy generation:

```bash
# Local quick test (parallel in Codespace)
./scripts/codespace-swarm.sh polar

# Heavy production run (cloud parallel)
gh workflow run chassis-swarm.yml -f design_name=polar
```

The GitHub Actions matrix gives you 3 separate VMs running in parallel—true resource isolation without needing OS privileges.

---

## Self-Hosted / Local Development (With OS Privileges)

If running on your own Linux machine with proper privileges:

### Option 1: Niceness + Core Affinity

```bash
# High priority for current work, background for swarm
taskset -c 0-1 nice -n -5 kimi task run ... &  # Your current design (high priority)
taskset -c 2-3 nice -n 10 kimi task run ... &  # Background swarm (low priority)
```

### Option 2: CPU Limiting (Prevent Thermal Throttling)

```bash
# Limit each agent to 25% CPU (prevents fan noise/overheating)
cpulimit -l 25 -i kimi task run .kimi/tasks/001a-panel-spec.md ... &
cpulimit -l 25 -i kimi task run .kimi/tasks/001b-knobs-spec.md ... &
cpulimit -l 40 -i kimi task run .kimi/tasks/001c-rings-spec.md ... &
```

### Option 3: Docker/CGroups (Hard Isolation)

```bash
# Panel agent - 0.5 CPU, 512MB RAM
docker run -d --rm \
  --cpus="0.5" --memory="512m" \
  -v $(pwd):/workspace kimi-agent:latest \
  .kimi/tasks/001a-panel-spec.md --var design_name=$DESIGN
```

### Option 4: Systemd-Style cgroups

```bash
sudo mkdir -p /sys/fs/cgroup/kimi-swarm/panel
echo "50000" | sudo tee /sys/fs/cgroup/kimi-swarm/panel/cpu.max
systemd-run --scope --unit=kimi-panel -p CPUQuota=50% \
  kimi task run .kimi/tasks/001a-panel-spec.md ...
```

## Monitoring

```bash
# Watch all kimi processes
watch -n 1 'ps aux | grep kimi'

# Per-process CPU/memory
htop -p $(pgrep -d',' kimi)
```
