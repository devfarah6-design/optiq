"""
OPTIQ DSS · FastAPI Application Entry Point
"""
import asyncio
import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import (
    FastAPI, Depends, HTTPException, WebSocket,
    WebSocketDisconnect, status, Request
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from sqlalchemy import text, func

from app import models, schemas, auth, dependencies
from app.database import engine, SessionLocal
from app.config import settings
from app.prediction import predict_energy_purity
from app.optimizer import optimize, simulate_after_apply
from app.websocket_manager import manager as ws_manager

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ── DB initialisation ──────────────────────────────────────────────────────────
def _migrate_enums():
    """
    Fix stale PostgreSQL enum types that were created with uppercase member names
    instead of lowercase values.  Idempotent — safe to run on every startup.

    Handles two cases:
      userrole     : {ADMIN, OPERATOR, VIEWER} → {system_admin, company_admin,
                                                   engineer, operator, viewer, admin}
      alertseverity: {INFO, WARNING, CRITICAL}  → {info, warning, critical}
    """
    ENUM_SPECS = {
        "userrole": {
            "values"  : ["system_admin", "company_admin", "engineer",
                         "operator", "viewer", "admin"],
            # Map any stale uppercase name → correct lowercase value
            "rename"  : {
                "SYSTEM_ADMIN":  "system_admin",
                "COMPANY_ADMIN": "company_admin",
                "ENGINEER":      "engineer",
                "OPERATOR":      "operator",
                "VIEWER":        "viewer",
                "ADMIN":         "admin",
            },
            "table"   : "users",
            "column"  : "role",
        },
        "alertseverity": {
            "values"  : ["info", "warning", "critical"],
            "rename"  : {
                "INFO":     "info",
                "WARNING":  "warning",
                "CRITICAL": "critical",
            },
            "table"   : "alerts",
            "column"  : "severity",
        },
    }

    with engine.connect() as conn:
        # Clean up any orphaned temp types from interrupted prior migrations.
        # e.g. if Render restarted mid-migration, userrole_new may already exist.
        for enum_name in ENUM_SPECS:
            tmp_name = f"{enum_name}_new"
            try:
                with conn.begin():
                    conn.execute(text(f"DROP TYPE IF EXISTS {tmp_name}"))
                logger.info(f"  Cleaned temp type {tmp_name} (if any)")
            except Exception as ce:
                logger.debug(f"  Could not clean {tmp_name}: {ce}")

        for enum_name, spec in ENUM_SPECS.items():
            # Check if enum type exists in DB
            exists = conn.execute(text(
                "SELECT 1 FROM pg_type WHERE typname = :n"
            ), {"n": enum_name}).fetchone()
            if not exists:
                continue   # create_all will handle it fresh

            # Fetch current enum labels
            current = [
                row[0] for row in conn.execute(text(
                    f"SELECT unnest(enum_range(NULL::{enum_name}))::text"
                ))
            ]

            # Check if migration needed (any label is not in target values)
            target = set(spec["values"])
            if all(v in target for v in current) and set(current) == target:
                logger.info(f"✓ Enum {enum_name} is up to date")
                continue

            logger.warning(
                f"⚠ Migrating enum {enum_name}: {current} → {spec['values']}"
            )

            tmp = f"{enum_name}_new"
            vals_sql = ", ".join(f"'{v}'" for v in spec["values"])

            with conn.begin():
                # 1. Create replacement type
                conn.execute(text(
                    f"CREATE TYPE {tmp} AS ENUM ({vals_sql})"
                ))

                # 2. Check the column exists in the table before altering
                col_exists = conn.execute(text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name=:t AND column_name=:c"
                ), {"t": spec["table"], "c": spec["column"]}).fetchone()

                if col_exists:
                    # Build CASE for mapping old labels → new values
                    cases = "\n".join(
                        f"WHEN '{old}' THEN '{new}'::{tmp}"
                        for old, new in spec["rename"].items()
                    )
                    # Also handle values that are already lowercase (no-op)
                    for v in spec["values"]:
                        cases += f"\nWHEN '{v}' THEN '{v}'::{tmp}"

                    conn.execute(text(f"""
                        ALTER TABLE {spec['table']}
                          ALTER COLUMN {spec['column']}
                          TYPE {tmp}
                          USING CASE {spec['column']}::text
                            {cases}
                            ELSE '{spec['values'][-1]}'::{tmp}
                          END
                    """))

                # 3. Swap types
                conn.execute(text(f"DROP TYPE {enum_name}"))
                conn.execute(text(f"ALTER TYPE {tmp} RENAME TO {enum_name}"))

            logger.info(f"✓ Enum {enum_name} migrated successfully")


