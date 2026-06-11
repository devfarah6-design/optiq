/**
 * OPTIQ DSS · Process Chain Page
 * Visual fractionation train: chain of distillation columns in sequence.
 * Click a column → side panel with parameters and optimization.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from '@/components/Sidebar'
import { columnApi, predictApi, recommendationApi, siteApi, isCompanyAdmin, canOptimize } from '@/api/client'
import type { DistillationColumn, OptimizeResult, Prediction, Site } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
import { useBranding } from '@/branding/BrandingContext'
import { useMobileNav } from '@/context/MobileNavContext'

function getWsUrl(): string {
  const apiUrl = (import.meta as any).env?.VITE_API_URL as string | undefined
  if (apiUrl) return apiUrl.replace(/^http/, 'ws') + '/ws'
  return 'ws://localhost:8000/ws'
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  optimal:  '#00E87A',
  warning:  '#F59E0B',
  critical: '#FF3D5A',
  idle:     '#7A9BB5',
}

function staleness(computedAt: string | undefined): { label: string; orange: boolean } {
  if (!computedAt) return { label: '', orange: false }
  const mins = Math.floor((Date.now() - new Date(computedAt).getTime()) / 60000)
  if (mins < 5)  return { label: `${mins}m ago`, orange: false }
  if (mins < 15) return { label: `${mins}m ago`, orange: true }
  return { label: `${mins}m ago — may be stale`, orange: true }
}

// ── Column node component ──────────────────────────────────────────────────────
const ColumnNode: React.FC<{
  col: DistillationColumn
  selected: boolean
  hasRec: boolean
  recStatus?: string
  onClick: () => void
  primary: string
}> = ({ col, selected, hasRec, recStatus, onClick, primary }) => {
  const borderColor = selected
    ? primary
    : hasRec ? STATUS_COLOR[recStatus ?? 'idle'] : 'var(--border)'

  return (
    <div
      onClick={onClick}
      style={{
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        minWidth: 140,
      }}
    >
      {/* Column tower SVG */}
      <div style={{
        position: 'relative',
        width: 80,
        height: 120,
        filter: selected ? `drop-shadow(0 0 12px ${primary}88)` : undefined,
        transition: 'filter 0.2s',
      }}>
        <svg viewBox="0 0 80 120" width="80" height="120">
          {/* Main vessel */}
          <rect x="20" y="10" width="40" height="90" rx="8"
            fill="var(--navy)" stroke={borderColor} strokeWidth={selected ? 2.5 : 1.5} />
          {/* Trays */}
          {[30, 45, 60, 75].map(y => (
            <line key={y} x1="22" y1={y} x2="58" y2={y}
              stroke={borderColor} strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />
          ))}
          {/* Feed inlet */}
          <line x1="0" y1="55" x2="20" y2="55" stroke={borderColor} strokeWidth="2" />
          <polygon points="15,51 22,55 15,59" fill={borderColor} />
          {/* Overhead product */}
          <line x1="40" y1="10" x2="40" y2="0" stroke="#00D9FF" strokeWidth="2" />
          <circle cx="40" cy="0" r="3" fill="#00D9FF" />
          {/* Bottoms */}
          <line x1="40" y1="100" x2="40" y2="112" stroke="#F59E0B" strokeWidth="2" />
          <circle cx="40" cy="112" r="3" fill="#F59E0B" />
          {/* Status dot */}
          {hasRec && (
            <circle cx="62" cy="12" r="5"
              fill={STATUS_COLOR[recStatus ?? 'idle']} opacity="0.9" />
          )}
          {/* Column tag label */}
          <text x="40" y="58" textAnchor="middle" fontSize="10" fontWeight="bold"
            fill={borderColor} fontFamily="var(--font-mono)">{col.tag}</text>
        </svg>
      </div>

      {/* Name + product labels */}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontSize: '0.75rem', fontWeight: 700,
          color: selected ? primary : 'var(--text-hi)',
          lineHeight: 1.2, maxWidth: 130,
        }}>{col.name}</div>
        {col.product_name && (
          <div style={{ fontSize: '0.62rem', color: '#00D9FF', marginTop: 2 }}>
            ↑ {col.product_name}
          </div>
        )}
        {col.bottoms_name && (
          <div style={{ fontSize: '0.62rem', color: '#F59E0B' }}>
            ↓ {col.bottoms_name}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Connector arrow ────────────────────────────────────────────────────────────
const FlowArrow: React.FC<{ primary: string }> = ({ primary }) => (
  <div style={{
    display: 'flex', alignItems: 'center',
    padding: '0 4px', marginTop: -30,
    color: 'var(--text-low)',
  }}>
    <div style={{ height: 2, width: 48, background: `linear-gradient(90deg, ${primary}44, ${primary}88)` }} />
    <svg width="12" height="12" viewBox="0 0 12 12">
      <polygon points="0,0 12,6 0,12" fill={`${primary}88`} />
    </svg>
  </div>
)

// ── Setpoint table ─────────────────────────────────────────────────────────────
const SetpointRow: React.FC<{
  name: string; unit: string
  current: number; recommended?: number; min: number; max: number
}> = ({ name, unit, current, recommended, min, max }) => {
  const pct = ((current - min) / (max - min)) * 100

  return (
    <div style={{ marginBottom: '0.875rem' }}>
      <div className="flex justify-between items-center mb-1">
        <span style={{ fontSize: '0.78rem', color: 'var(--text-mid)' }}>{name}</span>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
          <span style={{ color: 'var(--text-hi)', fontWeight: 700 }}>
            {current.toFixed(1)}
          </span>
          {recommended !== undefined && Math.abs(recommended - current) > 0.1 && (
            <span style={{ color: 'var(--primary)', marginLeft: 8 }}>
              → {recommended.toFixed(1)} {unit}
            </span>
          )}
          {(recommended === undefined || Math.abs(recommended - current) <= 0.1) && (
            <span style={{ color: 'var(--text-low)', marginLeft: 4 }}>{unit}</span>
          )}
        </div>
      </div>
      {/* Range bar */}
      <div style={{
        height: 4, borderRadius: 999,
        background: 'var(--border)',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', left: 0, top: 0,
          width: `${Math.min(100, Math.max(0, pct))}%`,
          height: '100%',
          background: 'var(--primary)',
          borderRadius: 999,
          transition: 'width 0.4s var(--ease)',
        }} />
        {recommended !== undefined && Math.abs(recommended - current) > 0.1 && (
          <div style={{
            position: 'absolute', top: -1,
            left: `${Math.min(100, Math.max(0, ((recommended - min) / (max - min)) * 100))}%`,
            transform: 'translateX(-50%)',
            width: 6, height: 6,
            borderRadius: '50%',
            background: 'var(--accent)',
            border: '1px solid var(--bg)',
          }} />
        )}
      </div>
      <div className="flex justify-between mt-0.5">
        <span style={{ fontSize: '0.58rem', color: 'var(--text-low)', fontFamily: 'var(--font-mono)' }}>{min}</span>
        <span style={{ fontSize: '0.58rem', color: 'var(--text-low)', fontFamily: 'var(--font-mono)' }}>{max}</span>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
const ProcessChain: React.FC = () => {
  const { user } = useAuth()
  const { company } = useBranding()
  const primary = company?.primary_color ?? '#00D9FF'
  const { toggle: toggleSidebar } = useMobileNav()

  const [sites,          setSites]          = useState<Site[]>([])
  const [columns,        setColumns]        = useState<DistillationColumn[]>([])
  const [selectedCol,    setSelectedCol]    = useState<DistillationColumn | null>(null)
  const [recommendations, setRecommendations] = useState<Record<string, OptimizeResult>>({})
  const [loading,        setLoading]        = useState(true)
  const [optLoading,     setOptLoading]     = useState(false)
  const [applyLoading,   setApplyLoading]   = useState(false)
  const [toast,          setToast]          = useState<{ msg: string; ok: boolean } | null>(null)

  // Live prediction state
  const [livePred,   setLivePred]   = useState<Prediction | null>(null)
  const [wsStatus,   setWsStatus]   = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const wsRef = useRef<WebSocket | null>(null)

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  // ── Live prediction: WebSocket + HTTP fallback ─────────────────────────────
  const fetchLatest = useCallback(async () => {
    try {
      const res = await predictApi.latestFromDB()
      setLivePred(res.data as Prediction)
    } catch { /* no data yet */ }
  }, [])

  const connectWs = useCallback(() => {
    try {
      const ws = new WebSocket(getWsUrl())
      wsRef.current = ws
      setWsStatus('connecting')
      ws.onopen  = () => setWsStatus('connected')
      ws.onclose = () => { setWsStatus('disconnected'); setTimeout(connectWs, 4000) }
      ws.onerror = () => ws.close()
      ws.onmessage = ev => {
        try {
          const msg = JSON.parse(ev.data as string)
          if (msg.type === 'new_prediction') setLivePred(msg as Prediction)
        } catch { /* ignore */ }
      }
    } catch {
      setWsStatus('disconnected')
      setTimeout(connectWs, 4000)
    }
  }, [])

  useEffect(() => {
    fetchLatest()
    connectWs()
    return () => wsRef.current?.close()
  }, [connectWs, fetchLatest])

  useEffect(() => {
    if (wsStatus === 'connected') return
    const id = setInterval(fetchLatest, 5000)
    return () => clearInterval(id)
  }, [wsStatus, fetchLatest])

  // Load sites + columns on mount
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [sitesRes, colsRes] = await Promise.all([
          siteApi.list(),
          columnApi.list(),
        ])
        setSites(sitesRes.data)
        const sorted = colsRes.data
          .filter(c => c.is_active)
          .sort((a, b) => a.sequence_order - b.sequence_order)
        setColumns(sorted)
        if (sorted.length > 0) setSelectedCol(sorted[0])
      } catch (e) {
        console.error('Failed to load columns:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Fetch optimization for selected column
  const fetchOptimization = useCallback(async () => {
    if (!selectedCol) return
    setOptLoading(true)
    try {
      const sp = selectedCol.config?.setpoints
      const defaults = sp
        ? sp.map(s => s.nominal)
        : [3000.0, 74.0, 94.0]

      const res = await predictApi.optimize(defaults, selectedCol.tag)
      setRecommendations(prev => ({ ...prev, [selectedCol.tag]: res.data }))
      showToast(`Optimisation complete for ${selectedCol.name}`)
    } catch {
      showToast('Optimisation failed', false)
    } finally {
      setOptLoading(false)
    }
  }, [selectedCol])

  // Apply recommendation
  const applyRecommendation = useCallback(async () => {
    if (!selectedCol) return
    const rec = recommendations[selectedCol.tag]
    if (!rec?.result_id) { showToast('No recommendation to apply', false); return }
    setApplyLoading(true)
    try {
      await recommendationApi.apply(rec.result_id)
      showToast('✓ Recommendation confirmed as applied — logged')
      // Mark visually applied
      setRecommendations(prev => ({
        ...prev,
        [selectedCol.tag]: { ...prev[selectedCol.tag]!, result_id: undefined },
      }))
    } catch (e: any) {
      showToast(e?.response?.data?.detail ?? 'Apply failed', false)
    } finally {
      setApplyLoading(false)
    }
  }, [selectedCol, recommendations])

  const rec = selectedCol ? recommendations[selectedCol.tag] : null
  const stale = rec?.computed_at ? staleness(rec.computed_at) : { label: '', orange: false }

  const getSiteName = (siteId: number) =>
    sites.find(s => s.id === siteId)?.name ?? `Site ${siteId}`

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-content">

        {/* Topbar */}
        <header className="topbar">
          <div className="flex items-center gap-3">
            <button className="btn-icon mobile-only" onClick={toggleSidebar} aria-label="Menu">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
            <div>
              <div className="font-display font-bold text-xl">Process Chain</div>
              <div className="text-xs text-muted">
                Fractionation train · {columns.length} active column{columns.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>
          <div className="text-xs text-lo desktop-only">{user?.username} · {user?.role}</div>
        </header>

        <main className="page-content">

          {loading ? (
            <div style={{ padding: '4rem', display: 'grid', placeItems: 'center' }}>
              <div className="spinner" style={{ width: 36, height: 36 }} />
            </div>
          ) : columns.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-low)' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🏭</div>
              <div className="font-semibold mb-2">No columns configured</div>
              <div className="text-sm text-muted">
                {isCompanyAdmin(user)
                  ? 'Go to Admin → Sites to add distillation columns to this site.'
                  : 'Contact your administrator to configure columns for this site.'
                }
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '1.5rem' }}>

              {/* ── Left: Chain visualization ─────────────────────────────── */}
              <div>
                {/* Feed label */}
                <div className="card mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold">Fractionation Train</div>
                    <div className="text-xs text-muted">Click a column to inspect &amp; optimise</div>
                  </div>

                  {/* Feed entry */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 0,
                    padding: '2rem 1.5rem',
                    overflowX: 'auto',
                  }}>
                    {/* Raw feed arrow */}
                    <div style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      justifyContent: 'center', paddingRight: 8, marginTop: -16,
                    }}>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-low)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                        Raw feed
                      </div>
                      <div style={{
                        height: 2, width: 56,
                        background: `linear-gradient(90deg, transparent, ${primary}88)`,
                      }} />
                      <svg width="12" height="12" viewBox="0 0 12 12" style={{ marginTop: -1 }}>
                        <polygon points="0,0 12,6 0,12" fill={`${primary}88`} />
                      </svg>
                    </div>

                    {columns.map((col, idx) => (
                      <React.Fragment key={col.id}>
                        <ColumnNode
                          col={col}
                          selected={selectedCol?.id === col.id}
                          hasRec={!!recommendations[col.tag]}
                          recStatus={recommendations[col.tag]?.status}
                          onClick={() => setSelectedCol(col)}
                          primary={primary}
                        />
                        {idx < columns.length - 1 && (
                          <FlowArrow primary={primary} />
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                {/* Column info cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.875rem' }}>
                  {columns.map(col => {
                    const r = recommendations[col.tag]
                    return (
                      <div
                        key={col.id}
                        className="card"
                        onClick={() => setSelectedCol(col)}
                        style={{
                          cursor: 'pointer',
                          borderColor: selectedCol?.id === col.id ? primary : 'var(--border)',
                          borderWidth: selectedCol?.id === col.id ? 2 : 1,
                          transition: 'border-color 0.2s',
                        }}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <div style={{
                            width: 8, height: 8, borderRadius: '50%',
                            background: r ? STATUS_COLOR[r.status] : 'var(--text-low)',
                          }} />
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: primary }}>
                            {col.tag}
                          </span>
                        </div>
                        <div className="font-semibold text-sm mb-1">{col.name}</div>
                        <div className="text-xs text-muted">
                          {getSiteName(col.site_id)} · Seq {col.sequence_order}
                        </div>
                        {col.description && (
                          <div className="text-xs text-lo mt-1" style={{
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {col.description}
                          </div>
                        )}
                        {r && (
                          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                            <div style={{ fontSize: '0.7rem', color: STATUS_COLOR[r.status] }}>
                              {r.energy_savings_percent > 0
                                ? `↓ ${r.energy_savings_percent.toFixed(1)}% energy`
                                : 'Near optimal'}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* ── Right: Detail / optimization panel ────────────────────── */}
              <div>
                {selectedCol ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                    {/* Column header */}
                    <div className="card">
                      <div className="flex items-start gap-3">
                        <div style={{
                          width: 44, height: 44, borderRadius: 10,
                          background: `rgba(var(--primary-rgb),0.1)`,
                          border: `1px solid ${primary}44`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontFamily: 'var(--font-mono)', fontWeight: 800,
                          fontSize: '0.85rem', color: primary, flexShrink: 0,
                        }}>
                          {selectedCol.tag}
                        </div>
                        <div>
                          <div className="font-semibold text-base">{selectedCol.name}</div>
                          <div className="text-xs text-muted">{getSiteName(selectedCol.site_id)}</div>
                          {selectedCol.description && (
                            <div className="text-xs text-lo mt-1">{selectedCol.description}</div>
                          )}
                        </div>
                      </div>

                      {/* Product flows */}
                      {(selectedCol.product_name || selectedCol.bottoms_name || selectedCol.feed_from) && (
                        <div style={{
                          marginTop: 12, paddingTop: 12,
                          borderTop: '1px solid var(--border)',
                          display: 'flex', flexDirection: 'column', gap: 4,
                          fontSize: '0.75rem',
                        }}>
                          {selectedCol.feed_from && (
                            <div className="flex items-center gap-2">
                              <span style={{ color: 'var(--text-low)' }}>Feed from:</span>
                              <span style={{ color: primary, fontFamily: 'var(--font-mono)' }}>{selectedCol.feed_from}</span>
                            </div>
                          )}
                          {selectedCol.product_name && (
                            <div className="flex items-center gap-2">
                              <span style={{ color: 'var(--text-low)' }}>Overhead:</span>
                              <span style={{ color: '#00D9FF' }}>{selectedCol.product_name}</span>
                            </div>
                          )}
                          {selectedCol.bottoms_name && (
                            <div className="flex items-center gap-2">
                              <span style={{ color: 'var(--text-low)' }}>Bottoms:</span>
                              <span style={{ color: '#F59E0B' }}>{selectedCol.bottoms_name}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* ── Live process KPIs ─────────────────────────────── */}
                    <div className="card">
                      <div className="flex items-center justify-between mb-3">
                        <div className="font-semibold text-sm">Live Process State</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            width: 7, height: 7, borderRadius: '50%',
                            background: wsStatus === 'connected' ? 'var(--success)' : wsStatus === 'connecting' ? 'var(--warning)' : 'var(--error)',
                            display: 'inline-block',
                            animation: wsStatus === 'connecting' ? 'pulse-dot 1s ease-in-out infinite' : undefined,
                          }} />
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-low)', fontFamily: 'var(--font-mono)' }}>
                            {wsStatus === 'connected' ? 'LIVE' : wsStatus === 'connecting' ? 'connecting…' : 'HTTP poll'}
                          </span>
                        </div>
                      </div>

                      {livePred ? (
                        <div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem', marginBottom: '0.75rem' }}>
                            <KpiBox
                              label="Energy Consumption"
                              value={livePred.energy.toFixed(2)}
                              unit="kg stm/kg"
                              ok={livePred.energy > 100 && livePred.energy < 3000}
                            />
                            <KpiBox
                              label="Butane Purity"
                              value={livePred.purity.toFixed(2)}
                              unit="%"
                              ok={livePred.purity >= 90}
                              warn={livePred.purity >= 80 && livePred.purity < 90}
                            />
                            <KpiBox
                              label="Butane Flow"
                              value={livePred.butane?.toFixed(3) ?? '—'}
                              unit="kg/h"
                              ok
                            />
                            <KpiBox
                              label="Process Stability"
                              value={(livePred.stability * 100).toFixed(1)}
                              unit="%"
                              ok={livePred.stability > 0.7}
                              warn={livePred.stability > 0.5 && livePred.stability <= 0.7}
                            />
                          </div>

                          {/* Live tag readings */}
                          {livePred.tags && Object.keys(livePred.tags).length > 0 && (
                            <div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-low)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                                Sensor Readings
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.25rem' }}>
                                {Object.entries(livePred.tags).slice(0, 10).map(([tag, val]) => (
                                  <div key={tag} style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '0.25rem 0.4rem',
                                    background: 'var(--navy)', borderRadius: 6,
                                    fontSize: '0.68rem',
                                  }}>
                                    <span style={{ color: 'var(--text-low)', fontFamily: 'var(--font-mono)' }}>{tag}</span>
                                    <span style={{ color: primary, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                                      {typeof val === 'number' ? val.toFixed(1) : val}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-low)', fontSize: '0.82rem', padding: '0.5rem 0' }}>
                          <div className="spinner" style={{ width: 14, height: 14 }} />
                          Waiting for first data point…
                        </div>
                      )}
                    </div>

                    {/* Setpoints */}
                    {selectedCol.config?.setpoints && (
                      <div className="card">
                        <div className="font-semibold mb-3 text-sm">Control Setpoints</div>
                        {selectedCol.config.setpoints.map((sp, idx) => (
                          <SetpointRow
                            key={sp.tag}
                            name={sp.name}
                            unit={sp.unit}
                            current={sp.nominal}
                            recommended={rec?.recommended_setpoints?.[idx]}
                            min={sp.min}
                            max={sp.max}
                          />
                        ))}
                      </div>
                    )}

                    {/* Optimization result */}
                    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-sm">AI Setpoint Advisor</div>
                          <div className="text-xs text-muted">Bayesian multi-objective optimisation</div>
                        </div>
                        {rec?.computed_at && (
                          <div style={{
                            fontSize: '0.68rem',
                            color: stale.orange ? '#F59E0B' : 'var(--text-low)',
                            fontFamily: 'var(--font-mono)',
                          }}>
                            {stale.orange && '⚠ '}{stale.label}
                          </div>
                        )}
                      </div>

                      {/* Staleness warning */}
                      {stale.orange && (
                        <div style={{
                          padding: '0.6rem 0.875rem',
                          background: 'rgba(245,158,11,0.08)',
                          border: '1px solid rgba(245,158,11,0.25)',
                          fontSize: '0.78rem',
                          color: '#F59E0B',
                        }}>
                          ⚠ Process state may have changed — recompute recommended
                        </div>
                      )}

                      {rec ? (
                        <div>
                          <div className={`badge badge-${
                            rec.status === 'optimal' ? 'success' :
                            rec.status === 'warning' ? 'warning' : 'error'
                          } mb-3`}>
                            {rec.status.toUpperCase()}
                          </div>

                          {/* Before / After comparison */}
                          <div style={{ marginBottom: '0.875rem' }}>
                            <div style={{
                              display: 'grid', gridTemplateColumns: '1fr auto 1fr',
                              gap: '0.5rem', alignItems: 'center',
                            }}>
                              <div style={{
                                background: 'rgba(255,61,90,0.06)', border: '1px solid rgba(255,61,90,0.18)',
                                borderRadius: 'var(--r-md)', padding: '0.625rem',
                              }}>
                                <div style={{ fontSize: '0.62rem', color: 'var(--text-low)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Before</div>
                                <CompRow label="Energy" value={rec.current_energy.toFixed(2)} unit="kg stm/kg" />
                                <CompRow label="Purity" value={rec.current_purity.toFixed(2)} unit="%" />
                                <CompRow label="Butane" value={(rec.current_butane ?? 0).toFixed(3)} unit="kg/h" />
                              </div>
                              <div style={{ textAlign: 'center', color: 'var(--primary)', fontSize: '1.1rem' }}>→</div>
                              <div style={{
                                background: 'rgba(0,232,122,0.06)', border: '1px solid rgba(0,232,122,0.2)',
                                borderRadius: 'var(--r-md)', padding: '0.625rem',
                              }}>
                                <div style={{ fontSize: '0.62rem', color: 'var(--success)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>After</div>
                                <CompRow label="Energy" value={rec.expected_energy.toFixed(2)} unit="kg stm/kg" highlight />
                                <CompRow label="Purity" value={rec.expected_purity.toFixed(2)} unit="%" highlight />
                                <CompRow label="Butane" value={(rec.expected_butane ?? 0).toFixed(3)} unit="kg/h" highlight />
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                              {rec.energy_savings_percent > 0 && (
                                <span style={{
                                  background: 'rgba(0,232,122,0.12)', border: '1px solid rgba(0,232,122,0.3)',
                                  color: 'var(--success)', borderRadius: 999,
                                  padding: '0.2rem 0.6rem', fontSize: '0.72rem', fontWeight: 700,
                                }}>↓ {rec.energy_savings_percent.toFixed(1)}% energy</span>
                              )}
                              {rec.purity_improvement_percent > 0.01 && (
                                <span style={{
                                  background: 'rgba(0,217,255,0.1)', border: '1px solid rgba(0,217,255,0.25)',
                                  color: primary, borderRadius: 999,
                                  padding: '0.2rem 0.6rem', fontSize: '0.72rem', fontWeight: 700,
                                }}>↑ {rec.purity_improvement_percent.toFixed(2)}% purity</span>
                              )}
                              {rec.energy_savings_percent <= 0 && rec.purity_improvement_percent <= 0.01 && (
                                <span style={{
                                  background: 'rgba(0,232,122,0.08)', border: '1px solid rgba(0,232,122,0.2)',
                                  color: 'var(--success)', borderRadius: 999,
                                  padding: '0.2rem 0.6rem', fontSize: '0.72rem', fontWeight: 600,
                                }}>✓ Already near-optimal</span>
                              )}
                            </div>
                          </div>

                          {rec.result_id && canOptimize(user) && (
                            <button
                              className="btn w-full mb-2"
                              style={{
                                background: 'rgba(0,232,122,0.12)',
                                border: '1px solid rgba(0,232,122,0.3)',
                                color: 'var(--success)',
                                fontWeight: 700, fontSize: '0.85rem',
                              }}
                              onClick={applyRecommendation}
                              disabled={applyLoading}
                            >
                              {applyLoading
                                ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Confirming…</>
                                : '✓ I Applied This Recommendation'
                              }
                            </button>
                          )}
                        </div>
                      ) : (
                        <div style={{
                          textAlign: 'center', padding: '1rem',
                          color: 'var(--text-low)', fontSize: '0.85rem',
                        }}>
                          Click below to run optimisation for this column
                        </div>
                      )}

                      <button
                        className="btn btn-primary w-full"
                        onClick={fetchOptimization}
                        disabled={optLoading || !canOptimize(user)}
                        title={!canOptimize(user) ? 'Viewer role — optimisation not available' : undefined}
                      >
                        {optLoading
                          ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Computing…</>
                          : '⚡ Run Optimisation'
                        }
                      </button>
                    </div>

                    {/* Column config details */}
                    {selectedCol.config && (
                      <div className="card">
                        <div className="font-semibold text-sm mb-2">Configuration</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-mid)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {selectedCol.config.purity_min && (
                            <div className="flex justify-between">
                              <span className="text-muted">Min purity constraint</span>
                              <span style={{ fontFamily: 'var(--font-mono)', color: primary }}>
                                ≥ {selectedCol.config.purity_min}%
                              </span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-muted">KPIs tracked</span>
                            <span style={{ color: 'var(--text-hi)' }}>
                              {selectedCol.config.kpis?.join(', ') ?? 'energy, purity'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted">Model</span>
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-hi)', fontSize: '0.7rem' }}>
                              {selectedCol.model_path ?? 'Default XGB+GRU'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-low)' }}>
                    Select a column from the chain to inspect it
                  </div>
                )}
              </div>
            </div>
          )}

          <div style={{ textAlign: 'center', marginTop: '2rem', paddingBottom: '1rem' }}>
            <div className="optiq-badge"><span>OPTIQ</span> Industrial AI Platform · v2.0</div>
          </div>
        </main>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '1.5rem', right: '1.5rem',
          background: toast.ok ? 'rgba(0,232,122,0.12)' : 'rgba(255,61,90,0.12)',
          border: `1px solid ${toast.ok ? 'rgba(0,232,122,0.3)' : 'rgba(255,61,90,0.3)'}`,
          color: toast.ok ? 'var(--success)' : 'var(--error)',
          borderRadius: 'var(--r-md)', padding: '0.75rem 1.25rem',
          fontSize: '0.875rem', fontWeight: 600, zIndex: 2000,
          animation: 'fadeUp 0.2s var(--ease) both', maxWidth: 360,
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

// ── Live KPI box ───────────────────────────────────────────────────────────────
const KpiBox: React.FC<{
  label: string; value: string; unit: string
  ok?: boolean; warn?: boolean
}> = ({ label, value, unit, ok, warn }) => {
  const color = ok ? 'var(--success)' : warn ? '#F59E0B' : 'var(--error)'
  const bg    = ok ? 'rgba(0,232,122,0.06)' : warn ? 'rgba(245,158,11,0.06)' : 'rgba(255,61,90,0.06)'
  return (
    <div style={{ background: bg, borderRadius: 'var(--r-md)', padding: '0.5rem 0.625rem', border: `1px solid ${color}22` }}>
      <div style={{ fontSize: '0.6rem', color: 'var(--text-low)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', fontWeight: 700, color }}>{value}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--text-low)' }}>{unit}</span>
      </div>
    </div>
  )
}

// ── Before/After comparison row ────────────────────────────────────────────────
const CompRow: React.FC<{ label: string; value: string; unit: string; highlight?: boolean }> = ({ label, value, unit, highlight }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
    <span style={{ fontSize: '0.65rem', color: 'var(--text-low)' }}>{label}</span>
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', fontWeight: 600, color: highlight ? 'var(--success)' : 'var(--text-hi)' }}>
      {value} <span style={{ fontWeight: 400, fontSize: '0.62rem', color: 'var(--text-low)' }}>{unit}</span>
    </span>
  </div>
)

// ── Generic metric box ─────────────────────────────────────────────────────────
const MetricBox: React.FC<{ label: string; value: string; positive?: boolean }> = ({ label, value, positive }) => (
  <div style={{
    background: 'var(--navy)',
    borderRadius: 'var(--r-md)',
    padding: '0.5rem 0.625rem',
  }}>
    <div style={{ fontSize: '0.65rem', color: 'var(--text-low)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
      {label}
    </div>
    <div style={{
      fontFamily: 'var(--font-mono)', fontSize: '0.95rem', fontWeight: 700,
      color: positive ? 'var(--success)' : 'var(--text-hi)',
    }}>
      {value}
    </div>
  </div>
)

export default ProcessChain
