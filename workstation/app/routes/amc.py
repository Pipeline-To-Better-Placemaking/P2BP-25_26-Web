from fastapi import APIRouter, Depends

from ..amc import controller
from ..auth import amc_ticket
from ..models import AmcStatus

router = APIRouter(prefix="/amc", tags=["amc"], dependencies=[Depends(amc_ticket)])


@router.get("/status", response_model=AmcStatus)
def amc_status():
    return controller.status()


@router.post("/start", response_model=AmcStatus, status_code=202)
def amc_start():
    """Launch AMC if it is not already up"""
    controller.start()
    return controller.status()


@router.post("/stop", response_model=AmcStatus, status_code=202)
def amc_stop():
    """Shut AMC down"""
    controller.stop()
    return controller.status()
