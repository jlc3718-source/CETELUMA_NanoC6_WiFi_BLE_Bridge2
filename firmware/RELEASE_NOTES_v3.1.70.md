# Anderson Home 3.1.70

- Fixed manual control blocking the automatic schedule indefinitely.
- Manual power, brightness, effect, color, and preview changes now expire at the next actual automatic schedule change.
- The scheduler continues checking every minute while a manual override is active, so dusk, Schedule 1/2 transitions, dawn, and other planned scene changes can reclaim control on time.
- If a manual override is started before controller time has synchronized, its expiration is armed as soon as valid local time becomes available.
- Resume Schedule still clears the override immediately.
- The Home schedule card now clearly shows when a manual override is active and the local time when automatic scheduling will resume.
- Added regression checks so future firmware cannot restore the old permanent manual-override gate.
