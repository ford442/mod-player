# DIY LED Moving Head (Low Budget)

A simple pan/tilt RGB LED moving head designed to be driven from the browser (including the mod-player app).

## Goals
- Cheap (~$30–50)
- Easy to build with basic soldering
- Controllable from the web (WebSocket)
- Safe power separation (logic vs. servo/LED)

## Architecture
- **ESP32** – Wi-Fi + WebSocket server
- **2× SG90/MG90S servos** – pan + tilt
- **RGB LED** (3–10 W) on a small heatsink
- **Logic-level MOSFETs** for LED PWM
- Separate 5 V supply for servos and LED

## Quick Start
1. See [parts.md](parts.md) for the shopping list.
2. Follow [wiring.md](wiring.md).
3. Flash `firmware/esp32_websocket.ino`.
4. Open the companion page in the mod-player app and connect.

## Browser Control Protocol
WebSocket messages (JSON):

```json
{"pan": 90, "tilt": 45, "r": 255, "g": 128, "b": 0, "intensity": 200}
```

- `pan` / `tilt`: 0–180
- `r`/`g`/`b`/`intensity`: 0–255

## Integration with mod-player
The companion page lives alongside the main player UI (accessible via the "Moving Head" button). It can send the same WebSocket messages in real time while a module plays.

## Safety
- Keep 5 V servo/LED supply separate from the ESP32 3.3 V rail.
- Use a fuse on the 5 V line.
- Heatsink the LED.
- Do not run servos stalled for long periods.
