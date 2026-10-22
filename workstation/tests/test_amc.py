"""AMC control endpoints, tested against a fake `amc` script and fake AMC HTTP servers (no GPU/Docker)."""
import json
import stat
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import jwt
import pytest
from fastapi.testclient import TestClient

TICKET_SECRET = "ticket-secret-ticket-secret-ticket-secret"
READY = {"on": False}


def make_ticket(secret=TICKET_SECRET, exp_delta=900, aud="p2bp-workstation", scope="amc", pid="proj-1", sub="user-1"):
    claims = {"sub": sub, "pid": pid, "scope": scope, "aud": aud, "exp": int(time.time()) + exp_delta}
    return jwt.encode(claims, secret, algorithm="HS256")


class FakeAmcHandler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        body = json.dumps({"code": 0}).encode() if self.path == "/v1/ready" else b"<html/>"
        self.send_response(200 if READY["on"] else 503)
        self.end_headers()
        self.wfile.write(body)


@pytest.fixture
def amc_env(monkeypatch, tmp_path):
    """Install tree + fake amc wrapper + fake AMC servers; returns (calls_log, ui_port)."""
    READY["on"] = False
    servers = [HTTPServer(("127.0.0.1", 0), FakeAmcHandler) for _ in range(2)]
    for s in servers:
        threading.Thread(target=s.serve_forever, daemon=True).start()
    ms, ui = (s.server_address[1] for s in servers)
    (tmp_path / "installer.conf").write_text(f"AUTO_MAGIC_CALIB_MS_PORT={ms}\nAUTO_MAGIC_CALIB_UI_PORT={ui}\n")
    calls = tmp_path / "calls.log"
    amc = tmp_path / "fake_amc"
    amc.write_text(
        "#!/bin/sh\n"
        f'echo "$@" >> {calls}\n'
        '[ "$1" = "--down" ] && exit 0\n'
        '[ -n "$FAKE_FAIL" ] && { echo boom >&2; exit 3; }\n'
        "sleep 0.5\nexit 0\n"
    )
    amc.chmod(amc.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("MV3DT_INSTALL_DIR", str(tmp_path))
    monkeypatch.setenv("AMC_BIN", str(amc))
    monkeypatch.setenv("AMC_USE_SUDO", "0")
    monkeypatch.setenv("AMC_PUBLIC_HOST", "ws.tail1.ts.net")
    monkeypatch.setenv("WORKSTATION_TICKET_SECRET", TICKET_SECRET)
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "unused-unused-unused-unused-unused")
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://ok.example")
    from app import amc as amc_mod

    amc_mod.controller = amc_mod.AmcController()  # fresh state per test
    import app.routes.amc as routes_amc

    routes_amc.controller = amc_mod.controller
    yield calls, ui
    for s in servers:
        s.shutdown()


@pytest.fixture
def client(amc_env):
    from app.main import create_app

    c = TestClient(create_app())
    c.headers["Authorization"] = f"Bearer {make_ticket()}"
    return c


def wait_state(client, want, secs=5):
    end = time.time() + secs
    last = None
    while time.time() < end:
        last = client.get("/amc/status").json()
        if last["State"] == want:
            return last
        time.sleep(0.1)
    raise AssertionError(f"never reached {want}; last={last}")


# ---------------------------------------------------------------- auth
@pytest.mark.parametrize("method,path", [("get", "/amc/status"), ("post", "/amc/start"), ("post", "/amc/stop")])
def test_requires_ticket(amc_env, method, path):
    from app.main import create_app

    c = TestClient(create_app())
    assert getattr(c, method)(path).status_code == 401
    assert getattr(c, method)(path, headers={"Authorization": "Bearer junk"}).status_code == 401


@pytest.mark.parametrize(
    "tok",
    [
        make_ticket(secret="wrong-secret-wrong-secret-wrong-secret"),
        make_ticket(exp_delta=-10),
        make_ticket(aud="authenticated"),  # a Supabase-style audience must not work
        make_ticket(scope="files"),
    ],
)
def test_bad_tickets_rejected(amc_env, tok):
    from app.main import create_app

    c = TestClient(create_app())
    assert c.get("/amc/status", headers={"Authorization": f"Bearer {tok}"}).status_code == 401


