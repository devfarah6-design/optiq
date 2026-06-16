/**
 * OPTIQ DSS · Help & Documentation Page
 * Complete guide for all roles and all features.
 */
import React, { useState } from 'react'
import Sidebar from '@/components/Sidebar'
import { useMobileNav } from '@/context/MobileNavContext'
import { useAuth } from '@/auth/AuthContext'

// ── Section types ──────────────────────────────────────────────────────────────
interface Section {
  id:    string
  title: string
  role?: 'all' | 'admin' | 'company_admin' | 'engineer'
  content: React.ReactNode
}

const Help: React.FC = () => {
  const { toggle: toggleSidebar } = useMobileNav()
  const { user } = useAuth()
  const [active, setActive] = useState('overview')

  const sections: Section[] = [
    {
      id: 'overview', title: 'System Overview', role: 'all',
      content: (
        <div>
          <H2>What is OPTIQ?</H2>
          <P>OPTIQ is a data-driven Decision Support System (DSS) for industrial fractionation processes. It uses a trained XGBoost surrogate model to continuously predict process KPIs — energy consumption, butane purity, and stability — and recommends optimal setpoints to reduce energy use while maintaining product quality.</P>

          <H2>Architecture</H2>
          <Grid cols={3}>
            <InfoCard title="ML Surrogate Model">
              XGBoost trained on historical plant data. Predicts Energy (kg steam/kg butane), Purity (%), and Butane recovery every 10 seconds from 9 sensor lag features + 4 setpoint inputs.
            </InfoCard>
            <InfoCard title="Real-time Ingestion">
              Backend ingests sensor readings every 10 s, runs the model, stores predictions in PostgreSQL, and broadcasts via WebSocket to all connected clients.
            </InfoCard>
            <InfoCard title="Optimiser">
              Given the current process state, the optimizer explores the setpoint space to find the combination that minimises energy while keeping purity above 95%. Results are stored with a full process snapshot for traceability.
            </InfoCard>
          </Grid>

          <H2>Fractionation Train (DC4 Debutanizer)</H2>
          <P>The proof-of-concept column is the <strong>DC4 Butane Debutanizer</strong>. The Process Chain page shows the full sequential train. Click any column card to see its live KPIs, setpoints, and run optimisation. The system is designed to onboard additional columns (depropanizer, deethanizer) by training a new surrogate model for each.</P>

          <H2>Role Hierarchy</H2>
          <table className="data-table" style={{ marginTop: '1rem' }}>
            <thead><tr><th>Role</th><th>Permissions</th></tr></thead>
            <tbody>
              {[
                ['system_admin',  'Full access: create/delete companies, manage all users, all sites, all columns, view audit log, full config'],
                ['company_admin', 'Manage own company\'s sites, columns, and users. View all pages. Cannot create companies.'],
                ['engineer',      'Run optimisation, apply recommendations, acknowledge alerts, view all read-only pages.'],
                ['operator',      'View dashboard and monitoring, acknowledge alerts. Cannot run optimisation.'],
                ['viewer',        'Read-only access to dashboard and statistics.'],
              ].map(([role, desc]) => (
                <tr key={role}>
                  <td><RoleBadge role={role} /></td>
                  <td style={{ fontSize: '0.82rem', color: 'var(--text-mid)' }}>{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    },

    {
      id: 'dashboard', title: 'Dashboard', role: 'all',
      content: (
        <div>
          <H2>Dashboard — Real-time Process Monitor</H2>
          <P>The dashboard is the main screen. It shows live predictions, active alerts, and the AI optimisation panel.</P>

          <H2>Live KPI Cards</H2>
          <Grid cols={4}>
            <InfoCard title="Energy">kg steam / kg butane. Lower is better. Target: as low as possible while maintaining purity.</InfoCard>
            <InfoCard title="Purity">Butane product purity (%). Must stay above 95% spec. Alert fires if it drops below.</InfoCard>
            <InfoCard title="Butane">Butane recovery (%). High recovery means less product lost in bottoms.</InfoCard>
            <InfoCard title="Stability">Process stability index (0–1). Values below 0.5 indicate sensor drift or process upset.</InfoCard>
          </Grid>

          <H2>Connection Status</H2>
          <P>Top-right of the page shows the WebSocket status: <StatusTag color="var(--success)">Connected</StatusTag> for live stream or <StatusTag color="var(--warning)">Polling</StatusTag> for HTTP fallback every 5 s. The system automatically falls back to HTTP polling if the WebSocket drops and reconnects every 4 seconds.</P>

          <H2>Trend Chart</H2>
          <P>Shows the last 500 data points (approximately 83 minutes at 10 s intervals). The chart accumulates continuously as long as the browser tab is open — it does not reset on page reload.</P>

          <H2>Alerts Panel</H2>
          <P>Active alerts appear in the right panel sorted by severity (critical first). Engineers and above can click <strong>Acknowledge</strong> to mark an alert as resolved.</P>

          <H2>AI Recommendation Panel</H2>
          <Step n={1}>Click <strong>Update Recommendation</strong> to request optimised setpoints for the current process state.</Step>
          <Step n={2}>The panel shows Before and After values for Energy, Purity, and Butane, plus the three recommended setpoints with safe operating bounds.</Step>
          <Step n={3}>If conditions change significantly (more than 5% drift on any sensor) the panel turns amber and shows "Conditions changed — recompute". Click the button again to get a fresh recommendation.</Step>
          <Step n={4}>When the engineer physically applies the setpoints on the DCS/SCADA, click <strong>I Applied This Recommendation</strong>. This logs the action with a timestamp, records who applied it, and starts the FOPDT process tracking timers.</Step>
        </div>
      ),
    },

    {
      id: 'processchain', title: 'Process Chain', role: 'all',
      content: (
        <div>
          <H2>Process Chain — Fractionation Train Visualiser</H2>
          <P>The Process Chain page shows the complete sequential fractionation process. Each distillation column is displayed as a card with its current live KPIs.</P>

          <H2>Column Cards</H2>
          <P>Each card displays the column tag (e.g. DC4) and full name, live Energy, Purity, Butane, and Stability KPIs updated every 10 seconds, a status indicator (Optimal, Warning, or Critical), and the feed source upstream column tag.</P>

          <H2>Column Detail Panel</H2>
          <P>Click any column card to open its detail panel. This shows all current sensor tag readings, setpoint parameters with current values and safe operating bounds, the Run Optimisation button (engineer role and above), a Before/After comparison when a recommendation is available, and a staleness warning if the process has drifted since the recommendation was computed.</P>

          <H2>Adding Columns</H2>
          <P>Company admins can add new distillation columns via <strong>Admin → Columns → Add Column</strong>. Each column requires a tag, name, sequence order, site, and optionally a surrogate model path. Once added it appears in the Process Chain automatically.</P>
        </div>
      ),
    },

    {
      id: 'admin', title: 'Admin Panel', role: 'company_admin',
      content: (
        <div>
          <H2>Admin Panel — System Configuration</H2>
          <P>Accessible at <Code>/admin</Code>. Requires <RoleBadge role="company_admin" /> or <RoleBadge role="system_admin" />.</P>

          <H2>Companies Tab (system_admin only)</H2>
          <P>Create, edit, and delete companies. Each company has a slug (unique identifier), name, sector, branding colors, and logo. All company admins and users are scoped to one company.</P>
          <Step n={1}>Click <strong>Add Company</strong></Step>
          <Step n={2}>Fill in slug (URL-safe, e.g. <Code>sonatrach</Code>), name, sector, primary and accent colors</Step>
          <Step n={3}>Click Save. The company is now available to assign users and sites to.</Step>

          <H2>Sites Tab</H2>
          <P>Sites are physical plant locations within a company. A company can have multiple sites (e.g. Skikda plant, Arzew plant).</P>
          <Step n={1}>Click <strong>Add Site</strong></Step>
          <Step n={2}>Select the company (system_admin) — company admins see their company pre-selected</Step>
          <Step n={3}>Enter site name, location, and optional description</Step>

          <H2>Columns Tab</H2>
          <P>Distillation columns belong to a site. Each column in the fractionation train is registered here.</P>
          <table className="data-table" style={{ marginTop: '0.5rem' }}>
            <thead><tr><th>Field</th><th>Description</th></tr></thead>
            <tbody>
              {[
                ['Tag',            'Short process tag, e.g. DC4, DC3, C2. Used as identifier throughout the system.'],
                ['Name',           'Full display name, e.g. "DC4 Butane Debutanizer"'],
                ['Sequence Order', 'Position in the fractionation train (1 = first column, feed enters here)'],
                ['Feed From',      'Tag of the upstream column that feeds this one (leave blank for the first column)'],
                ['Product Name',   'Top product, e.g. "Butane"'],
                ['Bottoms Name',   'Bottom product, e.g. "C5+"'],
                ['Site',           'Which plant site this column belongs to'],
              ].map(([f, d]) => (
                <tr key={f}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{f}</td>
                  <td style={{ fontSize: '0.82rem', color: 'var(--text-mid)' }}>{d}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <H2>Users Tab</H2>
          <P>Create and manage user accounts. system_admin can create any role; company_admin can create engineer, operator, or viewer accounts within their company.</P>
          <Step n={1}>Click <strong>Add User</strong></Step>
          <Step n={2}>Enter username and password (minimum 8 characters recommended)</Step>
          <Step n={3}>Select role — see Role Hierarchy in Overview for what each role can do</Step>
          <Step n={4}>Assign the user to a company (system_admin can assign to any company)</Step>

          <H2>Config Tab</H2>
          <P>Runtime configuration values stored in the database:</P>
          <table className="data-table" style={{ marginTop: '0.5rem' }}>
            <thead><tr><th>Key</th><th>Default</th><th>Effect</th></tr></thead>
            <tbody>
              {[
                ['ingestion_interval_sec', '10',  'How often the backend reads sensors and runs the model (seconds)'],
                ['alert_energy_threshold', '2.5', 'Energy value above which a warning alert fires'],
                ['alert_purity_min',       '90',  'Purity value below which a warning alert fires'],
              ].map(([k, d, e]) => (
                <tr key={k}>
                  <td><Code>{k}</Code></td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{d}</td>
                  <td style={{ fontSize: '0.82rem', color: 'var(--text-mid)' }}>{e}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    },

    {
      id: 'auditlog', title: 'Audit Log', role: 'company_admin',
      content: (
        <div>
          <H2>Audit Log — Complete Action Traceability</H2>
          <P>Every significant action in OPTIQ is recorded with: timestamp, username, role, action type, endpoint, HTTP status code, and a JSON detail payload containing the specific setpoints, column, and context data.</P>

          <H2>Actions Logged</H2>
          <table className="data-table" style={{ marginTop: '0.5rem' }}>
            <thead><tr><th>Action</th><th>When</th></tr></thead>
            <tbody>
              {[
                ['LOGIN',                                      'Successful login'],
                ['LOGIN_FAILED',                               'Failed login attempt (wrong password or user not found)'],
                ['LOGOUT',                                     'User logout'],
                ['OPTIMIZE',                                   'Engineer requests an optimisation'],
                ['APPLY_RECOMMENDATION',                       'Engineer clicks "I Applied This" — most important event'],
                ['ACKNOWLEDGE_ALERT',                          'Alert acknowledged'],
                ['CREATE_USER / DELETE_USER',                  'User account created or deleted'],
                ['CREATE_COMPANY / UPDATE_COMPANY / DELETE_COMPANY', 'Company management (system_admin)'],
                ['CREATE_SITE / DELETE_SITE',                  'Site created or deleted'],
                ['CREATE_COLUMN / UPDATE_COLUMN / DELETE_COLUMN', 'Column registered or modified'],
                ['UPDATE_CONFIG',                              'Runtime config value changed'],
              ].map(([a, w]) => (
                <tr key={a}>
                  <td><Code>{a}</Code></td>
                  <td style={{ fontSize: '0.82rem', color: 'var(--text-mid)' }}>{w}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <H2>Filtering</H2>
          <P>Use the <strong>Action</strong> dropdown and <strong>User</strong> text field at the top to filter entries. Click any summary chip (e.g. "Optimise 14") to quickly filter by that action type. Click any row to expand the full JSON detail payload.</P>

          <H2>Closing the Feedback Loop</H2>
          <P>The <Code>APPLY_RECOMMENDATION</Code> event is the most operationally valuable. The detail payload records exactly which setpoints were recommended and confirmed applied, enabling post-incident analysis of every optimisation decision made through the system.</P>
        </div>
      ),
    },

    {
      id: 'statistics', title: 'Statistics', role: 'all',
      content: (
        <div>
          <H2>Statistics — KPI Analytics and Optimisation History</H2>
          <P>The Statistics page aggregates process data over a selected time window (6 h, 24 h, 48 h, 7 days) for a selected column.</P>

          <H2>KPI Summary Cards</H2>
          <Grid cols={4}>
            <InfoCard title="Avg Energy">Mean energy consumption in the selected period</InfoCard>
            <InfoCard title="Avg Purity">Mean butane purity. Highlighted if the minimum dropped below 95%.</InfoCard>
            <InfoCard title="Optimisations">Total recommendations generated, with the apply rate percentage.</InfoCard>
            <InfoCard title="Critical Alerts">Number of critical alerts in the period. Green if zero.</InfoCard>
          </Grid>

          <H2>Energy and Purity Range Bars</H2>
          <P>Visual range bars show minimum, average, and maximum for both Energy and Purity. The purity section highlights in red if the minimum fell below the 95% specification at any point in the selected period.</P>

          <H2>Apply Rate</H2>
          <P>Shows the fraction of AI recommendations that were actually applied by engineers. A high apply rate indicates operators trust the system. The average energy saving from applied recommendations is shown below the bar.</P>

          <H2>Optimisation History Table</H2>
          <P>Full list of all recommendations in the period with energy saving, purity gain, status badge, and — if applied — who applied it and when. This links directly to the audit trail.</P>
        </div>
      ),
    },

    {
      id: 'monitoring', title: 'Monitoring', role: 'all',
      content: (
        <div>
          <H2>Monitoring — Live Sensor Tag Feed</H2>
          <P>The Monitoring page shows every raw sensor tag in real time. Use this page to verify individual instrument readings, identify stuck sensors, and monitor outlier scores.</P>

          <H2>What is Displayed</H2>
          <P>The page shows all sensor tag values at the latest ingestion cycle, outlier score (Z-score, flagged above 3.5), stuck sensor detection (highlighted if a tag does not change over multiple consecutive cycles), and the last update timestamp for each tag.</P>

          <H2>Alert Thresholds</H2>
          <P>Active alerts are shown with severity badges. Alerts are generated automatically by the ingestion engine when energy or purity breach the configured thresholds, or when a sensor outlier is detected.</P>
        </div>
      ),
    },

    {
      id: 'websocket', title: 'WebSocket & API', role: 'all',
      content: (
        <div>
          <H2>WebSocket Real-time Stream</H2>
          <P>Connect to: <Code>wss://optiq-backend.onrender.com/ws</Code></P>
          <P>JWT token is optional — pass as query parameter: <Code>?token=&lt;jwt&gt;</Code></P>
          <P>Message types pushed by the server:</P>
          <CodeBlock>{`// New prediction every ~10 seconds
{
  "type": "new_prediction",
  "energy": 1.342,
  "purity": 97.21,
  "butane": 12.4,
  "stability": 0.87,
  "timestamp": "2026-06-11T08:30:00Z",
  "tags": { "2FI422.SP": 45.2, "2TI1_414.SP": 92.1, ... }
}

// New alert when threshold breached
{ "type": "new_alert", "alert": { ... } }

// Keepalive every 30 seconds
{ "type": "ping" }`}</CodeBlock>

          <H2>REST API Reference</H2>
          <P>Full interactive API docs: <Code>https://optiq-backend.onrender.com/docs</Code></P>
          <table className="data-table" style={{ marginTop: '0.5rem' }}>
            <thead><tr><th>Method</th><th>Path</th><th>Auth</th><th>Description</th></tr></thead>
            <tbody>
              {[
                ['POST',           '/token',                          'none',           'Login — returns JWT'],
                ['GET',            '/users/me',                       'any',            'Current user info'],
                ['GET',            '/predictions/latest',             'any',            'Latest prediction from DB'],
                ['POST',           '/optimize',                       'engineer+',      'Run optimisation for a column'],
                ['POST',           '/recommendations/{id}/apply',     'engineer+',      '"I Applied It" button'],
                ['POST',           '/recommendations/drift-check',    'engineer+',      'Check if process drifted since recommendation'],
                ['GET',            '/recommendations',                'any',            'List optimisation history'],
                ['GET',            '/alerts',                         'any',            'List recent alerts'],
                ['PATCH',          '/alerts/{id}/acknowledge',        'operator+',      'Acknowledge an alert'],
                ['GET',            '/stats',                          'any',            'Process statistics for a period'],
                ['GET',            '/audit-log',                      'company_admin+', 'Full audit trail'],
                ['GET',            '/sites',                          'any',            'List sites'],
                ['GET',            '/columns',                        'any',            'List distillation columns'],
                ['POST/PUT/DELETE','/sites, /columns',                'company_admin+', 'Manage sites and columns'],
                ['GET/POST/PUT/DELETE', '/admin/companies',           'system_admin',   'Company management'],
                ['GET/POST',       '/admin/config',                   'system_admin',   'Runtime config'],
                ['GET',            '/branding/{slug}',                'none',           'Company branding (colors, logo)'],
              ].map(([m, p, a, d]) => (
                <tr key={p + m}>
                  <td><Code>{m}</Code></td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>{p}</td>
                  <td style={{ fontSize: '0.72rem', color: 'var(--text-low)' }}>{a}</td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-mid)' }}>{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    },

    {
      id: 'accounts', title: 'Test Accounts', role: 'all',
      content: (
        <div>
          <H2>Pre-seeded Test Accounts</H2>
          <P>The following accounts are created automatically on first startup. Change passwords before any production deployment.</P>
          <table className="data-table" style={{ marginTop: '0.5rem' }}>
            <thead><tr><th>Username</th><th>Password</th><th>Role</th><th>Company</th></tr></thead>
            <tbody>
              {[
                ['admin',         'Admin1234!',   'system_admin',  '—'],
                ['company_admin', 'Admin1234!',   'company_admin', 'Sonatrach LNG'],
                ['engineer1',     'Engineer123!', 'engineer',      'Sonatrach LNG'],
                ['operator1',     'Operator123!', 'operator',      'Sonatrach LNG'],
                ['viewer1',       'Viewer1234!',  'viewer',        'Sonatrach LNG'],
              ].map(([u, p, r, c]) => (
                <tr key={u}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{u}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{p}</td>
                  <td><RoleBadge role={r} /></td>
                  <td style={{ fontSize: '0.82rem', color: 'var(--text-low)' }}>{c}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <H2>URLs</H2>
          <table className="data-table" style={{ marginTop: '0.5rem' }}>
            <thead><tr><th>Service</th><th>URL</th></tr></thead>
            <tbody>
              {[
                ['Frontend',        'https://optiq-two.vercel.app'],
                ['Backend API',     'https://optiq-backend.onrender.com'],
                ['API Docs',        'https://optiq-backend.onrender.com/docs'],
              ].map(([label, url]) => (
                <tr key={label}>
                  <td style={{ fontSize: '0.82rem', color: 'var(--text-mid)' }}>{label}</td>
                  <td><Code>{url}</Code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    },
  ]

  const current = sections.find(s => s.id === active) ?? sections[0]

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-content">

        <header className="topbar">
          <div className="flex items-center gap-3">
            <button className="btn-icon mobile-only" onClick={toggleSidebar} aria-label="Menu">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
            <div>
              <div className="font-display font-bold text-xl">Help & Documentation</div>
              <div className="text-xs text-muted">OPTIQ DSS · Complete user guide · v2.0</div>
            </div>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-low)' }}>
            Logged in as <strong style={{ color: 'var(--primary)' }}>{user?.username}</strong>
            {user && <span style={{ marginLeft: 8 }}><RoleBadge role={user.role} /></span>}
          </div>
        </header>

        <main className="page-content" style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>

          {/* Left nav */}
          <nav className="card" style={{
            width: 200, flexShrink: 0, padding: '0.5rem 0',
            position: 'sticky', top: '1rem',
          }}>
            {sections.map(s => (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '0.5rem 1rem',
                  background: active === s.id ? 'rgba(var(--primary-rgb),0.10)' : 'transparent',
                  border: 'none',
                  borderLeft: active === s.id ? '2px solid var(--primary)' : '2px solid transparent',
                  color: active === s.id ? 'var(--primary)' : 'var(--text-mid)',
                  fontSize: '0.82rem', fontWeight: active === s.id ? 600 : 400,
                  cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                }}
              >
                <span>{s.title}</span>
                {s.role === 'company_admin' && (
                  <span style={{
                    fontSize: '0.6rem', color: 'var(--text-low)',
                    background: 'var(--navy)', padding: '1px 5px', borderRadius: 999,
                  }}>admin</span>
                )}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="card" style={{ flex: 1, minWidth: 0 }}>
            <div style={{ marginBottom: '1.25rem', paddingBottom: '0.875rem', borderBottom: '1px solid var(--border)' }}>
              <span className="font-display font-bold" style={{ fontSize: '1.15rem' }}>{current.title}</span>
            </div>
            <div style={{ lineHeight: 1.7 }}>
              {current.content}
            </div>
          </div>

        </main>

        <div style={{ textAlign: 'center', marginTop: '2rem', paddingBottom: '1rem' }}>
          <div className="optiq-badge"><span>OPTIQ</span> Industrial AI Platform · v2.0</div>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────
const H2: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2 style={{
    fontSize: '0.875rem', fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.06em', color: 'var(--text-low)',
    marginTop: '1.75rem', marginBottom: '0.6rem',
  }}>
    {children}
  </h2>
)

const P: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{ fontSize: '0.85rem', color: 'var(--text-mid)', marginBottom: '0.75rem', lineHeight: 1.7 }}>
    {children}
  </p>
)

const Grid: React.FC<{ cols: number; children: React.ReactNode }> = ({ cols, children }) => (
  <div style={{
    display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gap: '0.75rem', margin: '0.75rem 0 1.25rem',
  }}>
    {children}
  </div>
)

const InfoCard: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{
    background: 'var(--navy)', border: '1px solid var(--border)',
    borderLeft: '3px solid var(--primary)',
    borderRadius: 'var(--r-md)', padding: '0.875rem',
  }}>
    <div style={{ fontWeight: 700, fontSize: '0.82rem', marginBottom: '0.35rem', color: 'var(--text-high)' }}>{title}</div>
    <div style={{ fontSize: '0.78rem', color: 'var(--text-low)', lineHeight: 1.55 }}>{children}</div>
  </div>
)

const Step: React.FC<{ n: number; children: React.ReactNode }> = ({ n, children }) => (
  <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.5rem', alignItems: 'flex-start' }}>
    <div style={{
      width: 20, height: 20, borderRadius: '50%',
      background: 'var(--primary)', color: '#000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '0.68rem', fontWeight: 800, flexShrink: 0, marginTop: 3,
    }}>{n}</div>
    <div style={{ fontSize: '0.85rem', color: 'var(--text-mid)', lineHeight: 1.6 }}>{children}</div>
  </div>
)

const Code: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <code style={{
    fontFamily: 'var(--font-mono)', fontSize: '0.78rem',
    background: 'var(--navy)', border: '1px solid var(--border)',
    padding: '1px 6px', borderRadius: 4, color: 'var(--primary)',
  }}>{children}</code>
)

const CodeBlock: React.FC<{ children: string }> = ({ children }) => (
  <pre style={{
    background: 'var(--navy)', border: '1px solid var(--border)',
    borderRadius: 'var(--r-md)', padding: '0.875rem',
    fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
    color: 'var(--text-mid)', whiteSpace: 'pre-wrap', lineHeight: 1.6,
    margin: '0.75rem 0',
  }}>{children}</pre>
)

const StatusTag: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 5,
    fontSize: '0.75rem', fontWeight: 600,
    color, background: `${color}18`,
    border: `1px solid ${color}40`,
    padding: '1px 8px', borderRadius: 999,
  }}>
    <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
    {children}
  </span>
)

const ROLE_COLORS: Record<string, string> = {
  system_admin:  'var(--error)',
  company_admin: 'var(--warning)',
  engineer:      'var(--primary)',
  operator:      'var(--info, #60a5fa)',
  viewer:        'var(--text-low)',
  admin:         'var(--error)',
}

const RoleBadge: React.FC<{ role: string }> = ({ role }) => (
  <span style={{
    fontFamily: 'var(--font-mono)', fontSize: '0.65rem',
    color: ROLE_COLORS[role] ?? 'var(--primary)',
    background: `${ROLE_COLORS[role] ?? 'var(--primary)'}20`,
    border: `1px solid ${ROLE_COLORS[role] ?? 'var(--primary)'}40`,
    padding: '1px 7px', borderRadius: 999,
    textTransform: 'uppercase', letterSpacing: '0.06em',
  }}>
    {role.replace('_', ' ')}
  </span>
)

export default Help
