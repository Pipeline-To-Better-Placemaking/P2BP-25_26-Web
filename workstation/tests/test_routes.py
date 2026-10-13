import pytest

B64 = {"FileName": "a.xyz", "FileBase64": "AAAA"}

CASES = [
    ("get", "/tracking/positions", None),
    ("get", "/tracking/tracks", None),
    ("get", "/tracking/tracks/1", None),
    ("get", "/rplidar/scans", None),
    ("get", "/rplidar/scans/a.xyz/download", None),
    ("post", "/rplidar/upload", B64),
    ("post", "/visualizer/files", B64),
    ("get", "/visualizer/files", None),
    ("get", "/visualizer/files/a.obj", None),
    ("get", "/calibration/p/d/s", None),
    ("post", "/calibration/p/d", B64),
]


@pytest.mark.parametrize("method,path,body", CASES)
def test_501(authed, method, path, body):
    r = getattr(authed, method)(path, **({"json": body} if body else {}))
    assert r.status_code == 501
    assert "Not implemented" in r.json()["detail"]


@pytest.mark.parametrize("method,path,body", CASES)
def test_requires_auth(client, method, path, body):
    r = getattr(client, method)(path, **({"json": body} if body else {}))
    assert r.status_code == 401
