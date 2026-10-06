# Oracle Browser Agent

Free self-hosted browser automation running on the existing Oracle ARM64 VM.

- Browser profiles/cookies live only on Oracle under `/home/ubuntu/browser-agent-data`.
- API binds to `127.0.0.1:8932`; it is not exposed to the public Internet.
- GitHub Actions on the existing self-hosted Oracle runner provide the command bridge.
- Public GitHub requests/results must remain sanitized: never put passwords, cookies, tokens, private page contents, or sensitive form values in job files/results.

Current tasks:
- `health`
- `jml_scan`
- `roborock_spin`
