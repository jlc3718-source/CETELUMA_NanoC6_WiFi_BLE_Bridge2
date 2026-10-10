# RUN DAILY — REQUIRED MASTER SCOPE

This file is authoritative for the Run Daily project. A Run Daily execution is incomplete unless every REQUIRED section below is checked and reported as either a verified hit, a known/suppressed item, a timeout/blocked lane, or "nothing new verified".

## REQUIRED 1 — Giveaways / entries / promos
- Giveaways, sweepstakes, contests, daily/weekly/recurring entries, instant-win, surveys, alternate-entry methods
- Blind boxes, mystery boxes, discovery boxes
- Lucky draws, spin-to-win, wheels
- Beta, product tester, ambassador, explorer, sampling and free-product programs
- Free samples, free merchandise, free-with-purchase, launch/first-customer offers
- App-only, member-only, points/credits, email, QR, retailer, referral and community campaigns
- Social/community discovery: Instagram, Reddit, Facebook, TikTok, forums and brand communities
- Paid-social landing pages where discoverable
- Slickdeals Daily Draw
- Pet freebies and permanent free/near-free pet offers

## REQUIRED 2 — Deals / bargains / misprices
- Mispriced items and obvious pricing errors
- Unusually cheap tools/equipment
- Clearance, coupon-stack, flash-sale and extreme-discount opportunities
- Used, refurb, renewed, open-box and warehouse bargains
- Marketplace and manufacturer-refurb listings
- F3800 / F3800 Plus / BP3800 / accessories used-refurb-open-box pricing
- GM MDI 2 bargains
- Smart-home / tech bargains
- Electrician / tool bargains
- Robot-vacuum and floor-care bargains
- Light-curtain / smart-lighting bargains

## REQUIRED 3 — Standing brands / targets
- Anker / SOLIX / eufy / soundcore
- Govee, especially Curtain Light / Curtain Light Pro / high-density animated curtains
- Reolink / Wyze / security-camera gear
- Roborock / Dreame / MOVA / robotic vacuums / cordless steam floor cleaners
- BLUETTI / Jackery / portable power / solar
- RIDGID / Greenlee / Klein / CRAFTSMAN / RYOBI / electrician and tool brands
- Lenovo
- Shark / Ninja / SharkNinja tester programs
- On tester programs
- CETELUMA
- GM MDI 2
- SOOCAS replacement heads
- Pet-product freebies/deals

## REQUIRED 4 — Product / release watches
- Roborock F25 Ultra Steam Gen 2: report only a newly verified meaningful U.S. discount, coupon, misprice, clearance, used, refurb or open-box bargain. Availability by itself is no longer an alert trigger.
- Relevant new robotic / steam floor-cleaning launches
- Relevant Govee/light-curtain releases
- Relevant Anker/SOLIX/eufy launches/promos
- Silverado EV notices relevant to the standing watch

## REQUIRED 5 — Social / community expansion
Every run must search outside named brands too for:
- electrician/tools
- portable power/solar
- robot vacuums/floor care
- smart-home
- lighting
- unusually good deals, misprices, beta/tester opportunities and launches
Reddit findings must be verified against an official/current source where possible.

## REQUIRED 6 — Entry follow-up / unresolved
Retain IDs/statuses for all selected programs and unresolved opportunities.
Attempt eligible automated paths using Oracle Browser Agent and persistent profile 'daily'.
Never claim success without positive confirmation.
If no automated entry path exists, reduce it to the minimum manual action required.

## Permanent execution rules
- Run independent lanes in parallel.
- Skip a site/lane that stalls for about 60 seconds and continue.
- Treat each Run Daily as a fresh consolidated sweep.
- New York is the default residence. Use Pennsylvania only when official rules or the live form explicitly exclude NY and accept PA; use only the user's provided PA details.
- Do not publish private address/profile data into the public GitHub repo.
- No TinyFish.
- No YepCode.
- No Gleam.
- Suppress completed/expired/ineligible/already-entered items unless a genuinely new round appears.
- Tineco Fall Spin is DONE; suppress unless there is a new round.
- F25 Ultra Steam Gen 2: only surface newly verified meaningful discounts or bargains; suppress availability-only updates.
- Preserve existing purchased/DONE exclusions and other standing suppression rules.

## Durable Oracle execution and evidence
- Use the versioned runtime in oracle-daily/ and the bounded client oracle-daily/run-agent.py. Deploy through Oracle Daily Reliability; tests must pass before deployment. The agent runtime is mounted from persistent Oracle storage, and failed upgrades roll back.
- Submit asynchronous jobs with unique IDs and retrieve GET /jobs/:id. If a response times out, retrieve the existing job before retrying any action. GET /login/status exposes the current protected handoff URL without waiting behind browser work.
- Use scoped entry forms, fill primary and confirmation email fields, and ignore unrelated search/newsletter controls. Leave unknown screener answers for the user. Visible human verification and rules prohibiting automation require manual action.
- Never report entry confirmation from HTTP 200, page loading, form preparation or a generic pre-existing thank-you. Retain confirmation evidence and New York local-day/month duplicate limits.
- Wheel actions require a verified positive free balance; unresolved counters and paid points remain blocked. Timeouts cancel owned browser pages and requests without closing the user's manual tabs.
- Publish scrubbed complete result metadata: Instagram handle/post coverage, captions, hits, numeric study IDs, campaign identifiers and verification errors. Report partial coverage explicitly. Preserve campaign history when updating last-run state.
- Check current connector availability on each run. For Gmail, test the connected profile and then perform the requested searches; do not carry an old tool-unavailable diagnosis forward. Empty searches and connector failures are different outcomes.
- Recall checks use the official NHTSA API. Make/model/year results do not establish VIN-specific recall applicability or an all-clear.
- Schedules remain in their existing enabled/paused state unless the user requests a scheduling change.

## REQUIRED REPORT CONTRACT
Every Run Daily report must visibly cover:
1. New actionable entries/promos
2. Confirmed automated entries
3. Manual-action items
4. Misprices / unusually cheap tools & equipment
5. Used/refurb/open-box/warehouse deals
6. Portable power / solar bargains
7. Robot-vac / steam-floor-care bargains & release watch
8. Govee / lighting bargains & releases
9. Tool/electrician bargains and promos
10. Smart-home/security bargains
11. Tester/beta programs
12. Reddit/social/community finds
13. Standing product watches
14. Timeouts/blocked lanes
15. "Nothing new verified" for any required category with no hit

A report that omits any required category is incomplete.
