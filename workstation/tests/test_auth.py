import jwt
import pytest

from app.auth import UnsafePathError, safe_path, verify_token
from tests.conftest import SECRET, make_token


def test_valid_token():
    assert verify_token(make_token(), SECRET)["sub"] == "u1"


@pytest.mark.parametrize("tok", [
    make_token(secret="wrong-secret-wrong-secret-wrong-secret"),
    make_token(exp_delta=-10),
    make_token(aud="other"),
])
def test_bad_tokens_rejected(tok):
    with pytest.raises(jwt.PyJWTError):
        verify_token(tok, SECRET)


def test_dependency_401_without_or_bad_token(client):
    assert client.get("/tracking/tracks").status_code == 401
    r = client.get("/tracking/tracks", headers={"Authorization": "Bearer junk"})
    assert r.status_code == 401


def test_health_is_public(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_cors_limited_to_allowed_origins(client):
    ok = client.options("/health", headers={"Origin": "https://ok.example", "Access-Control-Request-Method": "GET"})
    bad = client.options("/health", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert ok.headers.get("access-control-allow-origin") == "https://ok.example"
    assert "access-control-allow-origin" not in bad.headers


def test_safe_path_ok(tmp_path):
    assert safe_path("scans", "a.xyz") == (tmp_path / "scans" / "a.xyz").resolve()
    assert safe_path() == tmp_path.resolve()


@pytest.mark.parametrize("parts", [("..",), ("a", "../../etc/passwd"), ("/etc/passwd",), ("a\x00b",), ("..", "x")])
def test_safe_path_rejects(parts):
    with pytest.raises(UnsafePathError):
        safe_path(*parts)


def test_safe_path_rejects_symlink_escape(tmp_path):
    outside = tmp_path.parent / "outside_dir"
    outside.mkdir(exist_ok=True)
    (tmp_path / "link").symlink_to(outside)
    with pytest.raises(UnsafePathError):
        safe_path("link", "f.xyz")


def test_safe_path_requires_root(monkeypatch):
    monkeypatch.delenv("DATA_ROOT")
    with pytest.raises(UnsafePathError):
        safe_path("a")
