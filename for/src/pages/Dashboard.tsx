import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  PointElement, LineElement, Filler, Tooltip, Legend,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import Sidebar from '@/components/Sidebar'
import { alertApi, predictApi, recommendationApi, Alert, OptimizeResult, Prediction, SimulationStep, canOptimize } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
import { useBranding } from '@/branding/BrandingContext'
import { useMobileNav } from '@/context/MobileNavContext'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

function getWsUrl(): string {
  const apiUrl = (import.meta as any).env?.VITE_API_URL as string | undefined
  if (apiUrl) return apiUrl.replace(/^http/, 'ws') + '/ws'
  return 'ws://localhost:8000/ws'
}

interface DataPoint { ts: number; energy: number; purity: number }

// ── Staleness helpers ─────────────────────────────────────────────────────────
const DRIFT_THRESHOLD = 5.0  // percent

function computeDrift(
  snapshot: Record<string, number> | undefined,
  current: Record<string, number> | undefined,
): { stale: boolean; maxDrift: number; driftedTags: string[] } {
  if (!snapshot || !current) return { stale: false, maxDrift: 0, driftedTags: [] }
  const drifted: string[] = []
  let maxDrift = 0
  for (const [tag, original] of Object.entries(snapshot)) {
    if (!(tag in current) || Math.abs(original) < 0.01) continue
    const drift = Math.abs(current[tag] - original) / Math.abs(original) * 100
    maxDrift = Math.max(maxDrift, drift)
    if (drift > DRIFT_THRESHOLD) drifted.push(tag)
  }
  return { stale: drifted.length > 0, maxDrift, driftedTags: drifted }
}

function ageLabel(iso: string | undefined): { label: string; stale: boolean } {
  if (!iso) return { label: '', stale: false }
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 5)  return { label: `${mins}m ago`, stale: false }
  if (mins < 15) return { label: `${mins}m ago`, stale: true }
  return { label: `${mins}m ago — may be stale`, stale: true }
}

