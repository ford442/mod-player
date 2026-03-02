# Resource Management for Parallel Agent Execution

This document describes OS-level resource controls for running heavy parallel shader generation without system lag.

## Quick Reference

### Option 1: Niceness + Core Affinity (Recommended)

Lightweight and prevents IDE lag while agents run:

```bash
# High priority for current work, background for swarm
taskset -c 0-1 nice -n -5 kimi task run ... &  # Your current design (high priority)
taskset -c 2-3 nice -n 10 kimi task run ... &  # Background swarm (low priority)
```

### Option 2: CPU Limiting (Prevent Thermal Throttling)

Use `cpulimit` to cap CPU usage per agent (good for laptops):

```bash
# Limit each agent to 25% CPU (prevents fan noise/overheating)
cpulimit -l 25 -i kimi task run .kimi/tasks/001a-panel-spec.md ... &
cpulimit -l 25 -i kimi task run .kimi/tasks/001b-knobs-spec.md ... &
cpulimit -l 40 -i kimi task run .kimi/tasks/001c-rings-spec.md ... &  # Rings get more
```

### Option 3: Docker/CGroups (Hard Isolation)

Create `.kimi/Dockerfile.agent`:

```dockerfile
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y kimi-cli
WORKDIR /workspace
COPY . .
ENTRYPOINT ["kimi", "task", "run"]
```

Run parallel containers with resource constraints:

```bash
#!/bin/bash
# scripts/docker-swarm.sh

DESIGN=$1

# Panel agent - 0.5 CPU, 512MB RAM, low priority
docker run -d --rm \
  --name "${DESIGN}-panel" \
  --cpus="0.5" \
  --memory="512m" \
  --cpu-shares=512 \
  -v $(pwd):/workspace \
  kimi-agent:latest \
  .kimi/tasks/001a-panel-spec.md --var design_name=$DESIGN

# Knobs agent - 0.5 CPU, 512MB RAM  
docker run -d --rm \
  --name "${DESIGN}-knobs" \
  --cpus="0.5" \
  --memory="512m" \
  --cpu-shares=512 \
  -v $(pwd):/workspace \
  kimi-agent:latest \
  .kimi/tasks/001b-knobs-spec.md --var design_name=$DESIGN

# Rings agent - 1.0 CPU, 1GB RAM (heaviest computation)
docker run -d --rm \
  --name "${DESIGN}-rings" \
  --cpus="1.0" \
  --memory="1g" \
  --cpu-shares=1024 \
  -v $(pwd):/workspace \
  kimi-agent:latest \
  .kimi/tasks/001c-rings-spec.md --var design_name=$DESIGN

# Wait for completion
docker wait ${DESIGN}-panel ${DESIGN}-knobs ${DESIGN}-rings
```

### Option 4: Systemd-Style (Linux Advanced)

For persistent resource control, use systemd slices:

```bash
# scripts/setup-cgroups.sh
sudo mkdir -p /sys/fs/cgroup/kimi-swarm/

# Create sub-groups for each component
sudo mkdir -p /sys/fs/cgroup/kimi-swarm/panel
sudo mkdir -p /sys/fs/cgroup/kimi-swarm/knobs  
sudo mkdir -p /sys/fs/cgroup/kimi-swarm/rings

# Set limits (CPU quota: 50%, Memory: 1GB each)
echo "50000" | sudo tee /sys/fs/cgroup/kimi-swarm/panel/cpu.max  # 50ms per 100ms
echo "1000000" | sudo tee /sys/fs/cgroup/kimi-swarm/panel/memory.max  # 1MB

# Run agents in cgroups
systemd-run --scope --property=Delegate=cpu,memory \
  --unit=kimi-panel -p CPUQuota=50% \
  kimi task run .kimi/tasks/001a-panel-spec.md ...
```

## Enhanced Python Orchestrator

Update `scripts/swarm_dag.py` with resource controls:

