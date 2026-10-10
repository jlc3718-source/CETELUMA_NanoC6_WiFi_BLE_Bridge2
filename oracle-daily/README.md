# Reliable Oracle daily execution

The daily agent uses persistent Oracle-host runtime files mounted read-only into the browser container. The code and workflows in this directory are the maintained source; avoid copying one-off patches into the container.

## Deploy and recover

Run the **Oracle Daily Reliability** workflow. It runs pure regression checks and real Chromium fixtures on the self-hosted Oracle runner, then deploys only after those checks pass. Deployment preserves the existing private environment, profile vault, data mount and secret mount; it retains a stopped backup container and a private rollback directory. Failed upgrades restore the previous container.

The workflow calls `sudo python3 oracle-daily/deploy-agent.py <current-container-id> oracle-daily`. The persistent data directory contains `daily-runtime-v2/server.js`, `fast-daily.js`, `module/` and a private `container-create.json` recovery configuration. Never upload that configuration or the original server source; they may contain private environment or profile data. A replacement container must retain these three runtime bind mounts. An unrelated old Compose definition can overwrite those settings; use the maintained deployment workflow for upgrades.

## Routine workflows

- Oracle Daily Fast uses `run-agent.py daily`.
- Oracle Daily Follow-up uses `run-agent.py followup`.
- Oracle Manual Handoff uses `run-agent.py handoff`.
- Oracle Daily Read-only Verification uses `run-agent.py smoke`, which diagnoses wheels without spinning.
- Walmart login/cart workflows are explicit dispatches with current parameters; they never replay old dated product links.
- All these workflows share one concurrency group to avoid browser profile conflicts. Individual daily lanes run concurrently inside the agent.

Schedules retain their existing enabled/paused state.

## Durable API

POST `/run` with an ID, task and `async: true`; retrieve GET `/jobs/<id>` until completed. Reusing a completed ID returns its stored response instead of executing again. If transport times out, retrieve the original job before trying an action again. GET `/login/status` returns the current protected handoff URL without waiting for browser work. Job records survive agent restart and interrupted jobs are marked explicitly.

Entry attempts are scoped to the selected form and use New York local-day/month duplicate keys. A submitted but unconfirmed entry is held for review to avoid duplicate submissions. Confirmation requires a newly visible entry-specific message. A hidden CAPTCHA badge alone is not a visible human challenge; visible challenges remain manual.

Known contact details fill both email fields, state and address where present. Search/newsletter controls are excluded. Late embedded forms have a bounded loading wait. Unknown required screener answers remain blank. Off-site redirects require an explicitly verified allowed host before contact data is filled.

Manual handoffs open tabs concurrently, retain filled pages between routine jobs and expose status while navigation is running. A process restart creates a new protected tunnel, so retrieve the current status instead of relying on an old URL. Keep private answers in Oracle; never publish entry values or secrets.

Wheel actions require verified positive free balances. Bounded timeouts close the lane's own pages and abort requests while preserving manual tabs. Instagram results retain captions, hits and actual per-handle/post coverage; unavailable or partial scans are reported explicitly.

Recall checks use the official NHTSA API. Make/model/year results do not establish VIN-specific applicability.

## Verification

Regression output: `.github/oracle-daily-v2-tests.txt`.
Deployment proof: `.github/oracle-daily-v2-deploy.json`.
Live results: `.github/oracle-*-result.json`.
Use timestamps and `agent_version`; old result files are not evidence of current execution.
