# Anderson Home v3.1.54

- Keep the smaller event-record layout from the local v3.1.53 test (848-byte reduction measured independently).
- Resolve solar times using the requested calendar date and its daylight-saving offset, fixing Home previews and overnight schedule lookups.
- Decode chunked OTA metadata and firmware responses while enforcing length, memory, idle and absolute time limits. Reject malformed and incomplete bodies before installation.
- Fail cleanly and retry if the OTA mutex, queue or worker cannot be created; do not leave firmware operations locked.
- Add host simulations for solar dates, HTTP framing and allocation failures to the required source checks.

Validation: event-data equivalence, source regressions, 2026–2037 event coverage, maintenance/recovery checks, host fault simulations, firmware compile and image verification. Hardware radio and lighting behavior requires the running NanoC6.
