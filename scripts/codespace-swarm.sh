#!/bin/bash
# Simple parallel swarm for Codespaces (no special OS privileges needed)

DESIGN=$1

if [ -z "$DESIGN" ]; then
    echo "Usage: ./scripts/codespace-swarm.sh <design-name>"
    echo "Example: ./scripts/codespace-swarm.sh polar"
    exit 1
fi

mkdir -p logs specs/$DESIGN

echo "🚀 Starting parallel agents for: $DESIGN"

# Background with output redirection (works in any Codespace)
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
echo "🔗 Merging specifications..."
kimi task run .kimi/tasks/001d-merge-specs.md --var design_name=$DESIGN

echo "✅ Phase 1 complete!"
