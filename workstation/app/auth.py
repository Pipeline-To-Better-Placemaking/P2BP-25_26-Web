"""Supabase JWT verification and DATA_ROOT path confinement."""
import os
from pathlib import Path

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_bearer = HTTPBearer(auto_error=False)


def verify_token(token: str, secret: str) -> dict:
    """Decode and verify an HS256 Supabase JWT; returns its claims.

    Supabase access tokens carry aud="authenticated"; expiry is enforced.
    Raises jwt.PyJWTError on any failure.
    """
    return jwt.decode(
        token,
        secret,
        algorithms=["HS256"],
        audience="authenticated",
        options={"require": ["exp", "sub"]},
    )


def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    """FastAPI dependency: requires `Authorization: Bearer <supabase jwt>`."""
    secret = os.environ.get("SUPABASE_JWT_SECRET", "")
    if not secret:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "SUPABASE_JWT_SECRET not configured")
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    try:
        return verify_token(creds.credentials, secret)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")


class UnsafePathError(ValueError):
    """Raised when a requested path escapes DATA_ROOT."""


def safe_path(*parts: str, root: str | Path | None = None) -> Path:
    """Join `parts` under DATA_ROOT and reject anything that resolves outside it.

    Rejects absolute parts, `..` traversal, NUL bytes, and symlinks pointing out.
    """
    base = root if root is not None else os.environ.get("DATA_ROOT", "")
    if not base:
        raise UnsafePathError("DATA_ROOT not configured")
    base_path = Path(base).resolve()
    for p in parts:
        if "\x00" in p or Path(p).is_absolute() or p.startswith(("/", "\\")):
            raise UnsafePathError(f"Invalid path component: {p!r}")
    candidate = base_path.joinpath(*parts).resolve()
    if candidate != base_path and base_path not in candidate.parents:
        raise UnsafePathError("Path escapes DATA_ROOT")
    return candidate

TICKET_SCOPE = "amc"


def verify_ticket(token: str, secret: str) -> dict:
    """Decode and verify an Express-issued workstation ticket; raises jwt.PyJWTError on any failure."""
    claims = jwt.decode(
        token,
        secret,
        algorithms=["HS256"],
        audience=TICKET_AUDIENCE,
        options={"require": ["exp", "sub"]},
    )
    if claims.get("scope") != TICKET_SCOPE:
        raise jwt.InvalidTokenError("wrong scope")
    return claims


def amc_ticket(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    """
    If AMC_PROJECT_ID is set only tickets for that project are accepted
    """
    secret = os.environ.get("WORKSTATION_TICKET_SECRET", "")
    if not secret:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "WORKSTATION_TICKET_SECRET not configured")
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    try:
        claims = verify_ticket(creds.credentials, secret)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired ticket")
    allowed = os.environ.get("AMC_PROJECT_ID", "").strip()
    if allowed and claims.get("pid") != allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Ticket is for a different project")
    return claims
