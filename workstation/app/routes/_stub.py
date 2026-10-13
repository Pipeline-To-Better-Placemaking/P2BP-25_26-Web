from fastapi import HTTPException, status


def not_implemented():
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented: workstation skeleton")
