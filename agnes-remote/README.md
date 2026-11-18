# SD300 remote video production — managed via GitHub

All prompts, approved scene names, video settings and runner source are in this folder. Editing `scene-manifest.json` or `runner-v2.py` on the main branch triggers `Agnes remote deployment` on the existing Oracle GitHub Actions runner. No phone, Chrome or Oracle Cloud Shell needed after this setup.

* Seven 12-second scenes, vertical 9:16, Agnes Video 2.5 Flash 720P.
* Product scenes use a verified official SD300 photo URL from Airthereal's public Shopify media; never replace them with a text-only appliance hallucination.
* One-second retry between passes, preserving true HTTP status (200 accepted, 503 video queue full, 429 throttled).
* Downloads are **not approvals**. Rejected results are moved into dated private backup folders.
* To reject one scene, change `agnes-remote/control.json` with `command: regenerate`, `scene: 06_night`, and increment `sequence`. Existing Oracle poller handles the reset; GitHub sync updates dashboard.
* Changes to one scene prompt reset only that scene; model/format changes reset all.
* Run the `Agnes remote deployment` GitHub Actions workflow to redeploy without changing prompts.
* Status: `agnes-remote/status.json` and the live Oracle `/agnes-health.json` feed.
* User's original 79-second SD300 hybrid footage and all Oracle source files are retained; only the video generation runner is changed.
