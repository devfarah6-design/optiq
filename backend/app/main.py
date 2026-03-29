"""
OPTIQ DSS · FastAPI Application Entry Point
"""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import (
    FastAPI, Depends, HTTPException, WebSocket,
    WebSocketDisconnect, status
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from sqlalchemy import text

from app import models, schemas, auth, dependencies
from app.database import engine, SessionLocal
from app.config import settings
from app.prediction import predict_energy_purity
from app.optimizer import optimize
from app.websocket_manager import manager as ws_manager

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ── DB initialisation helpers ──────────────────────────────────────────────────
def init_db():
    """Create tables and attempt TimescaleDB hypertable conversion."""
    models.Base.metadata.create_all(bind=engine)
    try:
        with engine.connect() as conn:
            conn.execute(text(
                "SELECT create_hypertable('predictions', 'timestamp', "
                "if_not_exists => TRUE, migrate_data => TRUE);"
            ))
            conn.commit()
            logger.info("✓ TimescaleDB hypertable ready")
    except Exception as e:
        logger.warning(f"TimescaleDB hypertable skipped (non-fatal): {e}")


def seed_db():
    """Create initial admin user and demo company if they don't exist."""
    db = SessionLocal()
    try:
        # Admin user
        if not db.query(models.User).filter_by(username=settings.admin_username).first():
            admin = models.User(
                username=settings.admin_username,
                hashed_password=auth.get_password_hash(settings.admin_password),
                role=models.UserRole.ADMIN,
            )
            db.add(admin)
            logger.info(f"✓ Admin user created: {settings.admin_username}")

        # Demo company
        if not db.query(models.Company).filter_by(slug="demo").first():
            demo = models.Company(
                slug="demo",
                name="Demo Client",
                sector="LNG",
                primary_color="#00D9FF",
                accent_color="#FFD700",
                background_color="#0D1B2A",
            )
            db.add(demo)
            logger.info("✓ Demo company seeded")

        db.commit()
    finally:
        db.close()


# ── Lifespan ───────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    seed_db()
    # Import here to avoid circular imports
    from app.ingestion import ingestion_loop
    task = asyncio.create_task(ingestion_loop())
    logger.info("✓ OPTIQ DSS started")
    yield
    task.cancel()


# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="OPTIQ DSS API",
    description="Decision Support System for process optimisation",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://for:80",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ─────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "service": "optiq"}


# ── Auth ───────────────────────────────────────────────────────────────────────
@app.post("/token", response_model=schemas.Token, tags=["auth"])
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(dependencies.get_db),
):
    user = db.query(models.User).filter_by(username=form_data.username).first()
    if not user or not auth.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    token = auth.create_access_token(data={"sub": user.username})
    return {"access_token": token, "token_type": "bearer"}


@app.get("/users/me", response_model=schemas.UserOut, tags=["auth"])
def read_me(current_user=Depends(dependencies.get_current_user)):
    return current_user


@app.post("/users", response_model=schemas.UserOut, tags=["auth"],
          dependencies=[Depends(dependencies.require_admin)])
