# Workstation API (skeleton)

FastAPI service for the lab workstation: tracking, RPLidar scans, visualizer and
calibration files. Every data endpoint currently returns `501`; models, auth and
path-safety are real. Auth: Supabase JWT (HS256) as `Authorization: Bearer`.

## Run
    python3 -m venv .venv && . .venv/bin/activate
    pip install -r requirements.txt
    cp .env.example .env   # then export it, e.g. set -a; . ./.env; set +a
    uvicorn app.main:app --host 127.0.0.1 --port 8000
    pytest

Env: `ALLOWED_ORIGINS`, `SUPABASE_JWT_SECRET`, `DATA_ROOT` (all file access is
confined under it; traversal is rejected by `app.auth.safe_path`).

## Run as a service
Linux: a systemd unit with `WorkingDirectory=<repo>/workstation`,
`EnvironmentFile=<repo>/workstation/.env`,
`ExecStart=<repo>/workstation/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000`,
`Restart=always`; then `systemctl enable --now p2bp-workstation`.
macOS: an equivalent launchd plist with `KeepAlive`.

## HTTPS over Tailscale
The browser app is HTTPS, so the API must be too (mixed content is blocked):

    tailscale serve --bg --https=443 http://127.0.0.1:8000

The API is then at `https://<machine>.<tailnet>.ts.net`. Enable HTTPS certificates
in the Tailscale admin console first. Use `tailscale funnel` only for public access.

## Sharing the machine
Tailscale admin console > Machines > the workstation > Share, then send the invite
link. Invitees install Tailscale and accept; nobody else can reach the URL.

## CORS
Set `ALLOWED_ORIGINS` to the exact deployed origin(s), comma-separated, no trailing
slash (e.g. `https://app.vercel.app`). Preview deployments need their own entry.