const Dashboard: React.FC = () => {
  const { user }       = useAuth()
  const { company }    = useBranding()
  const { toggle: toggleSidebar } = useMobileNav()
  const [current,        setCurrent]        = useState<Prediction | null>(null)
  const [history,        setHistory]        = useState<DataPoint[]>([])
  const [alerts,         setAlerts]         = useState<Alert[]>([])
  const [recommendation, setRecommendation] = useState<OptimizeResult | null>(null)
  const [optLoading,     setOptLoading]     = useState(false)
  const [applyLoading,   setApplyLoading]   = useState(false)
  const [applied,        setApplied]        = useState(false)
  const [simulation,     setSimulation]     = useState<SimulationStep[]>([])
  const [wsStatus,       setWsStatus]       = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [exportLoading,  setExportLoading]  = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  // ── HTTP fallback: apply a prediction payload (same shape as WS message) ──
  const applyPrediction = useCallback((p: any) => {
    setCurrent(p as Prediction)
    setHistory(prev => [
      ...prev.slice(-499),
      { ts: p.timestamp ? new Date(p.timestamp).getTime() : Date.now(), energy: p.energy, purity: p.purity },
    ])
  }, [])

  // ── Fetch latest prediction from DB (REST fallback) ────────────────────────
  const fetchLatest = useCallback(async () => {
    try {
      const res = await predictApi.latestFromDB()
      applyPrediction(res.data)
    } catch {
      // 404 = no data yet in DB; ignore silently
    }
  }, [applyPrediction])

  // ── WebSocket ──────────────────────────────────────────────────────────────
  const connect = useCallback(() => {
    const url = getWsUrl()
    try {
      const ws = new WebSocket(url)
      wsRef.current = ws
      setWsStatus('connecting')
      ws.onopen  = () => setWsStatus('connected')
      ws.onclose = () => { setWsStatus('disconnected'); setTimeout(connect, 4000) }
      ws.onerror = () => ws.close()
      ws.onmessage = ev => {
        try {
          const msg = JSON.parse(ev.data as string)
          if (msg.type === 'new_prediction') {
            applyPrediction(msg)
          } else if (msg.type === 'new_alert') {
            setAlerts(prev => [msg.alert as Alert, ...prev.slice(0, 49)])
          }
        } catch { /* ignore */ }
      }
    } catch {
      setWsStatus('disconnected')
      setTimeout(connect, 4000)
    }
  }, [applyPrediction])

  useEffect(() => {
    alertApi.list().then(r => setAlerts(r.data)).catch(() => {})
    // Always seed initial data from DB — covers cold starts before first WS message
    fetchLatest()
    connect()
    return () => { wsRef.current?.close() }
  }, [connect, fetchLatest])

  // ── HTTP polling fallback: when WS is down, poll every 5 s ────────────────
  useEffect(() => {
    if (wsStatus === 'connected') return
    const id = setInterval(fetchLatest, 5000)
    return () => clearInterval(id)
  }, [wsStatus, fetchLatest])

  // ── Staleness & drift ──────────────────────────────────────────────────────
  const age = ageLabel(recommendation?.computed_at)

  const currentReadings: Record<string, number> = {}
  if (current?.tags) Object.assign(currentReadings, current.tags)

  const drift = computeDrift(recommendation?.process_snapshot, currentReadings)

  const isStale = age.stale || drift.stale

  // ── Optimisation ──────────────────────────────────────────────────────────
  const fetchOptimization = async () => {
    setOptLoading(true)
    setApplied(false)
    setSimulation([])
    try {
      // Pass current OP readings as base_readings — new model uses OP values
      const currentSetpoints = [
        current?.tags?.['2TIC403.OP'] ?? 52.0,
        current?.tags?.['2FIC419.OP'] ?? 48.0,
        current?.tags?.['2LIC409.OP'] ?? 50.0,
        current?.tags?.['2LIC412.OP'] ?? 48.0,
      ]
      // Full readings vector for the model
      const baseReadings = current?.readings ?? (current?.tags ? Object.values(current.tags) : undefined)
      const res = await predictApi.optimize(currentSetpoints, 'DC4', baseReadings)
      setRecommendation(res.data)
    } catch (e) {
      console.error('Optimize failed:', e)
    } finally {
      setOptLoading(false)
    }
  }

  // ── Apply recommendation ──────────────────────────────────────────────────
  const applyRecommendation = async () => {
    if (!recommendation?.result_id) return
    setApplyLoading(true)
    try {
      const res = await recommendationApi.apply(recommendation.result_id)
      setApplied(true)
      if (res.data.simulation?.length) {
        setSimulation(res.data.simulation)
      }
      // Clear result_id so double-apply is blocked
      setRecommendation(prev => prev ? { ...prev, result_id: undefined } : null)
    } catch (e: any) {
      console.error('Apply failed:', e)
      alert(e?.response?.data?.detail ?? 'Failed to record application')
    } finally {
      setApplyLoading(false)
    }
  }

  // ── PDF Export ─────────────────────────────────────────────────────────────
  const exportPDF = async () => {
    setExportLoading(true)
    try {
      const now = new Date().toLocaleString()
      const alertsHtml = alerts.slice(0, 20).map(a => `
        <tr style="border-bottom:1px solid #eee">
          <td style="padding:6px 8px;font-size:12px;color:#555">${new Date(a.timestamp).toLocaleTimeString()}</td>
          <td style="padding:6px 8px;font-size:12px;font-weight:600">${a.tag_name}</td>
          <td style="padding:6px 8px;font-size:12px">
            <span style="background:${a.severity==='critical'?'#fee2e2':a.severity==='warning'?'#fef3c7':'#dbeafe'};
                         color:${a.severity==='critical'?'#991b1b':a.severity==='warning'?'#92400e':'#1e40af'};
                         padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700">
              ${a.severity.toUpperCase()}
            </span>
          </td>
          <td style="padding:6px 8px;font-size:11px;color:#666">${a.description}</td>
        </tr>`).join('')

      const historyRows = history.slice(-20).reverse().map((d, i) => `
        <tr style="background:${i%2===0?'#f9fafb':'#fff'}">
          <td style="padding:5px 8px;font-size:12px;color:#555">${new Date(d.ts).toLocaleTimeString()}</td>
          <td style="padding:5px 8px;font-size:12px;font-weight:600;color:#0891b2">${d.energy.toFixed(4)}</td>
          <td style="padding:5px 8px;font-size:12px;font-weight:600;color:#d97706">${d.purity.toFixed(2)}%</td>
        </tr>`).join('')

      const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><title>OPTIQ Report — ${now}</title>
<style>body{font-family:Arial,sans-serif;margin:0;padding:24px;color:#1a1a1a}
.header{background:#0D1B2A;color:white;padding:20px 24px;border-radius:8px;margin-bottom:24px}
.header h1{margin:0;font-size:22px;color:#00D9FF}.header p{margin:4px 0 0;font-size:13px;color:#7A9BB5}
.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
.kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px}
.kpi-label{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#64748b}
.kpi-value{font-size:24px;font-weight:700;color:#0D1B2A;margin:4px 0 2px;font-family:monospace}
.kpi-unit{font-size:11px;color:#94a3b8}
h2{font-size:16px;color:#0D1B2A;border-bottom:2px solid #00D9FF;padding-bottom:6px;margin:24px 0 12px}
table{width:100%;border-collapse:collapse}th{background:#0D1B2A;color:white;padding:8px;font-size:12px;text-align:left}
.footer{margin-top:32px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px}
</style></head><body>
<div class="header"><h1>OPTIQ DSS — Process Monitoring Report</h1>
<p>DC4 Butane Debutanizer · Generated: ${now} · Operator: ${user?.username}</p></div>
<div class="kpi-grid">
<div class="kpi"><div class="kpi-label">Energy Consumption</div>
<div class="kpi-value">${current?.energy.toFixed(4) ?? '—'}</div><div class="kpi-unit">kg steam / kg butane</div></div>
<div class="kpi"><div class="kpi-label">Butane Purity</div>
<div class="kpi-value">${current?.purity.toFixed(2) ?? '—'}%</div><div class="kpi-unit">Product quality</div></div>
<div class="kpi"><div class="kpi-label">Process Stability</div>
<div class="kpi-value">${current ? (current.stability*100).toFixed(1) : '—'}%</div><div class="kpi-unit">Model confidence</div></div>
<div class="kpi"><div class="kpi-label">Active Alerts</div>
<div class="kpi-value" style="color:${alerts.filter(a=>!a.acknowledged).length>0?'#dc2626':'#16a34a'}">${alerts.filter(a=>!a.acknowledged).length}</div>
<div class="kpi-unit">Unacknowledged</div></div></div>
${recommendation ? `<h2>AI Setpoint Recommendation${applied ? ' (APPLIED ✓)' : ''}</h2>
<table><tr><th>Metric</th><th>Current</th><th>Recommended</th><th>Improvement</th></tr>
<tr><td>Energy (kg/kg)</td><td>${recommendation.current_energy.toFixed(4)}</td>
<td>${recommendation.expected_energy.toFixed(4)}</td>
<td style="color:#16a34a;font-weight:700">-${recommendation.energy_savings_percent.toFixed(1)}%</td></tr>
<tr><td>Purity (%)</td><td>${recommendation.current_purity.toFixed(2)}%</td>
<td>${recommendation.expected_purity.toFixed(2)}%</td>
<td style="color:#16a34a;font-weight:700">+${recommendation.purity_improvement_percent.toFixed(2)}%</td></tr>
</table>` : ''}
<h2>Recent Process History</h2>
<table><tr><th>Time</th><th>Energy (kg/kg)</th><th>Purity (%)</th></tr>
${historyRows || '<tr><td colspan="3" style="padding:12px;text-align:center;color:#94a3b8">No history</td></tr>'}
</table>
<h2>Recent Alerts</h2>
<table><tr><th>Time</th><th>Tag</th><th>Severity</th><th>Description</th></tr>
${alertsHtml || '<tr><td colspan="4" style="padding:12px;text-align:center;color:#94a3b8">No alerts</td></tr>'}
</table>
<div class="footer">OPTIQ DSS · DC4 Butane Debutanizer · Powered by OPTIQ · Made in Algeria</div>
</body></html>`

      const w = window.open('', '_blank')
      if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500) }
    } finally {
      setExportLoading(false)
    }
  }

  // ── Chart ──────────────────────────────────────────────────────────────────
  const primary = company?.primary_color ?? '#00D9FF'
  const accent  = company?.accent_color  ?? '#FFD700'

  const chartData = {
    labels: history.map((_, i) => i),
    datasets: [
      {
        label: 'Energy (kg/kg)', data: history.map(d => d.energy),
        borderColor: primary, backgroundColor: `${primary}18`,
        fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2,
      },
      {
        label: 'Purity (%)', data: history.map(d => d.purity),
        borderColor: accent, backgroundColor: `${accent}12`,
        fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2,
      },
    ],
  }

  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: { labels: { color: '#7A9BB5', font: { size: 11 } } },
      tooltip: {
        backgroundColor: 'rgba(13,23,41,0.95)',
        borderColor: 'rgba(0,217,255,0.2)', borderWidth: 1,
        callbacks: { label: (ctx: any) => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(4)}` },
      },
    },
    scales: {
      x: { display: false },
      y: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: { color: '#7A9BB5', font: { size: 10 }, callback: (v: any) => v.toFixed(2) },
      },
    },
  }

  const unacked = alerts.filter(a => !a.acknowledged).length

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-content">

        {/* Topbar */}
        <header className="topbar">
          <div className="flex items-center gap-3">
            {/* Hamburger — mobile only */}
            <button className="btn-icon mobile-only" onClick={toggleSidebar} aria-label="Menu">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
            <div>
              <div className="font-display font-bold text-xl">
                {company?.name ?? 'OPTIQ'} · DC4 Debutanizer DSS
              </div>
              <div className="text-xs text-muted" style={{ fontFamily: 'var(--font-mono)' }}>
                Live Process Monitoring
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className={`status-dot ${wsStatus === 'connected' ? '' : wsStatus === 'connecting' ? 'warning' : 'error'}`} />
              <span className="text-xs text-muted" style={{ fontFamily: 'var(--font-mono)' }}>
                {wsStatus === 'connected'
                  ? 'LIVE'
                  : wsStatus === 'connecting'
                  ? current ? 'WS CONNECTING' : 'STARTING…'
                  : 'HTTP POLL'}
              </span>
            </div>
            <button className="btn btn-ghost btn-sm desktop-only" onClick={exportPDF} disabled={exportLoading}>
              {exportLoading ? '⏳' : '⬇'} PDF Report
            </button>
            <div className="text-xs text-lo desktop-only">{user?.username} · {user?.role}</div>
          </div>
        </header>

        <main className="page-content">

          {/* KPI row */}
          <div className="kpi-grid mb-6">
            <KpiCard label="Energy Consumption"
              value={current ? current.energy.toFixed(4) : '—'}
              unit="kg steam / kg butane" delay={0} />
            <KpiCard label="Product Purity"
              value={current ? `${current.purity.toFixed(2)}%` : '—'}
              unit="Butane purity" color="var(--accent)" delay={60} />
            <KpiCard label="Process Stability"
              value={current ? `${(current.stability * 100).toFixed(1)}%` : '—'}
              unit="Model confidence" color="var(--success)" delay={120} />
            <KpiCard label="Active Alerts"
              value={String(unacked)} unit="Unacknowledged"
              color={unacked > 0 ? 'var(--error)' : 'var(--success)'} delay={180} />
          </div>

          {/* Chart + Advisor */}
          <div className="dashboard-main-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', gap: '1rem', marginBottom: '1.5rem' }}>
            <div className="card">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <div className="font-semibold">Process Trends</div>
                  <div className="text-xs text-muted">Last 60 samples · live update every {wsStatus === 'connected' ? '3s via WS' : '5s via HTTP'}</div>
                </div>
                {wsStatus !== 'connected' && (
                  <div className="badge" style={{
                    background: wsStatus === 'connecting' ? 'rgba(0,217,255,0.12)' : 'rgba(255,69,96,0.12)',
                    color:      wsStatus === 'connecting' ? 'var(--primary)' : 'var(--error)',
                    border:     `1px solid ${wsStatus === 'connecting' ? 'rgba(0,217,255,0.3)' : 'rgba(255,69,96,0.3)'}`,
                    fontSize: '0.68rem',
                  }}>
                    {wsStatus === 'connecting' ? '⟳ Backend starting…' : '↻ HTTP polling fallback'}
                  </div>
                )}
              </div>
              <div className="chart-wrap" style={{ position: 'relative' }}>
                <Line data={chartData} options={chartOpts} />
                {history.length === 0 && (
                  <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                    background: 'rgba(13,27,42,0.7)', borderRadius: 'var(--r-md)',
                  }}>
                    <div className="spinner" style={{ width: 28, height: 28 }} />
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-mid)' }}>
                      {wsStatus === 'connecting'
                        ? 'Backend is starting — data arriving shortly…'
                        : 'Fetching data…'}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* AI Advisor */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              <div>
                <div className="font-semibold mb-1">AI Setpoint Advisor</div>
                <div className="text-xs text-muted">NSGA-II multi-objective optimisation</div>
              </div>

              {recommendation ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

                  {/* Computed-at timestamp */}
                  {recommendation.computed_at && (
                    <div style={{
                      fontSize: '0.7rem',
                      fontFamily: 'var(--font-mono)',
                      color: isStale ? '#F59E0B' : 'var(--text-low)',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      {isStale && <span>⚠</span>}
                      Computed {age.label}
                    </div>
                  )}

                  {/* Staleness warning */}
                  {isStale && (
                    <div style={{
                      padding: '0.6rem 0.875rem',
                      background: 'rgba(245,158,11,0.08)',
                      border: '1px solid rgba(245,158,11,0.3)',
                      borderRadius: 'var(--r-md)',
                      fontSize: '0.78rem', color: '#F59E0B',
                    }}>
                      {drift.stale
                        ? `⚠ Process drifted on ${drift.driftedTags.length} tag(s) (max ${drift.maxDrift.toFixed(1)}%) — recompute recommended`
                        : '⚠ Conditions may have changed — consider recomputing'
                      }
                    </div>
                  )}

                  {/* Applied confirmation + simulation trajectory */}
                  {applied && (
                    <div style={{
                      background: 'rgba(0,232,122,0.06)',
                      border: '1px solid rgba(0,232,122,0.3)',
                      borderRadius: 'var(--r-md)',
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        padding: '0.6rem 0.875rem',
                        fontSize: '0.8rem', color: 'var(--success)',
                        fontWeight: 600,
                      }}>
                        ✓ Confirmed applied — logged with timestamp
                      </div>

                      {simulation.length > 0 && (
                        <div style={{
                          borderTop: '1px solid rgba(0,232,122,0.2)',
                          padding: '0.75rem 0.875rem',
                        }}>
                          <div style={{
                            fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.07em',
                            color: 'var(--text-low)', textTransform: 'uppercase', marginBottom: '0.6rem',
                          }}>
                            Projected trajectory after applying
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                            {simulation.map(s => (
                              <div key={s.step} style={{
                                display: 'grid',
                                gridTemplateColumns: '2.2rem 1fr 1fr 1fr',
                                alignItems: 'center',
                                gap: '0.4rem',
                                fontSize: '0.75rem',
                                fontFamily: 'var(--font-mono)',
                                padding: '0.35rem 0.5rem',
                                background: 'rgba(0,232,122,0.04)',
                                borderRadius: 4,
                                border: '1px solid rgba(0,232,122,0.1)',
                              }}>
                                <span style={{ color: 'var(--text-low)', fontSize: '0.68rem' }}>T+{s.step}</span>
                                <span>
                                  <span style={{ color: 'var(--text-low)', fontSize: '0.68rem' }}>E </span>
                                  <span style={{ color: 'var(--primary)' }}>{s.energy.toFixed(1)}</span>
                                  {s.energy_delta_pct > 0.05 && (
                                    <span style={{ color: 'var(--success)', fontSize: '0.65rem', marginLeft: 3 }}>
                                      ↓{s.energy_delta_pct.toFixed(1)}%
                                    </span>
                                  )}
                                </span>
                                <span>
                                  <span style={{ color: 'var(--text-low)', fontSize: '0.68rem' }}>P </span>
                                  <span style={{ color: '#A78BFA' }}>{s.purity.toFixed(2)}%</span>
                                  {s.purity_delta_pct > 0.02 && (
                                    <span style={{ color: 'var(--success)', fontSize: '0.65rem', marginLeft: 3 }}>
                                      ↑{s.purity_delta_pct.toFixed(2)}%
                                    </span>
                                  )}
                                </span>
                                <span>
                                  <span style={{ color: 'var(--text-low)', fontSize: '0.68rem' }}>B </span>
                                  <span style={{ color: '#FCD34D' }}>{s.butane.toFixed(3)}</span>
                                </span>
                              </div>
                            ))}
                          </div>
                          <div style={{
                            fontSize: '0.65rem', color: 'var(--text-low)', marginTop: '0.5rem',
                          }}>
                            E = Energy (kJ/kg) · P = Purity (%) · B = Butane (m³/h)
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className={`badge badge-${
                    recommendation.status === 'optimal'  ? 'success' :
                    recommendation.status === 'warning'  ? 'warning' : 'error'
                  }`}>
                    {recommendation.status.toUpperCase()}
                  </div>

                  {recommendation.energy_savings_percent <= 0 && (
                    <div style={{
                      background: 'rgba(0,217,255,0.06)', border: '1px solid rgba(0,217,255,0.15)',
                      borderRadius: 'var(--r-md)', padding: '0.6rem 0.875rem',
                      fontSize: '0.8rem', color: 'var(--text-mid)',
                    }}>
                      Current operation is near-optimal. No improvement found.
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
                    <Metric label="Energy savings"
                      value={recommendation.energy_savings_percent > 0
                        ? `${recommendation.energy_savings_percent.toFixed(1)}%`
                        : 'Near optimal'}
                      positive={recommendation.energy_savings_percent > 0} />
                    <Metric label="Purity gain"
                      value={recommendation.purity_improvement_percent > 0.01
                        ? `+${recommendation.purity_improvement_percent.toFixed(2)}%`
                        : 'Unchanged'}
                      positive={recommendation.purity_improvement_percent > 0.01} />
                    <Metric label="Current energy" value={recommendation.current_energy.toFixed(4)} />
                    <Metric label="Best found"     value={recommendation.expected_energy.toFixed(4)} />
                  </div>

                  <div className="text-xs text-muted">Recommended OP setpoints</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: primary, lineHeight: 1.8 }}>
                    {[
                      ['2TIC403', 'Bottom temp ctrl'],
                      ['2FIC419', 'Feed flow ctrl'],
                      ['2LIC409', 'Reflux drum lvl'],
                      ['2LIC412', 'Bottom level ctrl'],
                    ].map(([tag, label], i) => (
                      recommendation.recommended_setpoints[i] != null && (
                        <div key={tag}>
                          <span style={{ color: 'var(--text-low)', fontSize: '0.7rem' }}>{label} </span>
                          <span>{recommendation.recommended_setpoints[i].toFixed(1)}%</span>
                        </div>
                      )
                    ))}
                  </div>

                  {/* Apply button */}
                  {recommendation.result_id && canOptimize(user) && !applied && (
                    <button
                      className="btn w-full"
                      style={{
                        background: 'rgba(0,232,122,0.1)',
                        border: '1px solid rgba(0,232,122,0.3)',
                        color: 'var(--success)',
                        fontWeight: 700, fontSize: '0.82rem',
                      }}
                      onClick={applyRecommendation}
                      disabled={applyLoading}
                    >
                      {applyLoading
                        ? <><div className="spinner" style={{ width: 12, height: 12 }} /> Logging…</>
                        : '✓ I Applied This Recommendation'
                      }
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--text-low)', fontSize: '0.85rem', textAlign: 'center', padding: '1rem' }}>
                  Click below to compute<br/>optimal setpoints
                </div>
              )}

              <button className="btn btn-primary w-full" onClick={fetchOptimization}
                disabled={optLoading || !canOptimize(user)}
                title={!canOptimize(user) ? 'Viewer role — read-only' : undefined}>
                {optLoading
                  ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Computing…</>
                  : isStale && recommendation ? '⚠ Recompute (conditions changed)' : '⚡ Update Recommendation'
                }
              </button>
            </div>
          </div>

          {/* Alerts */}
          <div className="card">
            <div className="flex justify-between items-center mb-4">
              <div>
                <div className="font-semibold">Recent Alerts</div>
                <div className="text-xs text-muted">Anomaly detection · last 50 events</div>
              </div>
              {unacked > 0 && (
                <div className="badge badge-error">{unacked} unacknowledged</div>
              )}
            </div>
            {alerts.length === 0
              ? <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-low)', fontSize: '0.875rem' }}>
                  ✓ No alerts detected
                </div>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: 380, overflowY: 'auto' }}>
                  {alerts.slice(0, 15).map(a => <AlertRow key={a.id} alert={a} />)}
                </div>
            }
          </div>

          <div style={{ textAlign: 'center', marginTop: '2rem', paddingBottom: '1rem' }}>
            <div className="optiq-badge"><span>OPTIQ</span> Industrial AI Platform · v2.0</div>
          </div>
        </main>
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────
const KpiCard: React.FC<{
  label: string; value: string; unit: string; color?: string; delay?: number
}> = ({ label, value, unit, color = 'var(--primary)', delay = 0 }) => (
  <div className="kpi-card animate-fade-up" style={{ animationDelay: `${delay}ms` }}>
    <div className="kpi-label">{label}</div>
    <div className="kpi-value" style={{ color }}>{value}</div>
    <div className="kpi-unit">{unit}</div>
  </div>
)

const Metric: React.FC<{ label: string; value: string; positive?: boolean }> = ({ label, value, positive }) => (
  <div>
    <div className="text-xs text-muted mb-1">{label}</div>
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.95rem', fontWeight: 700,
                  color: positive ? 'var(--success)' : 'var(--text-hi)' }}>
      {value}
    </div>
  </div>
)

const AlertRow: React.FC<{ alert: Alert }> = ({ alert: a }) => (
  <div className={`alert-row ${a.severity}`} style={{ opacity: a.acknowledged ? 0.5 : 1 }}>
    <span style={{ fontSize: '1rem', flexShrink: 0 }}>
      {a.severity === 'critical' ? '⛔' : a.severity === 'warning' ? '⚠️' : 'ℹ️'}
    </span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="font-semibold text-sm truncate">{a.tag_name} · {a.alert_type.replace(/_/g, ' ')}</div>
      <div className="text-xs text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {a.description}
      </div>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
      <div className={`badge badge-${a.severity}`}>{a.severity}</div>
      <div className="text-xs text-lo" style={{ fontFamily: 'var(--font-mono)' }}>
        {new Date(a.timestamp).toLocaleTimeString()}
      </div>
    </div>
  </div>
)

export default Dashboard
