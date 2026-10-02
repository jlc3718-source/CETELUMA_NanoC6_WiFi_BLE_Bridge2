# Anderson Home 3.1.68

- Removed the 30-day calendar feature from Anderson Home.
- Removed the calendar UI/runtime script from the shipped web interface.
- Removed the `/api/night-calendar` firmware endpoint and its month-generation workload.
- Removed calendar-specific regression checks.
- Preserves normal schedule controls, Tonight's Scheduled Event, Next Change, event schedules, auth protections, OFF priority, scene power restoration, and signed OTA recovery/update behavior.

- Added per-event schedule overrides for every built-in event.
- Each event can use its built-in date, one specific date, a date range, or an entire month.
- Event date overrides can repeat every year or be limited to one selected year.
- Each event can optionally use its own start/end time while the controller schedule is active.
- Added separate “Restore Built-in Schedule” and “Restore All Defaults” actions.
- Schedule overrides are stored with event overrides and included in the existing event backup/restore data.