def create_user(user_in: schemas.UserCreate, db: Session = Depends(dependencies.get_db)):
    if db.query(models.User).filter_by(username=user_in.username).first():
        raise HTTPException(status_code=400, detail="Username already exists")
    user = models.User(
        username=user_in.username,
        hashed_password=auth.get_password_hash(user_in.password),
        role=models.UserRole(user_in.role),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# ── Prediction ─────────────────────────────────────────────────────────────────
@app.post("/predict", response_model=schemas.PredictionOut, tags=["prediction"])
def predict(
    data: schemas.SensorReadings,
    _=Depends(dependencies.get_current_user),
):
    return predict_energy_purity(data.readings)


# ── Optimisation ───────────────────────────────────────────────────────────────
@app.post("/optimize", response_model=schemas.OptimizeOut, tags=["prediction"])
def optimise(
    data: schemas.OptimizeRequest,
    _=Depends(dependencies.get_current_user),
):
    if len(data.current_state) != 3:
        raise HTTPException(status_code=422, detail="Provide exactly 3 setpoints")
    return optimize(data.current_state)


# ── Alerts ─────────────────────────────────────────────────────────────────────
@app.get("/alerts", response_model=list[schemas.AlertOut], tags=["alerts"])
def get_alerts(
    limit: int = 50,
    db: Session = Depends(dependencies.get_db),
    _=Depends(dependencies.get_current_user),
):
    return (
        db.query(models.Alert)
        .order_by(models.Alert.timestamp.desc())
        .limit(limit)
        .all()
    )


@app.patch("/alerts/{alert_id}/acknowledge", tags=["alerts"])
def ack_alert(
    alert_id: int,
    db: Session = Depends(dependencies.get_db),
    current_user=Depends(dependencies.get_current_user),
):
    alert = db.query(models.Alert).get(alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.acknowledged = True
    alert.acknowledged_by = current_user.username
    db.commit()
    return {"message": "Alert acknowledged"}


# ── Companies (admin) ──────────────────────────────────────────────────────────
@app.get("/admin/companies", response_model=list[schemas.CompanyOut],
         tags=["admin"], dependencies=[Depends(dependencies.require_admin)])
def list_companies(db: Session = Depends(dependencies.get_db)):
    return db.query(models.Company).all()


@app.post("/admin/companies", response_model=schemas.CompanyOut,
          tags=["admin"], dependencies=[Depends(dependencies.require_admin)])
def create_company(company_in: schemas.CompanyCreate, db: Session = Depends(dependencies.get_db)):
    if db.query(models.Company).filter_by(slug=company_in.slug).first():
        raise HTTPException(status_code=400, detail="Slug already exists")
    company = models.Company(**company_in.model_dump())
    db.add(company)
    db.commit()
    db.refresh(company)
    return company


@app.put("/admin/companies/{company_id}", response_model=schemas.CompanyOut,
         tags=["admin"], dependencies=[Depends(dependencies.require_admin)])
def update_company(
    company_id: int,
    update: schemas.CompanyUpdate,
    db: Session = Depends(dependencies.get_db),
):
    company = db.query(models.Company).get(company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    for field, val in update.model_dump(exclude_none=True).items():
        setattr(company, field, val)
    db.commit()
    db.refresh(company)
    return company


@app.delete("/admin/companies/{company_id}", tags=["admin"],
            dependencies=[Depends(dependencies.require_admin)])
def delete_company(company_id: int, db: Session = Depends(dependencies.get_db)):
    company = db.query(models.Company).get(company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    db.delete(company)
    db.commit()
    return {"message": "Company deleted"}


# Public endpoint – used by frontend to apply branding by slug
@app.get("/branding/{slug}", response_model=schemas.CompanyOut, tags=["branding"])
def get_branding(slug: str, db: Session = Depends(dependencies.get_db)):
    company = db.query(models.Company).filter_by(slug=slug, is_active=True).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    return company


# ── App Config ─────────────────────────────────────────────────────────────────
@app.get("/admin/config", tags=["admin"],
         dependencies=[Depends(dependencies.require_admin)])
def get_config(db: Session = Depends(dependencies.get_db)):
    configs = db.query(models.AppConfig).all()
    return {c.key: c.value for c in configs}


@app.post("/admin/config", tags=["admin"],
          dependencies=[Depends(dependencies.require_admin)])
def set_config(payload: schemas.ConfigSet, db: Session = Depends(dependencies.get_db)):
    cfg = db.query(models.AppConfig).filter_by(key=payload.key).first()
    if cfg:
        cfg.value = payload.value
    else:
        cfg = models.AppConfig(key=payload.key, value=payload.value)
        db.add(cfg)
    db.commit()
    return {"message": "Config saved"}


# ── WebSocket ──────────────────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()   # keep-alive; ignore client messages
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
