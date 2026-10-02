# Anderson Home 3.1.69

- Removed the 30-day calendar feature, its UI runtime, and the `/api/night-calendar` endpoint.
- Preserves the normal Schedule card, Tonight's Scheduled Event, Next Change, event lists, and existing schedule controls.
- Added per-event schedule overrides for every built-in event.
- Each built-in event can use its original built-in date, one specific date, a date range, or an entire month.
- Date overrides can repeat every year or be limited to one selected year.
- Each event can optionally use its own start and end time while the controller schedule is active.
- Added separate **Restore Built-in Schedule** and **Restore All Defaults** actions.
- Schedule overrides are persisted with event overrides and included in the existing event backup/restore data.
- Preserves the existing auth/session protections, OFF priority, scene power restoration, signed pre-UI OTA checks, and repeated-boot recovery.
