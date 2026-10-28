# Operations: logs, alerts and health checks (cloud edition)

The cloud server runs as one Docker container on the Contabo VPS (`Dockerfile`, entry `apps/server/src/cloud.ts`, bundled by `apps/server/scripts/build.mjs` to `apps/server/dist/cloud.js`). It needs no external log or monitoring service: it writes structured logs to stdout, mails its own alerts, and answers two health endpoints an uptime monitor can poll.

## Logs

Every line on stdout is one JSON object (pino). The fields that are always there:

| Field | Meaning |
| --- | --- |
| `ts` | ISO-8601 UTC time |
| `level` | `debug`, `info`, `warn`, `error` or `fatal` |
| `service`, `version`, `env` | from `MEZAN_SERVICE_NAME` (default `mezan`), `MEZAN_VERSION` (default `dev`), `MEZAN_ENV` / `NODE_ENV` |
| `component` | which part wrote it: `http`, `cloud`, `api`, `jobs`, `alerts`, `backup`, `billing`, `eta`, … |
| `event` | what happened, when it is a named event: `http.request.completed`, `http.request.failed`, `http.unhandled_error`, `job.succeeded`, `job.failed`, `client_error.reported`, `alert.sent`, `process.unclean_restart`, … |
| `requestId`, `tenantId`, `userId`, `route` | on every line written while a request runs, once known |
| `status`, `durationMs` | on request and job lines |

Secrets are redacted by the logger itself, whatever the call site passes: any key named `pin`, `password`, `passphrase`, `token`, `authorization`, `cookie`, `iban`, `email`, `secret`, `deviceSecret`, `apiKey` (and their `new…`/`current…` variants) is written as `[redacted]`, at the top level and two levels down. The generated platform-owner password is never logged: on first boot without `MEZAN_PLATFORM_OWNER_PASSWORD` it is written to `$MEZAN_PLATFORM_DIR/platform-owner-password.txt` (mode 0600) and the log names that file. Sign in, change the password, delete the file.

### Request ids

Each request gets an id: the edge's `x-request-id` when it is 8–64 characters of `[A-Za-z0-9_-]`, otherwise a fresh UUID. It comes back as the `x-request-id` response header, and every unexpected 5xx JSON body carries it as `requestId`; the web app appends it to the error message («رقم الطلب للدعم: …»). A 503 is a coded, retryable refusal (busy database, refused books) and carries no id in its body, only in the header. To find what happened:

```
docker logs mezan 2>&1 | grep '"requestId":"<the id>"'
```

### Reading logs on the VPS

```
docker logs --since 1h mezan                    # the last hour
docker logs -f mezan | grep '"level":"error"'   # follow errors only
docker logs mezan 2>&1 | grep '"event":"job.failed"'
docker logs mezan 2>&1 | grep '"tenantId":"<tenant id>"'
```

`jq` makes them readable: `docker logs mezan 2>&1 | grep '^{' | jq -r '[.ts,.level,.component,.event,.msg] | @tsv'`.

Docker's default `json-file` driver keeps logs forever. `deploy/contabo/docker-compose.yml` caps them (`max-size: 20m`, `max-file: 5`) and is the only supported way to run the container: it publishes **no** port for the app (only Caddy's 80/443), because a Docker-published port bypasses ufw and a caller reaching the app directly writes its own `X-Forwarded-For`. Do not start the image with `docker run -p 8080:8080`. See [deploy/contabo/README.md](../deploy/contabo/README.md).

`restart: unless-stopped` matters: an uncaught exception logs at `fatal` and exits with code 1 so Docker starts a clean process. An unhandled promise rejection is logged at `error` and alerted, and the server stays up (one process serves every tenant, and every route already answers its own failures). `SIGTERM` (`docker stop`) closes the timers, the tenants and the platform database before exiting 0.

`MEZAN_LOG_LEVEL` (`debug`, `info`, `warn`, `error`, `fatal`, `silent`; default `info`) sets the threshold. Successful requests to non-API paths (the web bundle, `/healthz`, `/readyz`) are logged at `debug`, so an uptime monitor does not fill the log.

## Platform jobs

The platform's timers — dunning (daily), owner digest (every 30 min), card checkout sweep (every 15 min), tenant backups (`MEZAN_BACKUP_INTERVAL_MINUTES`) and audit anchoring — each log `job.succeeded` or `job.failed` with `durationMs`. Their last run, last success, last error and next run are shown to the platform owner on the console's **حالة التشغيل / Operations** page (`GET /api/platform/operations`), with the readiness checks and the alerts raised since start-up. A tenant's own scheduled jobs (leave accrual, CRM reminders) log the same events and stay on that tenant's health console.

