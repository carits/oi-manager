---
status: current
audience: operations
last_verified: 2026-08-19
source_of_truth: deploy/systemd/*.service and scripts/install-systemd-services.sh
---

# Systemd recovery deployment

The server uses three independent systemd services for the application processes:

- `oi-manager-server.service` runs the existing production API artifact on port `3002`.
- `oi-manager-judge.service` runs the existing judge client artifact and reconnects to the API.
- `oi-manager-web.service` serves the published `.next-current` preview artifact on port `3000`.

PostgreSQL and go-judge remain managed by Docker Compose. PM2/Nix is not a runtime dependency.
Each application service runs as `ecs-user`, writes logs to journald, restarts after failure, and has a memory ceiling appropriate for the 3.7 GiB host.

## Install or repair after a reboot

Run on the host after confirming that the published artifacts exist:

```bash
cd /data/oi-manager-response-refactor
sudo bash scripts/install-systemd-services.sh
```

The installer copies the tracked unit files, reloads systemd, enables all three services, and restarts them in dependency order. It does not run a build or alter the database.

Once the services are healthy, retire the obsolete Nix-backed PM2 unit so it cannot produce a misleading boot failure:

```bash
sudo systemctl disable --now pm2-root.service || true
```

## Verification

```bash
systemctl --no-pager --full status oi-manager-server oi-manager-judge oi-manager-web
ss -ltnp | grep -E ':3000|:3002'
curl -fsS http://127.0.0.1:3002/api/health
curl -I http://127.0.0.1:3000/login
curl -fsS http://127.0.0.1:5050/version
docker inspect -f '{{.Name}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' oi-postgres oi-judge
```

For failure evidence use `journalctl -u <unit> -b`, `journalctl -k -b`, and `journalctl -b -1`. Do not include environment files, tokens, cookies, or source code in incident reports.

## Rollback

Stop only the affected service, restore the previously published artifact or unit file, run `systemctl daemon-reload`, then restart the service and repeat the verification commands. Do not use `docker compose down -v`, because that removes database volumes.
