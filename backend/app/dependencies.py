"""OPTIQ DSS · FastAPI dependency injectors"""
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app import models
from app.database import SessionLocal
from app.auth import decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# Role hierarchy (higher index = more privileged)
_ROLE_RANK = {
    models.UserRole.VIEWER:        0,
    models.UserRole.OPERATOR:      1,
    models.UserRole.ENGINEER:      2,
    models.UserRole.COMPANY_ADMIN: 3,
    models.UserRole.ADMIN:         4,   # legacy alias
    models.UserRole.SYSTEM_ADMIN:  5,
}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    username = payload.get("sub")
    user = db.query(models.User).filter_by(username=username).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


def _rank(user: models.User) -> int:
    return _ROLE_RANK.get(user.role, 0)


def require_admin(current_user: models.User = Depends(get_current_user)):
    """System admin only — can manage companies."""
    if current_user.role not in (models.UserRole.SYSTEM_ADMIN, models.UserRole.ADMIN):
        raise HTTPException(status_code=403, detail="System admin access required")
    return current_user


def require_company_admin(current_user: models.User = Depends(get_current_user)):
    """Company admin or above — can manage sites and columns."""
    if _rank(current_user) < _ROLE_RANK[models.UserRole.COMPANY_ADMIN]:
        raise HTTPException(status_code=403, detail="Company admin access required")
    return current_user


def require_engineer(current_user: models.User = Depends(get_current_user)):
    """Engineer or above — can run optimisation and confirm apply."""
    if _rank(current_user) < _ROLE_RANK[models.UserRole.ENGINEER]:
        raise HTTPException(status_code=403, detail="Engineer access required")
    return current_user


def require_operator(current_user: models.User = Depends(get_current_user)):
    """Operator or above."""
    if _rank(current_user) < _ROLE_RANK[models.UserRole.OPERATOR]:
        raise HTTPException(status_code=403, detail="Operator access required")
    return current_user
