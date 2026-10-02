# Anderson Home 3.1.68

- Removed the 30-day calendar feature from Anderson Home.
- Removed the calendar UI/runtime script from the shipped web interface.
- Removed the `/api/night-calendar` firmware endpoint and its month-generation workload.
- Removed calendar-specific regression checks.
- Preserves normal schedule controls, Tonight's Scheduled Event, Next Change, event schedules, auth protections, OFF priority, scene power restoration, and signed OTA recovery/update behavior.