## Alerts

The server mails `MEZAN_ALERT_EMAIL` through the platform SMTP settings (`MEZAN_SMTP_HOST`, `MEZAN_SMTP_FROM_EMAIL`, …) when:

- 20 or more error-level lines are written within 5 minutes;
- any platform job fails;
- it starts after an unclean exit (a crash, an OOM kill or a power loss: the `mezan-running.json` marker in the data directory was still there);
- the readiness check fails (checked every minute);
- an unhandled promise rejection reaches the process.

Each alert key is mailed at most once per 30 minutes; repeats are counted and the count goes into the next mail. An alert carries the event, ids and counts only — never a log line, an error message or a request body. With either variable unset the server logs `alert.unsent` at `warn` instead, and says so at boot.

| Variable | Example | Meaning |
| --- | --- | --- |
| `MEZAN_ALERT_EMAIL` | `bassam.s.zakaria@gmail.com` | where operational alerts are mailed; needs the platform SMTP variables |
| `MEZAN_LOG_LEVEL` | `info` | log threshold |
| `MEZAN_VERSION` | `2026.10.18` | written on every line as `version` |
| `MEZAN_ENV` | `production` | written on every line as `env` |

## Request caps

Every `/api` request except the public API (`/api/v1`, 120 a minute per key) and the HMAC-signed Paymob webhook counts against two caps, kept in the server's memory for one minute:

- **Per caller address:** 3000 a minute (`MEZAN_API_REQUESTS_PER_ADDRESS_PER_MINUTE`). The address is the one the trusted proxy chain resolves, never a header the caller writes. IPv6 counts per /64. It is set high because a whole office behind one router shares one address.
- **Per signed-in session:** 600 a minute (`MEZAN_API_REQUESTS_PER_SESSION_PER_MINUTE`), keyed on a hash of the session token, so a browser's cookie session counts too.

Past either cap the server answers `429 TOO_MANY_REQUESTS` with `Retry-After`. Measured on 2026-10-23, a full page load makes 18 to 49 requests. The counts are per process: run more than one instance and each grants the full cap. Shutdown stops taking requests first, lets those in flight finish (idle keep-alive connections are cut each second, any left after 20 s are cut), then waits for a running backup, dunning or card-checkout sweep (the timer's sweep stops starting new checkouts after 20 s) and lets each tenant finish its queued work (at most 10 s) before closing the databases.

A tenant idle for 30 minutes is closed, and the backup and audit-anchor jobs only reach open tenants, so `MEZAN_BACKUP_INTERVAL_MINUTES` and `MEZAN_AUDIT_ANCHOR_INTERVAL_MINUTES` are refused above 30.

## Health checks

| Endpoint | Answers | Use it for |
| --- | --- | --- |
| `GET /healthz` | `200 ok` whenever the process is up | liveness (Docker `HEALTHCHECK`, a restart decision) |
| `GET /readyz` | `200 {"status":"ready","checks":{…}}`, or `503 {"status":"not_ready",…}` when the platform database does not answer `SELECT 1` or the server is shutting down | readiness: the uptime monitor, a load balancer |

Both are served before the demo password and the origin-secret gate, so a monitor needs no credentials.

### UptimeRobot

1. Add a new monitor: type **HTTP(s)**, URL `https://<your domain>/readyz`, interval 5 minutes.
2. Alert contacts: the same address as `MEZAN_ALERT_EMAIL`.
3. Optionally add a **Keyword** monitor on the same URL with keyword `"ready"` — it then also catches a proxy that answers 200 with an error page.

UptimeRobot covers what the server cannot report about itself: the VPS down, Docker stopped, or the network unreachable.

## Client errors

The web app (and the desktop renderer, which runs the same bundle), and the mobile app post their crashes to the tenant's `POST /api/client-errors`: route-boundary errors, `window` `error` / `unhandledrejection`, and React Native's global JS handler. The endpoint takes reports with or without a session, holds them to 16 KB, 20 per caller per 10 minutes, and keeps the newest 500 per tenant. Each report is also logged as `client_error.reported`. The last ones — when, which interface, screen, message, stack and the failing request's id — are on the tenant's **حالة النظام** health console, for users who hold `admin.health.view`.
