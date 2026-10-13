import time

import jwt
import pytest
from fastapi.testclient import TestClient

SECRET = "test-secret-test-secret-test-secret"


@pytest.fixture(autouse=True)
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    monkeypatch.setenv("DATA_ROOT", str(tmp_path))
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://ok.example")


def make_token(secret=SECRET, exp_delta=3600, aud="authenticated", alg="HS256"):
    return jwt.encode({"sub": "u1", "aud": aud, "exp": int(time.time()) + exp_delta}, secret, algorithm=alg)


@pytest.fixture
def client():
    from app.main import create_app
    return TestClient(create_app())


@pytest.fixture
def authed(client):
    client.headers["Authorization"] = f"Bearer {make_token()}"
    return client
