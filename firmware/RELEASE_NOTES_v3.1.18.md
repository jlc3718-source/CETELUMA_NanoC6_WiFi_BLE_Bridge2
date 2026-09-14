# Anderson Home v3.1.18

- Restores Breath as a selectable manual, custom-light, and event-edit effect.
- Restores the software Breath renderer without reintroducing the removed 18 ms BLE write gap.
- Caps every automatically scheduled scene at Slow or Very Slow, including built-in event overrides and custom-scheduled lights.
- Existing pre-v3.1.18 Breath event overrides remain Jump until deliberately re-saved, preventing automatic Breath assignments.
- No built-in event or automatic combined-monthly scene is assigned Breath by default.
- Preset color slots keep their names after HEX/RGB calibration, so an overwritten Yellow still displays as Yellow rather than its HEX code.
