---
status: current
audience: operations
last_verified: 2026-08-29
source_of_truth: production host read-only audit and Aliyun console login state
---

# Remaining external dependencies

All repository-only and isolated-runtime work has been separated from the
items below. These items must not be marked complete from unit tests or local
loopback simulations: each requires an external account, destination, domain
or explicit destructive authorization.

## Aliyun instance and alert audit

Known host-side evidence:

- ECS instance: `i-bp1exf7fip8n8i3e03jv`, region `cn-hangzhou`.
- CloudMonitor 4.0 Agent, Aliyun Assist and Aegis are active after the controlled
  reboot.
- CloudMonitor is uploading host metrics without agent errors, but the returned
  collection configuration contains no process, HTTP, TCP or ping monitors.
- The host has no cloud API credentials or RAM role that can query ActionTrail,
  ECS instance events, alarm contacts or security-group rules.
- The ECS metadata endpoint was rechecked on 2026-08-29: instance and region
  metadata resolve normally, while `ram/security-credentials/` still returns
  `404`, confirming that no RAM role is attached.
- The Codex in-app browser and the user's available Edge extension session both
  redirect the Aliyun console to the official login page. The Edge login tab is
  retained for owner handoff; no password, cookie or browser storage was read.

Required next action: the owner signs in to the retained Aliyun console tab and
then tells Codex that the session is ready.
The read-only audit will then inspect the 2026-08-19 instance event timeline,
ActionTrail, CloudMonitor contacts/thresholds/reboot notifications and the
security group. No cloud setting will be changed without separate approval.

## External alert delivery

The repository alert adapter, retry behavior and failed/recovered loopback
contract are verified. Production has no real Webhook/SMTP recipient configured,
so delivery to a person or external incident system is not proven.

Required input: one real alert destination, preferably an HTTPS Webhook URL
stored in a mode-600 file, plus permission to send one synthetic failure and
one recovery notification. An email destination also requires SMTP host,
port, sender and credentials.

## Off-host log retention

Local collection, manifests, SHA-256 checks, spool retention and trusted upload
command execution are verified. The production host has no SLS/file-store
configuration, no object-storage credentials and no second-host target. Local
spool is not off-host disaster recovery.

Required input: either an OSS/S3-compatible bucket and scoped credentials, or
an SSH destination and host key. The owner must also choose the retention
period. After configuration, one archive will be uploaded, downloaded and
checksum-verified before cleanup is enabled.

## TLS and strict browser security

Production read-only checks on 2026-08-28 found:

- Nginx listens on port 80 with `server_name _` and proxies Web/API traffic.
- `http://47.99.222.76/` responds, while port 443 refuses connections.
- No active Certbot/Caddy service or `/etc/letsencrypt` certificate exists.
- Application CORS is intentionally fixed to `http://47.99.222.76`.
- Port 3000 remains public for compatibility with the current documented URL.

Required input: a domain whose DNS A/AAAA record is controlled by the owner and
points to this ECS, plus permission to issue/install a certificate. The final
change will add HTTPS, HTTP redirect, Secure Cookie, HSTS and strict CSP, update
CORS and application URLs, then verify browser flows and security headers.

Repository readiness completed on 2026-08-29: a guarded certificate/domain/key
renderer, isolated Nginx syntax verifier, nonce-based report-only/enforce CSP,
and response nonce checker are available and pass. No production Nginx or
cookie setting was changed without the missing domain and certificate.

## Production database overwrite exercise

The guarded restore command and its isolated destructive verifier are deployed.
It validates the archive in a candidate database, stops writes, creates an
immutable pre-restore dump and rolls back automatically on database failure.
The production database has not been overwritten merely to prove tooling.

Required input: the exact backup path and SHA-256 selected by the owner, an
approved maintenance window and an explicit statement authorizing replacement
of database `oi_manager`. See `DISASTER_DATABASE_RESTORE.md`.

## Completion rule

Each section is complete only after the real external action has been executed
and its receipt, cloud-console evidence, downloaded archive checksum, HTTPS
browser result or restore audit log has been recorded. Missing authority is not
substituted with a narrower simulation.
