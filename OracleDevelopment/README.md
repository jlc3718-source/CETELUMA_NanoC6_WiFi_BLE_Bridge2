# Oracle Home Development

One-time installation completed on Oracle. The installation workflow trigger has been removed after verified installation and live automatic rollback tests.

MCP endpoint: https://oracle-home-dev.150.136.245.51.sslip.io/mcp

Use the authenticated Oracle Home Development MCP connection for routine application work after ChatGPT authorization is completed. Current server installation alone does not prove that ChatGPT or a fresh conversation has authorized tool access.

Read current production files, stage only the user-authorized edits with exact base hashes, validate, deploy minimum affected files, verify live HTTP/health and automatically roll back failure. Preserve databases, credentials, schedules and unrelated applications. Do not use routine GitHub deployment workflows.

GitHub remains available for firmware compilation, necessary Android builds/signing, deliberate versioned backups/releases, and changes that cannot safely be made directly. No TinyFish or YepCode.

The service exposes fixed scoped tools rather than a shell. Credentials stay server-side. OAuth authorization uses PKCE and rotating tokens. The original Jason Home application is excluded. Anderson writes remain disabled until a distinct editable Oracle service is verified.

Source is installed under /opt/oracle-home-development; durable stages, release backups and journals are under /var/lib/oracle-home-development. Systemd unit: oracle-home-development.service. TLS renewal: oracle-home-development-tls.timer.

A root administrator can inspect/restart these existing units through the server's approved administration channel. Do not expose administration shell or secrets over HTTP. Do not reuse the deleted bootstrap trigger for ordinary application releases.
