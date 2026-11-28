# Wiring

## Power
- ESP32 powered via USB (or 5 V pin from a clean source).
- Servos + LED powered from a separate 5 V / 2–3 A supply.
- Common ground between ESP32 and 5 V supply.

## Servos
- Pan servo → ESP32 GPIO 18
- Tilt servo → ESP32 GPIO 19
- Servo power → 5 V rail
- Servo ground → common ground

## LED (MOSFET PWM)
- Red   → MOSFET gate driven by GPIO 25
- Green → MOSFET gate driven by GPIO 26
- Blue  → MOSFET gate driven by GPIO 27
- MOSFET source → ground
- MOSFET drain → LED cathode (per color)
- LED anodes → 5 V (or current-limited)

Add 10 kΩ pull-down resistors from each gate to ground.

## Pin Summary
| Function | GPIO |
|----------|------|
| Pan      | 18   |
| Tilt     | 19   |
| Red      | 25   |
| Green    | 26   |
| Blue     | 27   |
