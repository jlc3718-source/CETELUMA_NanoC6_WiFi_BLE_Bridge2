# Anderson Home 3.1.67

- Reworked the 30-day calendar endpoint so it no longer simulates the scheduler repeatedly across every night of the month.
- Calendar generation now walks enabled events directly for each date, including holiday lead/trail windows and custom schedules.
- Added a 10-second calendar request ceiling so the UI cannot remain stuck on “Loading calendar…” indefinitely.
- Added bounded stale-session retries and a visible retry error if the session keeps changing.
- Preserves the 3.1.66 auth/session protections, explicit OFF priority, scene power restoration, signed pre-UI OTA, and repeated-boot recovery.