def _migrate_columns():
    """
    Add columns introduced after initial deployment.
    Each ALTER TABLE runs in its own engine.begin() so SQLAlchemy 2.0
    autobegin never conflicts with an explicit transaction.
    Fully idempotent — safe to run on every startup.
    """
    MISSING_COLS = [
        # (table, column, postgresql_definition)
        ("alerts",               "column_tag",    "TEXT DEFAULT 'DC4'"),
        ("predictions",          "column_tag",    "TEXT DEFAULT 'DC4'"),
        ("predictions",          "butane",        "FLOAT DEFAULT 0.0"),
        ("predictions",          "stability",     "FLOAT DEFAULT 0.0"),
        ("predictions",          "confidence",    "FLOAT DEFAULT 1.0"),
        ("predictions",          "is_outlier",    "BOOLEAN DEFAULT FALSE"),
        ("predictions",          "outlier_score", "FLOAT DEFAULT 0.0"),
        ("predictions",          "model_type",    "TEXT DEFAULT 'xgboost'"),
        ("optimization_results", "column_tag",    "TEXT DEFAULT 'DC4'"),
    ]
    for table, col, defn in MISSING_COLS:
        try:
            # Each iteration opens its own transaction via engine.begin()
            with engine.begin() as conn:
                # Skip if the table doesn't exist yet (fresh DB)
                tbl_exists = conn.execute(text(
                    "SELECT 1 FROM information_schema.tables WHERE table_name = :t"
                ), {"t": table}).fetchone()
                if not tbl_exists:
                    continue
                # ADD COLUMN IF NOT EXISTS is idempotent
                conn.execute(text(
                    f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {defn}"
                ))
            logger.info(f"✓ {table}.{col} ensured")
        except Exception as ce:
            logger.warning(f"Column migration {table}.{col} failed: {ce}")


def init_db(retries: int = 10, delay: float = 3.0):
    for attempt in range(1, retries + 1):
        try:
            # Fix stale enum types BEFORE create_all touches tables
            try:
                _migrate_enums()
            except Exception as me:
                logger.warning(f"Enum migration skipped (DB may be fresh): {me}")

            models.Base.metadata.create_all(bind=engine)

            # Add any columns that were missing from pre-existing tables
            try:
                _migrate_columns()
            except Exception as mc:
                logger.warning(f"Column migration skipped: {mc}")

            try:
                with engine.connect() as conn:
                    conn.execute(text("""
                        SELECT create_hypertable(
                            'predictions', 'timestamp',
                            if_not_exists => TRUE, migrate_data => TRUE
                        );
                    """))
                    conn.commit()
                logger.info("✓ TimescaleDB hypertable enabled")
            except Exception:
                logger.warning("TimescaleDB not available — using normal PostgreSQL table")

            logger.info("✓ Database initialized successfully")
            return

        except Exception as e:
            if attempt == retries:
                logger.error(f"✗ Database init failed after {retries} attempts: {e}")
                raise
            logger.warning(f"DB not ready ({attempt}/{retries}), retrying in {delay}s…")
            time.sleep(delay)


def seed_db():
    """Seed initial admin user, demo company, default site, and DC4 column."""
    db = SessionLocal()
    try:
        # Admin user
        if not db.query(models.User).filter_by(username=settings.admin_username).first():
            admin = models.User(
                username        = settings.admin_username,
                hashed_password = auth.get_password_hash(settings.admin_password),
                role            = models.UserRole.SYSTEM_ADMIN,
            )
            db.add(admin)
            logger.info(f"✓ System admin created: {settings.admin_username}")

        # Demo company
        demo = db.query(models.Company).filter_by(slug="demo").first()
        if not demo:
            demo = models.Company(
                slug="demo", name="Demo Client", sector="LNG",
                primary_color="#00D9FF", accent_color="#FFD700", background_color="#0D1B2A",
            )
            db.add(demo)
            db.flush()
            logger.info("✓ Demo company seeded")

        # Default site
        site = db.query(models.Site).filter_by(company_id=demo.id, name="Main Plant").first()
        if not site:
            site = models.Site(
                company_id=demo.id, name="Main Plant",
                location="Arzew, Algeria",
                description="Primary fractionation facility",
            )
            db.add(site)
            db.flush()
            logger.info("✓ Default site seeded")

        # DC4 Debutanizer column
        dc4 = db.query(models.DistillationColumn).filter_by(site_id=site.id, tag="DC4").first()
        if not dc4:
            db.add(models.DistillationColumn(
                site_id=site.id,
                name="DC4 Debutanizer",
                tag="DC4",
                sequence_order=1,
                description="Butane debutanizer — primary product column",
                product_name="Butane (C4)",
                bottoms_name="C5+ Naphtha",
                config={
                    "setpoints": [
                        {"tag": "2FI422.SP",    "name": "Steam flow",  "unit": "kg/h", "min": 2500, "max": 3500, "nominal": 3000},
                        {"tag": "2TI1_414.SP",  "name": "Reflux temp", "unit": "°C",   "min": 68,   "max": 80,   "nominal": 74},
                        {"tag": "2TIC403.SP",   "name": "Bottom temp", "unit": "°C",   "min": 88,   "max": 100,  "nominal": 94},
                    ],
                    "kpis": ["energy", "purity", "butane"],
                    "purity_min": 95.0,
                },
            ))
            logger.info("✓ DC4 Debutanizer column seeded")

        # ── Test accounts for all roles ───────────────────────────────────────
        TEST_USERS = [
            {"username": "company_admin",  "password": "Admin1234!",   "role": models.UserRole.COMPANY_ADMIN},
            {"username": "engineer1",      "password": "Engineer123!",  "role": models.UserRole.ENGINEER},
            {"username": "operator1",      "password": "Operator123!",  "role": models.UserRole.OPERATOR},
            {"username": "viewer1",        "password": "Viewer1234!",   "role": models.UserRole.VIEWER},
        ]
        for tu in TEST_USERS:
            if not db.query(models.User).filter_by(username=tu["username"]).first():
                u = models.User(
                    username        = tu["username"],
                    hashed_password = auth.get_password_hash(tu["password"]),
                    role            = tu["role"],
                    company_id      = demo.id,
                )
                db.add(u)
                logger.info(f"✓ Test user seeded: {tu['username']} ({tu['role'].value})")

        db.commit()
    finally:
        db.close()


