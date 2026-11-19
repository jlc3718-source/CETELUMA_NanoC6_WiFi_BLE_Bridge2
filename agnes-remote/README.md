# SD300 remote video production — managed via GitHub

All prompts, approved scene names, video settings and runner source are in this folder. Editing `scene-manifest.json` or `runner-v2.py` on the main branch triggers `Agnes remote deployment` on the existing Oracle GitHub Actions runner. No phone, Chrome or Oracle Cloud Shell needed after this setup.

* Nine 12-second scenes, vertical 9:16, Agnes Video 2.5 Flash 720P.
* Product scenes use a verified official SD300 photo URL from Airthereal's public Shopify media; never replace them with a text-only appliance hallucination.
* One-second retry between passes, preserving true HTTP status (200 accepted, 503 video queue full, 429 throttled).
* Downloads are **not approvals**. Rejected results are moved into dated private backup folders.
* Every successful download is **unapproved** by default. The 5-minute scheduled `Agnes QC Export` workflow packages each newly downloaded unapproved MP4 and 4-frame sheet only once per unique SHA-256. An enabled hourly ChatGPT condition-watch then reviews all new clips with vision before making any decision. This is not instantaneous, and automatic visual judgments are best-effort.
* Approve/reject a scene via `.github/workflows/agnes-review.yml` (`scene`, `decision`, `reason`). Rejection backs up the exact MP4 privately, clears only that scene's job ID, and lets the existing service resubmit it, with at most five rejected attempts. Approval stores a SHA-256 in the state.
* `agnes-combine.yml` refuses to assemble any clip without `approved=true`, `review_status=approved` and a matching `approved_sha256`. Physical checks still require actual video inspection; status 200 or a downloaded file is never considered visual approval.
* Changes to one scene prompt reset only that scene; model/format changes reset all.
* Run the `Agnes remote deployment` GitHub Actions workflow to redeploy without changing prompts.
* Status: `agnes-remote/status.json` and the live Oracle `/agnes-health.json` feed.
* User's original 79-second SD300 hybrid footage and all Oracle source files are retained; only the video generation runner is changed.