def test_ordinary_supabase_token_does_not_open_amc(amc_env):
    from app.main import create_app

    tok = jwt.encode(
        {"sub": "u", "aud": "authenticated", "exp": int(time.time()) + 600},
        "unused-unused-unused-unused-unused",
        algorithm="HS256",
    )
    c = TestClient(create_app())
    assert c.post("/amc/start", headers={"Authorization": f"Bearer {tok}"}).status_code == 401


def test_project_pinning(amc_env, monkeypatch):
    from app.main import create_app

    monkeypatch.setenv("AMC_PROJECT_ID", "proj-1")
    c = TestClient(create_app())
    assert c.get("/amc/status", headers={"Authorization": f"Bearer {make_ticket(pid='proj-1')}"}).status_code == 200
    assert c.get("/amc/status", headers={"Authorization": f"Bearer {make_ticket(pid='other')}"}).status_code == 403


def test_unconfigured_secret_is_a_500_not_open_access(amc_env, monkeypatch):
    from app.main import create_app

    monkeypatch.delenv("WORKSTATION_TICKET_SECRET")
    c = TestClient(create_app())
    assert c.get("/amc/status", headers={"Authorization": f"Bearer {make_ticket()}"}).status_code == 500


# ---------------------------------------------------------------- behaviour
def test_start_then_ready_then_stop(client, amc_env):
    calls, ui = amc_env
    assert client.get("/amc/status").json()["State"] == "down"

    r = client.post("/amc/start")
    assert r.status_code == 202 and r.json()["State"] == "starting"
    READY["on"] = True
    d = wait_state(client, "ready")
    assert d["UiUrl"] == f"http://ws.tail1.ts.net:{ui}"
    text = calls.read_text()
    assert "--host-ip ws.tail1.ts.net" in text and "--no-open" in text and "--keep-up" in text

    READY["on"] = False
    assert client.post("/amc/stop").status_code == 202
    d = wait_state(client, "down")
    assert d["UiUrl"] == ""
    assert "--down" in calls.read_text()


def test_start_is_idempotent(client, amc_env):
    calls, _ = amc_env
    client.post("/amc/start")
    client.post("/amc/start")
    client.post("/amc/start")
    assert len(calls.read_text().splitlines()) == 1


def test_start_when_already_ready_launches_nothing(client, amc_env):
    calls, _ = amc_env
    READY["on"] = True
    assert client.post("/amc/start").json()["State"] == "ready"
    assert not calls.exists()


def test_failed_start_reports_error(client, monkeypatch):
    monkeypatch.setenv("FAKE_FAIL", "1")
    client.post("/amc/start")
    d = wait_state(client, "error")
    assert "exited 3" in d["Error"] and "boom" in d["Error"]


def test_no_tailscale_name_is_a_clear_error(client, amc_env, monkeypatch):
    calls, _ = amc_env
    monkeypatch.setenv("AMC_PUBLIC_HOST", "")
    from app import amc as amc_mod

    monkeypatch.setattr(amc_mod.AmcController, "_tailscale_host", lambda self: None)
    d = client.post("/amc/start").json()
    assert d["State"] == "error" and "Tailscale" in d["Error"]
    assert not calls.exists()


def test_bad_host_is_refused_not_passed_to_argv(client, amc_env, monkeypatch):
    calls, _ = amc_env
    monkeypatch.setenv("AMC_PUBLIC_HOST", "x; rm -rf /")
    d = client.post("/amc/start").json()
    assert d["State"] == "error"
    assert not calls.exists()


def test_stop_during_start_does_not_report_the_aborted_start_as_failure(client, amc_env):
    client.post("/amc/start")
    client.post("/amc/stop")
    d = wait_state(client, "down")
    assert d["Error"] == ""


def test_missing_install_tree_is_down_not_a_crash(client, monkeypatch, tmp_path):
    monkeypatch.setenv("MV3DT_INSTALL_DIR", str(tmp_path / "nope"))
    assert client.get("/amc/status").json()["State"] == "down"
