"""Automate AMC's workflow: start a run, watch it, continue after the manual steps, cancel."""
import os

from fastapi import APIRouter, Depends, HTTPException, status

from .. import automation
from ..auth import amc_ticket
from ..automation_config import ConfigError
from ..calibration_spec import SpecError, verify_spec
from ..models import AutomationJob, AutomationStart

router = APIRouter(prefix="/amc/automation", tags=["amc-automation"])


def _same_project(claims: dict) -> None:
    job = automation.runner.status()
    if job and job["ProjectId"] != claims.get("pid"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "The current run belongs to a different project")


@router.get("/status", response_model=AutomationJob | None)
def automation_status(claims: dict = Depends(amc_ticket)):
    job = automation.runner.status()
    if job and job["ProjectId"] != claims.get("pid"):
        return None  # do not show another project's run
    return job


@router.post("/start", response_model=AutomationJob, status_code=202)
def automation_start(body: AutomationStart, claims: dict = Depends(amc_ticket)):
    secret = os.environ.get("WORKSTATION_TICKET_SECRET", "")
    try:
        spec = verify_spec(body.Spec, secret, claims["pid"])
        return automation.runner.start(spec)
    except SpecError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except automation.Busy as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    except ConfigError as e:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(e)) from e


@router.post("/continue", response_model=AutomationJob, status_code=202)
def automation_continue(claims: dict = Depends(amc_ticket)):
    _same_project(claims)
    try:
        return automation.runner.resume()
    except automation.NothingToResume as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    except ConfigError as e:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(e)) from e


@router.post("/cancel", response_model=AutomationJob, status_code=202)
def automation_cancel(claims: dict = Depends(amc_ticket)):
    _same_project(claims)
    try:
        return automation.runner.cancel()
    except automation.NothingToResume as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e


@router.get("/config")
def automation_config(claims: dict = Depends(amc_ticket)):
    """The settings in effect (base file merged with this workstation's overrides)."""
    try:
        return automation.runner.config().model_dump(mode="json", by_alias=True)
    except ConfigError as e:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(e)) from e
