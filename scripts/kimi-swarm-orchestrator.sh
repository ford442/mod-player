#!/bin/bash
set -e

DESIGN_NAME=$1
shift  # Remove first arg, rest are optional variable overrides

if [ -z "$DESIGN_NAME" ]; then
    echo "Usage: ./scripts/kimi-swarm-orchestrator.sh <design-name> [var=value ...]"
    echo "Example: ./scripts/kimi-swarm-orchestrator.sh polar accent_color=gold"
    exit 1
fi

echo "🚀 Starting Parallel Swarm for: $DESIGN_NAME"
mkdir -p specs/$DESIGN_NAME

# Build variable flags from remaining args
VAR_FLAGS=""
for var in "$@"; do
    VAR_FLAGS="$VAR_FLAGS --var $var"
done

# ==========================================
# PHASE 1: PARALLEL SPEC GENERATION (Swarm)
# ==========================================
echo "📋 Phase 1: Generating component specs in parallel..."

# Launch all three in background (true parallel execution)
kimi task run .kimi/tasks/001a-panel-spec.md --var design_name=$DESIGN_NAME $VAR_FLAGS &
PID_PANEL=$!

kimi task run .kimi/tasks/001b-knobs-spec.md --var design_name=$DESIGN_NAME $VAR_FLAGS &
PID_KNOBS=$!

kimi task run .kimi/tasks/001c-rings-spec.md --var design_name=$DESIGN_NAME $VAR_FLAGS &
PID_RINGS=$!

echo "  └─ Panel spec (PID: $PID_PANEL)"
echo "  └─ Knobs spec (PID: $PID_KNOBS)"  
echo "  └─ Rings spec (PID: $PID_RINGS)"

# Wait for all parallel tasks to complete
wait $PID_PANEL
STATUS_PANEL=$?
wait $PID_KNOBS
STATUS_KNOBS=$?
wait $PID_RINGS
STATUS_RINGS=$?

# Check if any failed
if [ $STATUS_PANEL -ne 0 ] || [ $STATUS_KNOBS -ne 0 ] || [ $STATUS_RINGS -ne 0 ]; then
    echo "❌ Parallel spec generation failed!"
    echo "   Panel: $STATUS_PANEL, Knobs: $STATUS_KNOBS, Rings: $STATUS_RINGS"
    exit 1
fi

echo "✅ All component specs completed"

# ==========================================
# PHASE 2: SEQUENTIAL MERGE & PIPELINE
# ==========================================
echo "🔗 Phase 2: Merging specifications..."
kimi task run .kimi/tasks/001d-merge-specs.md --var design_name=$DESIGN_NAME

echo "🎨 Phase 3: Generating static shader..."
kimi task run .kimi/tasks/002-shader-gen.md --var design_name=$DESIGN_NAME

echo "🎵 Phase 4: Adding audio reactivity..."
kimi task run .kimi/tasks/003-audio-reactive.md --var design_name=$DESIGN_NAME

echo "🔌 Phase 5: Frontend integration..."
kimi task run .kimi/tasks/004-frontend-integrate.md --var design_name=$DESIGN_NAME

echo "✅ Pipeline complete! Check src/shaders/${DESIGN_NAME}_chassis.wgsl"
