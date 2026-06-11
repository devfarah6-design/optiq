/**
 * OPTIQ DSS · Audit Log Page
 * Timestamped history of every significant action in OPTIQ.
 */
import React, { useState, useEffect, useCallback } from 'react'
import Sidebar from '@/components/Sidebar'
import { adminApi } from '@/api/client'
import type { AuditEntry } from '@/api/client'
import { useMobileNav } from '@/context/MobileNavContext'

// Colour map for action types
const ACTION_CONFIG: Record<string, { color: string; icon: string; label: string }> = {
  LOGIN:                  { color: 'var(--primary)', icon: '🔑', label: 'Login' },
  LOGIN_FAILED:           { color: 'var(--error)',   icon: '🚫', label: 'Login failed' },
  LOGOUT:                 { color: 'var(--text-low)',icon: '🚪', label: 'Logout' },
  OPTIMIZE:               { color: 'var(--accent)',  icon: '⚡', label: 'Optimise' },
  APPLY_RECOMMENDATION:   { color: 'var(--success)', icon: '✅', label: 'Apply rec.' },
  ACKNOWLEDGE_ALERT:      { color: '#7C3AED',        icon: '🔔', label: 'Ack. alert' },
  CREATE_USER:            { color: 'var(--primary)', icon: '👤', label: 'Create user' },
  CREATE_COMPANY:         { color: 'var(--primary)', icon: '🏢', label: 'Create company' },
  UPDATE_COMPANY:         { color: 'var(--text-mid)',icon: '✏️', label: 'Update company' },
  DELETE_COMPANY:         { color: 'var(--error)',   icon: '🗑️', label: 'Delete company' },
  CREATE_SITE:            { color: 'var(--success)', icon: '🏭', label: 'Create site' },
  DELETE_SITE:            { color: 'var(--error)',   icon: '🗑️', label: 'Delete site' },
  CREATE_COLUMN:          { color: 'var(--success)', icon: '🔧', label: 'Create column' },
  UPDATE_COLUMN:          { color: 'var(--text-mid)',icon: '✏️', label: 'Update column' },
  DELETE_COLUMN:          { color: 'var(--error)',   icon: '🗑️', label: 'Delete column' },
}

const ACTIONS = ['ALL', ...Object.keys(ACTION_CONFIG)]