```python
import psutil
import os

async def run_task(task_id: str, design_name: str, vars: dict, cpu_cores: list = None, nice: int = 0):
    """Execute task with resource constraints"""
    task = TASKS[task_id]
    cmd = ["kimi", "task", "run", task.file, "--var", f"design_name={design_name}"]
    
    # Apply nice level (Unix only)
    if nice != 0:
        cmd = ["nice", "-n", str(nice)] + cmd
    
    # Apply core affinity if specified
    if cpu_cores:
        cmd = ["taskset", "-c", ",".join(map(str, cpu_cores))] + cmd
    
    proc = await asyncio.create_subprocess_exec(*cmd)
    
    # Additional runtime limits via psutil
    if cpu_cores and proc.pid:
        p = psutil.Process(proc.pid)
        p.cpu_affinity(cpu_cores)  # Lock to specific cores
        p.nice(nice)  # Adjust priority
    
    await proc.communicate()
    return proc.returncode == 0

# Usage in parallel phase:
await asyncio.gather(
    run_task("001a", design_name, vars, cpu_cores=[0,1], nice=5),   # Panel: fast, high priority
    run_task("001b", design_name, vars, cpu_cores=[2], nice=10),   # Knobs: single core
    run_task("001c", design_name, vars, cpu_cores=[3], nice=15),   # Rings: heavy, isolated
)
```

## Recommended Setup

Since you're generating WebGPU shaders (text generation, not heavy GPU training), use **Option 1 (nice + taskset)** - it's lightweight and prevents your IDE from lagging while agents run.

### Example: Resource-Managed Swarm Script

```bash
#!/bin/bash
# scripts/kimi-swarm-orchestrator-managed.sh

set -e
DESIGN_NAME=$1
shift

mkdir -p specs/$DESIGN_NAME logs/$DESIGN_NAME

VAR_FLAGS=""
for var in "$@"; do
    VAR_FLAGS="$VAR_FLAGS --var $var"
done

# ==========================================
# RESOURCE MANAGEMENT CONFIG
# ==========================================
NICE_LEVEL=10  # Lower priority (0 is normal, 19 is lowest)
CPU_CORES=4    # Number of cores to use (0-3)

echo "📋 Phase 1: Parallel specs (nice $NICE_LEVEL, cores 0-$((CPU_CORES-1)))..."

# Panel spec - High priority, cores 0-1
taskset -c 0-1 nice -n 5 kimi task run .kimi/tasks/001a-panel-spec.md \
  --var design_name=$DESIGN_NAME $VAR_FLAGS > logs/$DESIGN_NAME/panel.log 2>&1 &
PID_PANEL=$!

# Knobs spec - Medium priority, core 2  
taskset -c 2 nice -n 10 kimi task run .kimi/tasks/001b-knobs-spec.md \
  --var design_name=$DESIGN_NAME $VAR_FLAGS > logs/$DESIGN_NAME/knobs.log 2>&1 &
PID_KNOBS=$!

# Rings spec - Low priority, core 3 (heaviest task)
taskset -c 3 nice -n 15 kimi task run .kimi/tasks/001c-rings-spec.md \
  --var design_name=$DESIGN_NAME $VAR_FLAGS > logs/$DESIGN_NAME/rings.log 2>&1 &
PID_RINGS=$!

echo "  └─ Panel (PID: $PID_PANEL, cores 0-1, nice 5)"
echo "  └─ Knobs (PID: $PID_KNOBS, core 2, nice 10)"  
echo "  └─ Rings (PID: $PID_RINGS, core 3, nice 15)"

# Wait for completion...
wait $PID_PANEL && wait $PID_KNOBS && wait $PID_RINGS

# Continue with sequential phases...
```

## GPU Isolation (Optional)

If agents are testing/compiling shaders and you want to reserve your main GPU for preview while agents use integrated graphics:

```bash
# Force agent to use integrated GPU (Intel/AMD iGPU)
export DRI_PRIME=0
kimi task run .kimi/tasks/001a-panel-spec.md ...

# Or use NVIDIA's prime-select
__NV_PRIME_RENDER_OFFLOAD=0 __GLX_VENDOR_LIBRARY_NAME=mesa kimi task run ...
```

## Monitoring

Monitor resource usage during swarm execution:

```bash
# Watch all kimi processes
watch -n 1 'ps aux | grep kimi'

# Per-process CPU/memory
htop -p $(pgrep -d',' kimi)

# Cgroup stats (if using cgroups)
cat /sys/fs/cgroup/kimi-swarm/panel/cpu.stat
```
