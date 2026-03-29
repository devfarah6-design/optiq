-- ──────────────────────────────────────────────────────────────
--  OPTIQ DSS  ·  Database Initialisation
--  Runs once when the Postgres container first starts.
-- ──────────────────────────────────────────────────────────────

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- The application's SQLAlchemy models will create the tables on
-- backend startup via create_all(). This script only enables the
-- extension so TimescaleDB features are available.

-- After tables are created by the ORM, you can convert the
-- predictions table into a hypertable with:
--   SELECT create_hypertable('predictions', 'timestamp', if_not_exists => TRUE);
-- This is called automatically in the app startup (see main.py).