const AuditLog: React.FC = () => {
  const { toggle: toggleSidebar } = useMobileNav()
  const [entries,       setEntries]       = useState<AuditEntry[]>([])
  const [loading,       setLoading]       = useState(true)
  const [filterAction,  setFilterAction]  = useState('ALL')
  const [filterUser,    setFilterUser]    = useState('')
  const [expanded,      setExpanded]      = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await adminApi.getAuditLog({
        limit:    200,
        action:   filterAction !== 'ALL' ? filterAction : undefined,
        username: filterUser || undefined,
      })
      setEntries(res.data)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [filterAction, filterUser])

  useEffect(() => { load() }, [load])

  // Action summary counts
  const counts: Record<string, number> = {}
  for (const e of entries) {
    counts[e.action] = (counts[e.action] ?? 0) + 1
  }

  const toggleExpand = (id: number) =>
    setExpanded(prev => (prev === id ? null : id))

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
              <div className="font-display font-bold text-xl">Audit Log</div>
              <div className="text-xs text-muted">Complete action traceability · who did what, when</div>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={load}>↻ Refresh</button>
        </header>

        <main className="page-content">

          {/* Action summary chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.5rem' }}>
            {Object.entries(counts).map(([action, count]) => {
              const cfg = ACTION_CONFIG[action] ?? { color: 'var(--text-mid)', icon: '•', label: action }
              return (
                <button
                  key={action}
                  onClick={() => setFilterAction(filterAction === action ? 'ALL' : action)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '0.25rem 0.75rem',
                    borderRadius: 999,
                    background: filterAction === action ? `${cfg.color}22` : 'var(--navy)',
                    border: `1px solid ${filterAction === action ? cfg.color : 'var(--border)'}`,
                    color: cfg.color,
                    fontSize: '0.72rem', fontWeight: 600,
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  <span>{cfg.icon}</span>
                  <span>{cfg.label ?? action}</span>
                  <span style={{
                    background: 'rgba(255,255,255,0.12)',
                    borderRadius: 999,
                    padding: '0 5px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.65rem',
                  }}>{count}</span>
                </button>
              )
            })}
          </div>

          {/* Filters */}
          <div className="card mb-4" style={{ padding: '0.75rem 1rem' }}>
            <div style={{ display: 'flex', gap: '0.875rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Action</label>
                <select
                  className="input"
                  style={{ width: 'auto', minWidth: 160, fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}
                  value={filterAction}
                  onChange={e => setFilterAction(e.target.value)}
                >
                  {ACTIONS.map(a => (
                    <option key={a} value={a}>
                      {a === 'ALL' ? 'All actions' : (ACTION_CONFIG[a]?.label ?? a)}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>User</label>
                <input
                  className="input"
                  placeholder="Filter by username…"
                  style={{ width: 180, fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}
                  value={filterUser}
                  onChange={e => setFilterUser(e.target.value)}
                />
              </div>
              {(filterAction !== 'ALL' || filterUser) && (
                <button className="btn btn-ghost btn-sm"
                  onClick={() => { setFilterAction('ALL'); setFilterUser('') }}>
                  Clear filters
                </button>
              )}
              <div className="text-xs text-muted" style={{ marginLeft: 'auto' }}>
                {entries.length} entries
              </div>
            </div>
          </div>

          {/* Log table */}
          {loading ? (
            <div style={{ padding: '3rem', display: 'grid', placeItems: 'center' }}>
              <div className="spinner" style={{ width: 32, height: 32 }} />
            </div>
          ) : entries.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-low)' }}>
              No audit entries found
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 150 }}>Timestamp</th>
                      <th style={{ width: 120 }}>User</th>
                      <th style={{ width: 80 }}>Role</th>
                      <th>Action</th>
                      <th style={{ width: 80 }}>Code</th>
                      <th style={{ width: 36 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map(entry => {
                      const cfg = ACTION_CONFIG[entry.action] ?? { color: 'var(--text-mid)', icon: '•', label: entry.action }
                      const isExpanded = expanded === entry.id
                      return (
                        <React.Fragment key={entry.id}>
                          <tr
                            onClick={() => toggleExpand(entry.id)}
                            style={{ cursor: entry.detail ? 'pointer' : undefined }}
                          >
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-low)' }}>
                              {new Date(entry.timestamp).toLocaleString()}
                            </td>
                            <td style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                              {entry.username ?? <span style={{ color: 'var(--text-low)' }}>—</span>}
                            </td>
                            <td>
                              {entry.role && (
                                <span style={{
                                  fontFamily: 'var(--font-mono)', fontSize: '0.65rem',
                                  color: 'var(--primary)',
                                  background: 'rgba(var(--primary-rgb),0.1)',
                                  padding: '1px 6px', borderRadius: 999,
                                  textTransform: 'uppercase', letterSpacing: '0.06em',
                                }}>
                                  {entry.role}
                                </span>
                              )}
                            </td>
                            <td>
                              <div className="flex items-center gap-2">
                                <span>{cfg.icon}</span>
                                <span style={{ color: cfg.color, fontSize: '0.82rem', fontWeight: 600 }}>
                                  {cfg.label}
                                </span>
                                {entry.endpoint && (
                                  <span style={{
                                    fontSize: '0.65rem', fontFamily: 'var(--font-mono)',
                                    color: 'var(--text-low)',
                                  }}>
                                    {entry.endpoint}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td>
                              {entry.status_code != null && (
                                <span style={{
                                  fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
                                  color: entry.status_code < 300 ? 'var(--success)' :
                                         entry.status_code < 500 ? 'var(--warning)' : 'var(--error)',
                                }}>
                                  {entry.status_code}
                                </span>
                              )}
                            </td>
                            <td style={{ textAlign: 'center', color: 'var(--text-low)', fontSize: '0.7rem' }}>
                              {entry.detail ? (isExpanded ? '▲' : '▼') : ''}
                            </td>
                          </tr>

                          {/* Expanded detail row */}
                          {isExpanded && entry.detail && (
                            <tr>
                              <td colSpan={6} style={{ padding: '0.5rem 1rem 0.875rem 2.5rem' }}>
                                <pre style={{
                                  margin: 0,
                                  background: 'var(--navy)',
                                  border: '1px solid var(--border)',
                                  borderRadius: 'var(--r-md)',
                                  padding: '0.625rem 0.875rem',
                                  fontSize: '0.72rem',
                                  fontFamily: 'var(--font-mono)',
                                  color: 'var(--text-mid)',
                                  whiteSpace: 'pre-wrap',
                                  lineHeight: 1.6,
                                }}>
                                  {JSON.stringify(entry.detail, null, 2)}
                                </pre>
                                {entry.ip_address && (
                                  <div style={{ fontSize: '0.68rem', color: 'var(--text-low)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                                    IP: {entry.ip_address}
                                  </div>
                                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ textAlign: 'center', marginTop: '2rem', paddingBottom: '1rem' }}>
            <div className="optiq-badge"><span>OPTIQ</span> Industrial AI Platform · v2.0</div>
          </div>
        </main>
      </div>
    </div>
  )
}

export default AuditLog
)}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ textAlign: 'center', marginTop: '2rem', paddingBottom: '1rem' }}>
            <div className="optiq-badge"><span>OPTIQ</span> Industrial AI Platform · v2.0</div>
          </div>
        </main>
      </div>
    </div>
  )
}

export default AuditLog