# ── Audit log helper ───────────────────────────────────────────────────────────
def write_audit(
    db: Session,
    action: str,
    user: models.User | None = None,
    endpoint: str | None = None,
    detail: dict | None = None,
    ip: str | None = None,
    status_code: int | None = None,
):
    entry = models.AuditLog(
        username    = user.username if user else None,
        user_id     = user.id       if user else None,
        role        = user.role     if user else None,
        action      = action,
        endpoint    = endpoint,
        detail      = detail,
        ip_address  = ip,
        status_code = status_code,
    )
    db.add(entry)
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning(f"Audit log write failed: {e}")


# ── Lifespan ───────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    try:
        seed_db()
    except Exception as seed_err:
        # Never let a seed failure stop the ingestion loop.
        # The DB tables exist; data will still flow even without demo users.
        logger.error(f"⚠ seed_db failed (non-fatal): {seed_err}", exc_info=True)
    from app.ingestion import ingestion_loop
    task = asyncio.create_task(ingestion_loop())
    logger.info("✓ OPTIQ DSS started — ingestion loop running")
    yield
    task.cancel()


# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title       = "OPTIQ DSS API",
    description = "Decision Support System for process optimisation",
    version     = "2.0.0",
    lifespan    = lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)


# ── Health ─────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "service": "optiq", "version": "2.0.0"}


# ── WebSocket stream ────────────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = ""):
    """
    Real-time prediction + alert stream.
    Connect with:  wss://your-backend/ws?token=<jwt>
    Messages pushed:
      { type: 'new_prediction', energy, purity, butane, stability, tags, timestamp }
      { type: 'new_alert', alert: {...} }
    """
    # Optional auth — reject if token provided but invalid
    if token:
        payload = auth.decode_token(token)
        if not payload:
            await websocket.close(code=4401)
            return
    await ws_manager.connect(websocket)
    try:
        while True:
            # Keep connection alive; ingestion loop does the broadcasting
            await asyncio.sleep(30)
            await websocket.send_json({"type": "ping"})
    except (WebSocketDisconnect, Exception):
        ws_manager.disconnect(websocket)


# ── Auth ───────────────────────────────────────────────────────────────────────
@app.post("/token", response_model=schemas.Token, tags=["auth"])
async def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(dependencies.get_db),
):
    user = db.query(models.User).filter_by(username=form_data.username).first()
    if not user or not auth.verify_password(form_data.password, user.hashed_password):
        write_audit(db, "LOGIN_FAILED", endpoint="POST /token",
                    detail={"username": form_data.username},
                    ip=request.client.host if request.client else None,
                    status_code=401)
        raise HTTPException(status_code=401, detail="Incorrect username or password")

    token = auth.create_access_token(data={"sub": user.username})
    write_audit(db, "LOGIN", user=user, endpoint="POST /token",
                ip=request.client.host if request.client else None, status_code=200)
    return {"access_token": token, "token_type": "bearer"}


@app.get("/users/me", response_model=schemas.UserOut, tags=["auth"])
def read_me(current_user=Depends(dependencies.get_current_user)):
    return current_user


