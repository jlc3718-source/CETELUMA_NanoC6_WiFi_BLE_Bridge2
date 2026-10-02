# Anderson Home 3.1.66

- Recover the 30-day calendar automatically when an authenticated request becomes stale during profile/session handoff instead of leaving the month header with an empty date grid.
- Show a visible calendar loading state while the authenticated month request is being resolved.
- Treat a manual scene/effect/color selection as an intent to turn the lights back on when the request does not explicitly carry a power state, while preserving explicit OFF commands and queued-OFF priority.
- Keep the 3.1.65 pre-UI signed boot updater, repeated-short-boot recovery, stale-session protections, and deferred reboot-cause investigation unchanged.
