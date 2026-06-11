/**
 * OPTIQ DSS · Statistics Page
 * Process KPI analytics and optimization history
 */
import React, { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import { statsApi, recommendationApi, columnApi } from '@/api/client'
import type { ProcessStats, OptimizationRecord, DistillationColumn } from '@/api/client'
import { useBranding } from '@/branding/BrandingContext'
import { useMobileNav } from '@/context/MobileNavContext'

const PERIOD_OPTIONS = [
  { label: '6 h',  value: 6 },
  { label: '24 h', value: 24 },
  { label: '48 h', value: 48 },
  { label: '7 d',  value: 168 },
]

const Statistics: React.FC = () => {
  const { company } = useBranding()
  const primary = company?.primary_color ?? '#00D9FF'
  const { toggle: toggleSidebar } = useMobileNav()

  const [columns,    setColumns]    = useState<DistillationColumn[]>([])
  const [colTag,     setColTag]     = useState('DC4')
  const [period,     setPeriod]     = useState(24)
  const [stats,      setStats]      = useState<ProcessStats | null>(null)
  const [recs,       setRecs]       = useState<OptimizationRecord[]>([])
  const [loading,    setLoading]    = useState(true)

  // Load columns list
  useEffect(() => {
    columnApi.list().then(r => {
      const active = r.data.filter(c => c.is_active).sort((a, b) => a.sequence_order - b.sequence_order)
      setColumns(active)
      if (active.length > 0) setColTag(active[0].tag)
    }).catch(() => {})
  }, [])

  // Load stats + recommendations
  useEffect(() => {
    setLoading(true)
    Promise.all([
      statsApi.get(colTag, period),
      recommendationApi.list(colTag, 50),
    ]).then(([sRes, rRes]) => {
      setStats(sRes.data)
      setRecs(rRes.data)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [colTag, period])

  const applied   = recs.filter(r => r.applied)
  const notApplied = recs.filter(r => !r.applied)
  const applyRate  = recs.length > 0 ? (applied.length / recs.length * 100).toFixed(0) : '—'

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
              <div className="font-display font-bold text-xl">Statistics</div>
              <div className="text-xs text-muted">Process KPIs · Optimisation history · Apply tracking</div>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            {/* Column selector */}
            <select
              className="input"
              style={{ width: 'auto', minWidth: 140, fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
              value={colTag}
              onChange={e => setColTag(e.target.value)}
            >
              {columns.length > 0
                ? columns.map(c => <option key={c.tag} value={c.tag}>{c.name}</option>)
                : <option value="DC4">DC4 Debutanizer</option>
              }
            </select>
            {/* Period selector */}
            <div className="flex gap-1">
              {PERIOD_OPTIONS.map(p => (
                <button
                  key={p.value}
                  className={`btn btn-sm ${period === p.value ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setPeriod(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        <main className="page-content">
          {loading ? (
            <div style={{ padding: '4rem', display: 'grid', placeItems: 'center' }}>
              <div className="spinner" style={{ width: 36, height: 36 }} />
            </div>
          ) : !stats ? (
            <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-low)' }}>
              No data available for this period.
            </div>
          ) : (
            <>
              {/* KPI summary */}
              <div className="kpi-grid mb-6">
                <StatCard label="Avg Energy" value={stats.avg_energy.toFixed(4)} unit="kg/kg" color={primary} />
                <StatCard label="Avg Purity" value={`${stats.avg_purity.toFixed(2)}%`} unit="Butane quality" color="var(--accent)" />
                <StatCard label="Optimisations" value={String(stats.total_optimizations)} unit={`${applyRate}% applied`} color="var(--success)" />
                <StatCard label="Critical Alerts" value={String(stats.critical_alerts)} unit={`of ${stats.total_alerts} total`}
                  color={stats.critical_alerts > 0 ? 'var(--error)' : 'var(--success)'} />
              </div>

              {/* Energy + Purity ranges */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                <div className="card">
                  <div className="font-semibold mb-4">Energy Consumption (kg steam/kg butane)</div>
                  <RangeBar label="Min" value={stats.min_energy} min={0.5} max={5.0} color={primary} format={v => v.toFixed(4)} />
                  <RangeBar label="Avg" value={stats.avg_energy} min={0.5} max={5.0} color={primary} format={v => v.toFixed(4)} />
                  <RangeBar label="Max" value={stats.max_energy} min={0.5} max={5.0} color={primary} format={v => v.toFixed(4)} />
                  <div className="text-xs text-muted mt-3">{stats.total_predictions} readings in period</div>
                </div>

                <div className="card">
                  <div className="font-semibold mb-4">Product Purity (%)</div>
                  <RangeBar label="Min" value={stats.min_purity} min={80} max={100} color="var(--accent)" format={v => v.toFixed(2) + '%'} />
                  <RangeBar label="Avg" value={stats.avg_purity} min={80} max={100} color="var(--accent)" format={v => v.toFixed(2) + '%'} />
                  <RangeBar label="Max" value={stats.max_purity} min={80} max={100} color="var(--accent)" format={v => v.toFixed(2) + '%'} />
                  <div className="text-xs text-muted mt-3" style={{ color: stats.min_purity < 95 ? 'var(--error)' : undefined }}>
                    {stats.min_purity < 95 ? `⚠ Below 95% spec at minimum` : '✓ Above 95% spec throughout'}
                  </div>
                </div>
              </div>

              {/* Optimisation apply rate */}
              <div className="card mb-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="font-semibold">Optimisation Apply Rate</div>
                    <div className="text-xs text-muted">Recommendations confirmed applied by engineers</div>
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-mono)', fontSize: '1.8rem', fontWeight: 800,
                    color: 'var(--success)',
                  }}>
                    {applyRate}%
                  </div>
                </div>
                {/* Simple bar */}
                <div style={{ height: 10, borderRadius: 999, background: 'var(--border)', overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{
                    height: '100%',
                    width: `${recs.length > 0 ? (applied.length / recs.length * 100) : 0}%`,
                    background: `linear-gradient(90deg, var(--success), ${primary})`,
                    borderRadius: 999,
                    transition: 'width 0.6s var(--ease)',
                  }} />
                </div>
                <div className="flex justify-between text-xs text-muted">
                  <span>{applied.length} applied</span>
                  <span>{notApplied.length} pending / not applied</span>
                  <span>{recs.length} total</span>
                </div>
                {stats.avg_energy_saving > 0 && (
                  <div style={{
                    marginTop: 12, padding: '0.6rem 0.875rem',
                    background: 'rgba(0,232,122,0.06)',
                    border: '1px solid rgba(0,232,122,0.15)',
                    borderRadius: 'var(--r-md)',
                    fontSize: '0.8rem', color: 'var(--success)',
                  }}>
                    Avg energy saving across all recommendations: {stats.avg_energy_saving.toFixed(1)}%
                  </div>
                )}
              </div>

              {/* Recommendation history table */}
              <div className="card">
                <div className="font-semibold mb-4">Recent Optimisation History</div>
                {recs.length === 0 ? (
                  <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-low)' }}>
                    No optimisation records for this period
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>By</th>
                          <th>Energy saving</th>
                          <th>Purity gain</th>
                          <th>Status</th>
                          <th>Applied</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recs.map(r => (
                          <tr key={r.id}>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                              {new Date(r.requested_at).toLocaleString()}
                            </td>
                            <td style={{ fontSize: '0.82rem' }}>{r.requested_by_username}</td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--success)' }}>
                              {r.energy_savings_pct > 0 ? `-${r.energy_savings_pct.toFixed(1)}%` : 'Near opt.'}
                            </td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                              {r.purity_improvement_pct > 0.01 ? `+${r.purity_improvement_pct.toFixed(2)}%` : '—'}
                            </td>
                            <td>
                              <span className={`badge badge-${r.status === 'optimal' ? 'success' : r.status === 'warning' ? 'warning' : 'error'}`}>
                                {r.status}
                              </span>
                            </td>
                            <td>
                              {r.applied ? (
                                <div>
                                  <div className="badge badge-success" style={{ fontSize: '0.68rem' }}>✓ Applied</div>
                                  <div style={{ fontSize: '0.65rem', color: 'var(--text-low)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                                    {r.applied_by_username} · {r.applied_at ? new Date(r.applied_at).toLocaleTimeString() : ''}
                                  </div>
                                </div>
                              ) : (
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-low)' }}>—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          <div style={{ textAlign: 'center', marginTop: '2rem', paddingBottom: '1rem' }}>
            <div className="optiq-badge"><span>OPTIQ</span> Industrial AI Platform · v2.0</div>
          </div>
        </main>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const StatCard: React.FC<{
  label: string; value: string; unit: string; color?: string
}> = ({ label, value, unit, color = 'var(--primary)' }) => (
  <div className="kpi-card">
    <div className="kpi-label">{label}</div>
    <div className="kpi-value" style={{ color }}>{value}</div>
    <div className="kpi-unit">{unit}</div>
  </div>
)

const RangeBar: React.FC<{
  label: string; value: number; min: number; max: number
  color: string; format: (v: number) => string
}> = ({ label, value, min, max, color, format }) => {
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div className="flex justify-between items-center mb-1">
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{label}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', fontWeight: 600 }}>{format(value)}</span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--border)', overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: color, borderRadius: 999,
          transition: 'width 0.4s var(--ease)',
        }} />
      </div>
    </div>
  )
}

export default Statistics