@app.post("/users", response_model=schemas.UserOut, tags=["auth"])
def create_user(
    request: Request,
    user_in: schemas.UserCreate,
    db: Session = Depends(dependencies.get_db),
    current_user=Depends(dependencies.require_company_admin),
):
    if db.query(models.User).filter_by(username=user_in.username).first():
        raise HTTPException(status_code=400, detail="Username already exists")
    user = models.User(
        username        = user_in.username,
        hashed_password = auth.get_password_hash(user_in.password),
        role            = models.UserRole(user_in.role),
        company_id      = user_in.company_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    write_audit(db, "CREATE_USER", user=current_user, endpoint="POST /users",
                detail={"new_user": user_in.username, "role": user_in.role},
                ip=request.client.host if request.client else None, status_code=200)
    return user


@app.get("/users", response_model=list[schemas.UserOut], tags=["auth"])
def list_users(
    db: Session = Depends(dependencies.get_db),
    current_user=Depends(dependencies.require_company_admin),
):
    """List users. Company admins see only their company's users; system admins see all."""
    q = db.query(models.User)
    if current_user.role == models.UserRole.COMPANY_ADMIN:
        q = q.filter_by(company_id=current_user.company_id)
    return q.all()


@app.delete("/users/{user_id}", status_code=204, tags=["auth"])
def delete_user(
    request: Request,
    user_id: int,
    db: Session = Depends(dependencies.get_db),
    current_user=Depends(dependencies.require_company_admin),
):
    """Delete a user. Cannot delete yourself or the last system_admin."""
    target = db.query(models.User).filter_by(id=user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Cannot delete yourself
    if target.id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")

    # Company admins can only delete users in their own company
    if (current_user.role == models.UserRole.COMPANY_ADMIN
            and target.company_id != current_user.company_id):
        raise HTTPException(status_code=403, detail="Cannot delete users outside your company")

    # Cannot delete a system_admin unless you are also a system_admin
    if (target.role == models.UserRole.SYSTEM_ADMIN
            and current_user.role != models.UserRole.SYSTEM_ADMIN):
        raise HTTPException(status_code=403, detail="Only system admins can delete other system admins")

    # Prevent deleting the very last system_admin
    if target.role == models.UserRole.SYSTEM_ADMIN:
        admin_count = db.query(models.User).filter_by(
            role=models.UserRole.SYSTEM_ADMIN, is_active=True
        ).count()
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last system admin")

    write_audit(db, "DELETE_USER", user=current_user, endpoint=f"DELETE /users/{user_id}",
                detail={"deleted_user": target.username, "role": target.role.value},
                ip=request.client.host if request.client else None, status_code=204)
    db.delete(target)
    db.commit()


# ── Prediction ─────────────────────────────────────────────────────────────────
@app.get("/predictions/latest", tags=["prediction"])
def get_latest_prediction(
    column_tag: str = "DC4",
    db: Session = Depends(dependencies.get_db),
    _=Depends(dependencies.get_current_user),
):
    """
    Returns the most recent stored prediction as a WS-compatible dict
    (same shape as the 'new_prediction' WebSocket message).
    Used by the frontend as an HTTP fallback when WS is unavailable.
    """
    from app.ingestion import DC4_TAG_MAP

    pred = (
        db.query(models.Prediction)
        .filter_by(column_tag=column_tag)
        .order_by(models.Prediction.timestamp.desc())
        .first()
    )
    if not pred:
        raise HTTPException(status_code=404, detail="No predictions yet")

    # Reconstruct the tags dict from the stored readings list
    tags: dict = {}
    if pred.readings:
        for i, tag, *_ in DC4_TAG_MAP:
            if i < len(pred.readings):
                tags[tag] = round(float(pred.readings[i]), 3)

    return {
        "type":       "new_prediction",
        "timestamp":  pred.timestamp.isoformat(),
        "source":     pred.model_type,
        "energy":     pred.energy,
        "purity":     pred.purity,
        "butane":     pred.butane,
        "stability":  pred.stability,
        "is_outlier": pred.is_outlier,
        "model_type": pred.model_type,
        "readings":   pred.readings,
        "tags":       tags,
    }


@app.post("/predict", response_model=schemas.PredictionOut, tags=["prediction"])
def predict(
    data: schemas.SensorReadings,
    _=Depends(dependencies.get_current_user),
):
    return predict_energy_purity(data.readings)


# ── Optimisation ───────────────────────────────────────────────────────────────
@app.post("/optimize", response_model=schemas.OptimizeOut, tags=["prediction"])
def optimise(
    request: Request,
    data: schemas.OptimizeRequest,
    db: Session = Depends(dependencies.get_db),
    current_user=Depends(dependencies.get_current_user),
):
    """Find optimal setpoints. Stores result for apply-tracking and staleness checks."""
    result = optimize(
        current_state = data.current_state,
        base_readings = data.base_readings,
    )

    # Build process snapshot from base_readings or setpoints
    snapshot: dict = {}
    if data.base_readings:
        from app.alerts import COLUMN_ORDER
        for tag, idx in COLUMN_ORDER.items():
            if idx < len(data.base_readings):
                snapshot[tag] = data.base_readings[idx]
    else:
        for i, sp in enumerate(["2FI422.SP", "2TI1_414.SP", "2TIC403.SP"]):
            if i < len(data.current_state):
                snapshot[sp] = data.current_state[i]

    # Persist the recommendation
    opt_record = models.OptimizationResult(
        column_tag             = data.column_tag,
        requested_by_id        = current_user.id,
        requested_by_username  = current_user.username,
        process_snapshot       = snapshot,
        current_setpoints      = result.current_setpoints,
        recommended_setpoints  = result.recommended_setpoints,
        current_energy         = result.current_energy,
        expected_energy        = result.expected_energy,
        energy_savings_pct     = result.energy_savings_percent,
        current_purity         = result.current_purity,
        expected_purity        = result.expected_purity,
        purity_improvement_pct = result.purity_improvement_percent,
        status                 = result.status,
        feasibility_score      = result.feasibility_score,
    )
    db.add(opt_record)
    db.commit()
    db.refresh(opt_record)

    write_audit(db, "OPTIMIZE", user=current_user, endpoint="POST /optimize",
                detail={
                    "column_tag": data.column_tag,
                    "current_setpoints": data.current_state,
                    "energy_saving": result.energy_savings_percent,
                    "status": result.status,
                    "result_id": opt_record.id,
                },
                ip=request.client.host if request.client else None, status_code=200)

    # Return result enriched with DB id, timestamp, snapshot
    return schemas.OptimizeOut(
        result_id                  = opt_record.id,
        current_setpoints          = result.current_setpoints,
        recommended_setpoints      = result.recommended_setpoints,
        current_energy             = result.current_energy,
        expected_energy            = result.expected_energy,
        energy_savings_percent     = result.energy_savings_percent,
        current_purity             = result.current_purity,
        expected_purity            = result.expected_purity,
        purity_improvement_percent = result.purity_improvement_percent,
        current_butane             = result.current_butane,
        expected_butane            = result.expected_butane,
        butane_improvement_percent = result.butane_improvement_percent,
        status                     = result.status,
        feasibility_score          = result.feasibility_score,
        computed_at                = opt_record.requested_at,
        process_snapshot           = snapshot,
    )


@app.post("/recommendations/{result_id}/apply",
          response_model=schemas.ApplyRecommendationOut,
          tags=["prediction"])
def apply_recommendation(
    request: Request,
    result_id: int,
    db: Session = Depends(dependencies.get_db),
    current_user=Depends(dependencies.get_current_user),
):
    """
    Engineer confirms they have applied the recommended setpoints to the DCS.
    Records the application event with timestamp and user.
    """
    rec = db.query(models.OptimizationResult).get(result_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    if rec.applied:
        raise HTTPException(status_code=409, detail="Already marked as applied")

    rec.applied             = True
    rec.applied_at          = datetime.now(timezone.utc)
    rec.applied_by_id       = current_user.id
    rec.applied_by_username = current_user.username
    db.commit()

    write_audit(db, "APPLY_RECOMMENDATION", user=current_user,
                endpoint=f"POST /recommendations/{result_id}/apply",
                detail={
                    "result_id":             result_id,
                    "column_tag":            rec.column_tag,
                    "recommended_setpoints": rec.recommended_setpoints,
                    "energy_saving":         rec.energy_savings_pct,
                },
                ip=request.client.host if request.client else None, status_code=200)

    # Simulate 3-step process trajectory after applying
    simulation = []
    try:
        if rec.recommended_setpoints:
            simulation = simulate_after_apply(list(rec.recommended_setpoints))
    except Exception as sim_e:
        logger.warning(f"Apply simulation failed: {sim_e}")

    return schemas.ApplyRecommendationOut(
        result_id           = result_id,
        applied_at          = rec.applied_at,
        applied_by_username = current_user.username,
        simulation          = simulation,
    )


@app.post("/recommendations/drift-check",
          response_model=schemas.DriftCheckOut,
          tags=["prediction"])
def check_drift(
    data: schemas.DriftCheckRequest,
    db: Session = Depends(dependencies.get_db),
    _=Depends(dependencies.get_current_user),
):
    """
    Compare current process readings against the snapshot at recommendation time.
    Returns stale=True and drifted tags if any key variable has drifted > 5%.
    """
    rec = db.query(models.OptimizationResult).get(data.result_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    if not rec.process_snapshot:
        return schemas.DriftCheckOut(result_id=data.result_id, stale=False,
                                     max_drift_pct=0.0, drifted_tags=[],
                                     message="No snapshot available")

    DRIFT_THRESHOLD = 5.0  # percent
    drifted = []
    max_drift = 0.0

    for tag, original_val in rec.process_snapshot.items():
        if tag in data.current_readings and abs(original_val) > 0.01:
            current_val = data.current_readings[tag]
            drift_pct = abs(current_val - original_val) / abs(original_val) * 100
            if drift_pct > DRIFT_THRESHOLD:
                drifted.append(tag)
            max_drift = max(max_drift, drift_pct)

    stale = len(drifted) > 0
    return schemas.DriftCheckOut(
        result_id    = data.result_id,
        stale        = stale,
        max_drift_pct = round(max_drift, 2),
        drifted_tags = drifted,
        message      = (
            f"Process drifted on {len(drifted)} tags — recompute recommended"
            if stale else "Process state is stable"
        ),
    )


@app.get("/recommendations", response_model=list[schemas.OptimizationResultOut],
         tags=["prediction"])
def list_recommendations(
    limit: int = 50,
    column_tag: str | None = None,
    db: Session = Depends(dependencies.get_db),
    _=Depends(dependencies.get_current_user),
):
    q = db.query(models.OptimizationResult).order_by(
        models.OptimizationResult.requested_at.desc()
    )
    if column_tag:
        q = q.filter_by(column_tag=column_tag)
    return q.limit(limit).all()


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
    request: Request,
    alert_id: int,
    db: Session = Depends(dependencies.get_db),
    current_user=Depends(dependencies.get_current_user),
):
    alert = db.query(models.Alert).get(alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.acknowledged    = True
    alert.acknowledged_by = current_user.username
    db.commit()
    write_audit(db, "ACKNOWLEDGE_ALERT", user=current_user,
                endpoint=f"PATCH /alerts/{alert_id}/acknowledge",
                detail={"alert_id": alert_id, "tag_name": alert.tag_name},
                ip=request.client.host if request.client else None, status_code=200)
    return {"message": "Alert acknowledged"}


# ── Companies (system admin only) ──────────────────────────────────────────────
@app.get("/admin/companies", response_model=list[schemas.CompanyOut],
         tags=["admin"], dependencies=[Depends(dependencies.require_admin)])
def list_companies(db: Session = Depends(dependencies.get_db)):
    return db.query(models.Company).all()


@app.post("/admin/companies", response_model=schemas.CompanyOut,
          tags=["admin"])
def create_company(
    request: Request,
    company_in: schemas.CompanyCreate,
    db: Session = Depends(dependencies.get_db),
    current_user=Depends(dependencies.require_admin),
):
    if db.query(models.Company).filter_by(slug=company_in.slug).first():
        raise HTTPException(status_code=400, detail="Slug already exists")
    company = models.Company(**company_in.model_dump())
    db.add(company)
    db.commit()
    db.refresh(company)
    write_audit(db, "CREATE_COMPANY", user=current_user, endpoint="POST /admin/companies",
                detail={"slug": company_in.slug, "name": company_in.name},
                ip=request.client.host if request.client else None, status_code=200)
    return company


@app.put("/admin/companies/{company_id}", response_model=schemas.CompanyOut,
         tags=["admin"])
def update_company(
    request: Request,
    company_id: int,
    update: schemas.CompanyUpdate,
    db: Session = Depends(dependencies.get_db),
    current_user=Depends(dependencies.require_admin),
):
    company = db.query(models.Company).get(company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    for field, val in update.model_dump(exclude_none=True).items():
        setattr(company, field, val)
    db.commit()
    db.refresh(company)
    write_audit(db, "UPDATE_COMPANY", user=current_user,
                detail={"company_id": company_id},
                ip=request.client.host if request.client else None, status_code=200)
    return company


@app.delete("/admin/companies/{company_id}", tags=["admin"])
def delete_company(
    request: Request,
    company_id: int,
    db: Session = Depends(dependencies.get_db),
    current_user=Depends(dependencies.require_admin),
):
    company = db.query(models.Company).get(company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    db.delete(company)
    db.commit()
    write_audit(db, "DELETE_COMPANY", user=current_user,
                detail={"company_id": company_id},
                ip=request.client.host if request.client else None, status_code=204)
    return None


# ── Admin Config ───────────────────────────────────────────────────────────────
@app.get("/admin/config", tags=["admin"],
         dependencies=[Depends(dependencies.require_admin)])
def get_config(db: Session = Depends(dependencies.get_db)):
    rows = db.query(models.AppConfig).all()
    return {r.key: r.value for r in rows}


@app.post("/admin/config", tags=["admin"])
def set_config(
    request: Request,
    cfg_in: schemas.ConfigSet,
    db: Session = Depends(dependencies.get_db),
    current_user=Depends(dependencies.require_admin),
):
    row = db.query(models.AppConfig).filter_by(key=cfg_in.key).first()
    if row:
        row.value = str(cfg_in.value)
    else:
        row = models.AppConfig(key=cfg_in.key, value=str(cfg_in.value))
        db.add(row)
    db.commit()
    write_audit(db, "UPDATE_CONFIG", user=current_user,
                detail={"key": cfg_in.key, "value": cfg_in.value},
                ip=request.client.host if request.client else None, status_code=200)
    return {"key": cfg_in.key, "value": cfg_in.value}


# ── Audit Log ──────────────────────────────────────────────────────────────────
@app.get("/audit-log", response_model=list[schemas.AuditLogOut],
         tags=["audit"])
def get_audit_log(
    limit:    int = 200,
    offset:   int = 0,
    action:   Optional[str] = None,
    username: Optional[str] = None,
    db: Session = Depends(dependencies.get_db),
    _current_user=Depends(dependencies.require_company_admin),
):
    q = db.query(models.AuditLog).order_by(models.AuditLog.timestamp.desc())
    if action:
        q = q.filter(models.AuditLog.action == action)
    if username:
        q = q.filter(models.AuditLog.username.ilike(f"%{username}%"))
    return q.offset(offset).limit(limit).all()


# ── Sites ──────────────────────────────────────────────────────────────────────
@app.get("/sites", response_model=list[schemas.SiteOut], tags=["sites"])
def list_sites(
    company_id: Optional[int] = None,
    db: Session = Depends(dependencies.get_db),
    _cu=Depends(dependencies.get_current_user),
):
    q = db.query(models.Site).filter_by(is_active=True)
    if company_id:
        q = q.filter_by(company_id=company_id)
    return q.order_by(models.Site.name).all()


@app.post("/sites", response_model=schemas.SiteOut, tags=["sites"])
def create_site(
    request: Request,
    site_in: schemas.SiteCreate,
    db: Session = Depends(dependencies.get_db),
    current_user=Depends(dependencies.require_company_admin),
):
    # company_admin can only create sites under their own company
    if current_user.role == models.UserRole.COMPANY_ADMIN:
        if site_in.company_id != current_user.company_id:
            raise HTTPException(status_code=403, detail="Cannot create site for another company")
    site = models.Site(**site_in.model_dump())
    db.add(site)
    db.commit()
    db.refresh(site)
    write_audit(db, "CREATE_SITE", user=current_user,
                detail={"site_id": site.id, "name": site.name},
                ip=request.client.host if request.client else None, status_code=200)
    return site


@app.put("/sites/{site_id}", response_model=schemas.SiteOut, tags=["sites"])
def update_site(
    request: Request,
    site_id: int,
    update: schemas.SiteUpdate,
    db: Session = Depends(dependencies.get_db),
    current_user=Depends(dependencies.require_company_admin),
):
    site = db.query(models.Site).get(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    if current_user.role == models.UserRole.COMPANY_ADMIN and site.company_id != current_user.company_id:
        raise HTTPException(status_code=403, detail="Cannot modify site of another company")
    for field, val in update.model_dump(exclude_none=True).items():
        setattr(site, field, val)
    db.commit()
    db.refresh(site)
    write_audit(db, "UPDATE_SITE", user=current_user,
                detail={"site_id": site_id},
                ip=request.client.host if request.client else None, status_code=200)
    return site


@app.delete("/sites/{site_id}", status_code=204, tags=["sites"])
def delete_site(
    request: Request,
    site_id: int,
    db: Session = Depends(dependencies.get_db),
    current_user=Depends(dependencies.require_company_admin),
):
    site = db.query(models.Site).get(site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    if current_user.role == models.UserRole.COMPANY_ADMIN and site.company_id != current_user.company_id:
        raise HTTPException(status_code=403, detail="Cannot delete site of another company")
    db.delete(site)
    db.commit()
    write_audit(db, "DELETE_SITE", user=current_user,
                detail={"site_id": site_id},
                ip=request.client.host if request.client else None, status_code=204)
    return None


# ── Distillation Columns ───────────────────────────────────────────────────────
@app.get("/columns", response_model=list[schemas.ColumnOut], tags=["columns"])
def list_columns(
    site_id: Optional[int] = None,
    db: Session = Depends(dependencies.get_db),
    _cu=Depends(dependencies.get_current_user),
):
    q = db.query(models.DistillationColumn).filter_by(is_active=True)
    if site_id:
        q = q.filter_by(site_id=site_id)
    return q.order_by(models.DistillationColumn.sequence_order).all()


@app.get("/columns/{column_id}", response_model=schemas.ColumnOut, tags=["columns"])
def get_column(
    column_id: int,
    db: Session = Depends(dependencies.get_db),
    _cu=Depends(dependencies.get_current_user),
):
    col = db.query(models.DistillationColumn).get(column_id)
    if not col:
        raise HTTPException(status_code=404, detail="Column not found")
    return col


@app.post("/columns", response_model=schemas.ColumnOut, tags=["columns"])
def create_column(
    request: Request,
    col_in: schemas.ColumnCreate,
    db: Session = Depends(dependencies.get_db),
    current_user=Depends(dependencies.require_company_admin),
):
    # Verify site ownership for company_admin
    if current_user.role == models.UserRole.COMPANY_ADMIN:
        site = db.query(models.Site).get(col_in.site_id)
        if not site or site.company_id != current_user.company_id:
            raise HTTPException(status_code=403, detail="Cannot add column to site outside your company")
    col = models.DistillationColumn(**col_in.model_dump())
    db.add(col)
    db.commit()
    db.refresh(col)
    write_audit(db, "CREATE_COLUMN", user=current_user,
                detail={"column_id": col.id, "tag": col.tag, "name": col.name},
                ip=request.client.host if request.client else None, status_code=200)
    return col


@app.put("/columns/{column_id}", response_model=schemas.ColumnOut, tags=["columns"])
def update_column(
    request: Request,
    column_id: int,
    update: schemas.ColumnUpdate,
    db: Session = Depends(dependencies.get_db),
    current_user=Depends(dependencies.require_company_admin),
):
    col = db.query(models.DistillationColumn).get(column_id)
    if not col:
        raise HTTPException(status_code=404, detail="Column not found")
    if current_user.role == models.UserRole.COMPANY_ADMIN:
        site = db.query(models.Site).get(col.site_id)
        if not site or site.company_id != current_user.company_id:
            raise HTTPException(status_code=403, detail="Cannot modify column outside your company")
    for field, val in update.model_dump(exclude_none=True).items():
        setattr(col, field, val)
    db.commit()
    db.refresh(col)
    write_audit(db, "UPDATE_COLUMN", user=current_user,
                detail={"column_id": column_id},
                ip=request.client.host if request.client else None, status_code=200)
    return col


@app.delete("/columns/{column_id}", status_code=204, tags=["columns"])
def delete_column(
    request: Request,
    column_id: int,
    db: Session = Depends(dependencies.get_db),
    current_user=Depends(dependencies.require_company_admin),
):
    col = db.query(models.DistillationColumn).get(column_id)
    if not col:
        raise HTTPException(status_code=404, detail="Column not found")
    if current_user.role == models.UserRole.COMPANY_ADMIN:
        site = db.query(models.Site).get(col.site_id)
        if not site or site.company_id != current_user.company_id:
            raise HTTPException(status_code=403, detail="Cannot delete column outside your company")
    db.delete(col)
    db.commit()
    write_audit(db, "DELETE_COLUMN", user=current_user,
                detail={"column_id": column_id},
                ip=request.client.host if request.client else None, status_code=204)
    return None


# ── Statistics ─────────────────────────────────────────────────────────────────
@app.get("/stats", response_model=schemas.StatsOut, tags=["stats"])
def get_stats(
    column_tag:   str = "DC4",
    period_hours: int = 24,
    db: Session = Depends(dependencies.get_db),
    _cu=Depends(dependencies.get_current_user),
):
    from datetime import datetime, timezone, timedelta
    from sqlalchemy import func
    cutoff = datetime.now(timezone.utc) - timedelta(hours=period_hours)

    pred_q = db.query(models.Prediction).filter(
        models.Prediction.column_tag == column_tag,
        models.Prediction.timestamp >= cutoff,
    )
    total_pred = pred_q.count()

    agg = pred_q.with_entities(
        func.avg(models.Prediction.energy).label("avg_e"),
        func.min(models.Prediction.energy).label("min_e"),
        func.max(models.Prediction.energy).label("max_e"),
        func.avg(models.Prediction.purity).label("avg_p"),
        func.min(models.Prediction.purity).label("min_p"),
        func.max(models.Prediction.purity).label("max_p"),
    ).first()

    opt_q = db.query(models.OptimizationResult).filter(
        models.OptimizationResult.column_tag == column_tag,
        models.OptimizationResult.requested_at >= cutoff,
    )
    total_opt = opt_q.count()
    total_applied = opt_q.filter(models.OptimizationResult.applied == True).count()

    # Average energy saving from applied recs
    applied_recs = opt_q.filter(models.OptimizationResult.applied == True).all()
    avg_saving = 0.0
    if applied_recs:
        savings = [r.energy_savings_pct for r in applied_recs if r.energy_savings_pct is not None]
        avg_saving = sum(savings) / len(savings) if savings else 0.0

    alert_q = db.query(models.Alert).filter(models.Alert.timestamp >= cutoff)
    total_alerts = alert_q.count()
    critical_alerts = alert_q.filter(models.Alert.severity == models.AlertSeverity.CRITICAL).count()

    def safe(v, default=0.0):
        return float(v) if v is not None else default

    return schemas.StatsOut(
        column_tag=column_tag,
        period_hours=period_hours,
        total_predictions=total_pred,
        avg_energy=safe(agg.avg_e if agg else None),
        min_energy=safe(agg.min_e if agg else None),
        max_energy=safe(agg.max_e if agg else None),
        avg_purity=safe(agg.avg_p if agg else None),
        min_purity=safe(agg.min_p if agg else None),
        max_purity=safe(agg.max_p if agg else None),
        total_optimizations=total_opt,
        total_applied=total_applied,
        avg_energy_saving=avg_saving,
        total_alerts=total_alerts,
        critical_alerts=critical_alerts,
    )


# ── Branding ───────────────────────────────────────────────────────────────────
@app.get("/branding/{slug}", response_model=schemas.CompanyOut, tags=["branding"])
def get_branding(slug: str, db: Session = Depends(dependencies.get_db)):
    company = db.query(models.Company).filter_by(slug=slug, is_active=True).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    return company
