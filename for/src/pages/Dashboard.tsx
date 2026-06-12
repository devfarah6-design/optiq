import React, { useState, useCallback, useRef, useEffect } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  PointElement, LineElement, Filler, Tooltip, Legend,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import Sidebar from '@/components/Sidebar'
import { predictApi, recommendationApi, Alert, OptimizeResult, canOptimize, fopdtConfigApi, TrackingOut } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
import { useBranding } from '@/branding/BrandingContext'
import { useMobileNav } from '@/context/MobileNavContext'
import { useLiveData } from '@/context/LiveDataContext'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

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

  // ── Persistent live data from context (survives navigation) ───────────────
  const {
    current, history, alerts, wsStatus,
    recommendation, setRecommendation,
    applied, setApplied,
    simulation, setSimulation,
    clearRecommendation,
  } = useLiveData()

  const [optLoading,    setOptLoading]    = useState(false)
  const [applyLoading,  setApplyLoading]  = useState(false)
  const [exportLoading, setExportLoading] = useState(false)

  // ── Post-apply FOPDT tracking ──────────────────────────────────────────────
  const [appliedResultId, setAppliedResultId] = useState<number | null>(null)
  const [trackingResults, setTrackingResults] = useState<(TrackingOut | null)[]>([])
  const currentTagsRef = useRef<Record<string, number>>({})
  const timerIdsRef    = useRef<ReturnType<typeof setTimeout>[]>([])

  // ── Staleness & drift ──────────────────────────────────────────────────────
  const age = ageLabel(recommendation?.computed_at)

  const currentReadings: Record<string, number> = {}
  if (current?.tags) Object.assign(currentReadings, current.tags)

  const drift = computeDrift(recommendation?.process_snapshot, currentReadings)

  const isStale = age.stale || drift.stale

  // Keep currentTagsRef in sync so timer callbacks always read the live value
  useEffect(() => {
    currentTagsRef.current = current?.tags ?? {}
  }, [current])

  // Start FOPDT tracking timers after apply — fires at each predicted horizon
  useEffect(() => {
    if (!applied || !appliedResultId || simulation.length === 0) return
    timerIdsRef.current.forEach(id => clearTimeout(id))
    timerIdsRef.current = []
    setTrackingResults(new Array(simulation.length).fill(null))

    simulation.forEach((step, idx) => {
      const id = setTimeout(async () => {
        try {
          const res = await fopdtConfigApi.checkTracking(appliedResultId, currentTagsRef.current)
          setTrackingResults(prev => {
            const updated = [...prev]
            updated[idx] = res.data
            return updated
          })
        } catch (e) {
          console.error('Tracking check failed at horizon', step.label, e)
        }
      }, step.time_s * 1000)
      timerIdsRef.current.push(id)
    })

    return () => { timerIdsRef.current.forEach(id => clearTimeout(id)) }
  }, [applied, appliedResultId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Optimisation ──────────────────────────────────────────────────────────
  const fetchOptimization = async () => {
    setOptLoading(true)
    clearRecommendation()
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
    const rid = recommendation.result_id  // save before we clear it
    try {
      const res = await recommendationApi.apply(rid)
      setApplied(true)
      setAppliedResultId(rid)
      setTrackingResults([])
      if (res.data.simulation?.length) {
        setSimulation(res.data.simulation)
      }
      // Clear result_id so double-apply is blocked
      setRecommendation(recommendation ? { ...recommendation, result_id: undefined } : null)
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

  const labels = history.map((_, i) => i)

  const energyChartData = {
    labels,
    datasets: [{
      label: 'Energy (kg steam / kg butane)',
      data: history.map(d => d.energy),
      borderColor: primary, backgroundColor: `${primary}18`,
      fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2,
    }],
  }

  const purityChartData = {
    labels,
    datasets: [{
      label: 'Purity (%mol)',
      data: history.map(d => d.purity),
      borderColor: accent, backgroundColor: `${accent}12`,
      fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2,
    }],
  }

  const baseChartOpts = {
    responsive: true, maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: { display: false },
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

  const energyChartOpts = {
    ...baseChartOpts,
    scales: {
      ...baseChartOpts.scales,
      y: { ...baseChartOpts.scales.y, ticks: { ...baseChartOpts.scales.y.ticks, callback: (v: any) => v.toFixed(2) } },
    },
  }

  const purityChartOpts = {
    ...baseChartOpts,
    scales: {
      ...baseChartOpts.scales,
      y: { ...baseChartOpts.scales.y, ticks: { ...baseChartOpts.scales.y.ticks, callback: (v: any) => `${v.toFixed(1)}%` } },
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

          {/* Charts + Advisor */}
          <div className="dashboard-main-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', gap: '1rem', marginBottom: '1.5rem' }}>

            {/* Left column: two stacked charts */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

              {/* WS status badge — shown above charts when not connected */}
              {wsStatus !== 'connected' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div className="badge" style={{
                    background: wsStatus === 'connecting' ? 'rgba(0,217,255,0.12)' : 'rgba(255,69,96,0.12)',
                    color:      wsStatus === 'connecting' ? 'var(--primary)' : 'var(--error)',
                    border:     `1px solid ${wsStatus === 'connecting' ? 'rgba(0,217,255,0.3)' : 'rgba(255,69,96,0.3)'}`,
                    fontSize: '0.68rem',
                  }}>
                    {wsStatus === 'connecting' ? '⟳ Backend starting…' : '↻ HTTP polling fallback'}
                  </div>
                </div>
              )}

              {/* Energy chart */}
              <div className="card">
                <div className="flex justify-between items-center mb-3">
                  <div>
                    <div className="font-semibold" style={{ color: primary }}>Energy Consumption</div>
                    <div className="text-xs text-muted">kg steam / kg butane · continuous history</div>
                  </div>
                  {current && (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', fontWeight: 700, color: primary }}>
                      {current.energy.toFixed(4)}
                    </div>
                  )}
                </div>
                <div className="chart-wrap" style={{ position: 'relative' }}>
                  <Line data={energyChartData} options={energyChartOpts} />
                  {history.length === 0 && (
                    <div style={{
                      position: 'absolute', inset: 0,
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                      background: 'rgba(13,27,42,0.7)', borderRadius: 'var(--r-md)',
                    }}>
                      <div className="spinner" style={{ width: 24, height: 24 }} />
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-mid)' }}>
                        {wsStatus === 'connecting' ? 'Backend starting…' : 'Fetching data…'}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Purity chart */}
              <div className="card">
                <div className="flex justify-between items-center mb-3">
                  <div>
                    <div className="font-semibold" style={{ color: accent }}>Butane Purity</div>
                    <div className="text-xs text-muted">%mol · continuous history</div>
                  </div>
                  {current && (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', fontWeight: 700, color: accent }}>
                      {current.purity.toFixed(2)}%
                    </div>
                  )}
                </div>
                <div className="chart-wrap" style={{ position: 'relative' }}>
                  <Line data={purityChartData} options={purityChartOpts} />
                  {history.length === 0 && (
                    <div style={{
                      position: 'absolute', inset: 0,
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                      background: 'rgba(13,27,42,0.7)', borderRadius: 'var(--r-md)',
                    }}>
                      <div className="spinner" style={{ width: 24, height: 24 }} />
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-mid)' }}>
                        {wsStatus === 'connecting' ? 'Backend starting…' : 'Fetching data…'}
                      </div>
                    </div>
                  )}
                </div>
              </div>

            </div>

            {/* AI Advisor */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              <div>
                <div className="font-semibold mb-1">AI Setpoint Advisor</div>
            
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

                  {/* Staleness warning — hide once applied (operator already acted) */}
                  {isStale && !applied && (
                    <div style={{
                      padding: '0.6rem 0.875rem',
                      background: 'rgba(245,158,11,0.08)',
                      border: '1px solid rgba(245,158,11,0.3)',
                      borderRadius: 'var(--r-md)',
                      fontSize: '0.78rem', color: '#F59E0B',
                    }}>
                      {drift.stale
                        ? `⚠ Process shifted on ${drift.driftedTags.length} tag(s) since last computation (max ${drift.maxDrift.toFixed(1)}%) — consider recomputing before applying`
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
                      {/* Confirmation header */}
                      <div style={{
                        padding: '0.6rem 0.875rem',
                        fontSize: '0.8rem', color: 'var(--success)',
                        fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem',
                      }}>
                        ✓ Setpoints logged as applied — monitor the live charts above
                      </div>

                      {/* FOPDT process trajectory */}
                      {simulation.length > 0 && (
                        <div style={{
                          borderTop: '1px solid rgba(0,232,122,0.2)',
                          padding: '0.875rem',
                        }}>
                          {/* Panel header */}
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            marginBottom: '0.75rem',
                          }}>
                            <div style={{
                              width: 3, height: 18, borderRadius: 2,
                              background: 'var(--primary)', flexShrink: 0,
                            }} />
                            <div>
                              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#E2E8F0' }}>
                                FOPDT Process Response
                              </div>
                              <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginTop: '0.1rem' }}>
                                Timers fire automatically. Compare <span style={{ color: '#CBD5E1' }}>predicted</span> vs <span style={{ color: '#34D399' }}>actual DCS</span> at each horizon.
                              </div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>

                            {/* Top-level recompute banner */}
                            {trackingResults.some(tr => tr?.suggest_reoptimize) && (
                              <div style={{
                                padding: '0.625rem 0.75rem',
                                background: 'rgba(239,68,68,0.1)',
                                border: '1px solid rgba(239,68,68,0.4)',
                                borderRadius: 8,
                              }}>
                                <div style={{ fontSize: '0.8rem', color: '#FCA5A5', fontWeight: 700, marginBottom: '0.2rem' }}>
                                  ⚠ Process deviation detected — recomputation recommended
                                </div>
                                <div style={{ fontSize: '0.75rem', color: '#CBD5E1', marginBottom: '0.5rem' }}>
                                  {trackingResults.find(tr => tr?.suggest_reoptimize)?.message}
                                </div>
                                <button
                                  className="btn btn-sm"
                                  style={{
                                    background: 'rgba(239,68,68,0.15)',
                                    border: '1px solid rgba(239,68,68,0.45)',
                                    color: '#FCA5A5', fontSize: '0.78rem', padding: '0.3rem 0.7rem',
                                    fontWeight: 600,
                                  }}
                                  onClick={fetchOptimization}
                                >
                                  ⟳ Recompute with current conditions
                                </button>
                              </div>
                            )}

                            {simulation.map((s, idx) => {
                              const tr = trackingResults[idx]
                              const hasTracking = !!tr
                              const cardBorder = hasTracking
                                ? tr!.tracking_ok ? '1px solid rgba(52,211,153,0.4)' : '1px solid rgba(239,68,68,0.45)'
                                : '1px solid rgba(100,116,139,0.3)'
                              const cardBg = hasTracking
                                ? tr!.tracking_ok ? 'rgba(52,211,153,0.06)' : 'rgba(239,68,68,0.07)'
                                : 'rgba(30,41,59,0.5)'

                              return (
                              <div key={s.step} style={{
                                background: cardBg,
                                borderRadius: 8,
                                border: cardBorder,
                                overflow: 'hidden',
                              }}>
                                {/* Horizon header row */}
                                <div style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.5rem',
                                  padding: '0.5rem 0.75rem',
                                  background: hasTracking
                                    ? tr!.tracking_ok ? 'rgba(52,211,153,0.1)' : 'rgba(239,68,68,0.1)'
                                    : 'rgba(255,255,255,0.04)',
                                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                                }}>
                                  {/* Horizon label */}
                                  <span style={{
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: '0.85rem', fontWeight: 800,
                                    color: hasTracking
                                      ? tr!.tracking_ok ? '#34D399' : '#FCA5A5'
                                      : primary,
                                    minWidth: '4.5rem',
                                  }}>
                                    {s.label || `+${s.step}`}
                                  </span>

                                  {/* Status chip */}
                                  {hasTracking ? (
                                    tr!.tracking_ok ? (
                                      <span style={{
                                        fontSize: '0.72rem', fontWeight: 700, color: '#34D399',
                                        background: 'rgba(52,211,153,0.12)',
                                        border: '1px solid rgba(52,211,153,0.3)',
                                        borderRadius: 20, padding: '0.1rem 0.6rem',
                                      }}>
                                        ✓ On Track · max Δ {tr!.worst_deviation_pct.toFixed(1)}%
                                      </span>
                                    ) : (
                                      <span style={{
                                        fontSize: '0.72rem', fontWeight: 700, color: '#FCA5A5',
                                        background: 'rgba(239,68,68,0.12)',
                                        border: '1px solid rgba(239,68,68,0.3)',
                                        borderRadius: 20, padding: '0.1rem 0.6rem',
                                      }}>
                                        ⚠ Deviation {tr!.worst_deviation_pct.toFixed(1)}%
                                      </span>
                                    )
                                  ) : (
                                    <span style={{
                                      fontSize: '0.72rem', color: '#94A3B8',
                                      background: 'rgba(255,255,255,0.05)',
                                      border: '1px solid rgba(255,255,255,0.1)',
                                      borderRadius: 20, padding: '0.1rem 0.6rem',
                                    }}>
                                      ⏱ Awaiting timer…
                                    </span>
                                  )}

                                  {/* KPIs inline */}
                                  <div style={{
                                    marginLeft: 'auto', display: 'flex', gap: '0.875rem',
                                    fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
                                  }}>
                                    <span>
                                      <span style={{ color: '#64748B', marginRight: 3 }}>E</span>
                                      <span style={{ color: '#7DD3FC', fontWeight: 600 }}>{s.energy.toFixed(2)}</span>
                                      {s.energy_delta_pct > 0.1 && (
                                        <span style={{ color: '#34D399', fontSize: '0.68rem', marginLeft: 2 }}>
                                          -{s.energy_delta_pct.toFixed(1)}%
                                        </span>
                                      )}
                                    </span>
                                    <span>
                                      <span style={{ color: '#64748B', marginRight: 3 }}>P</span>
                                      <span style={{ color: '#C4B5FD', fontWeight: 600 }}>{s.purity.toFixed(2)}%</span>
                                      {s.purity_delta_pct > 0.02 && (
                                        <span style={{ color: '#34D399', fontSize: '0.68rem', marginLeft: 2 }}>
                                          +{s.purity_delta_pct.toFixed(2)}%
                                        </span>
                                      )}
                                    </span>
                                  </div>
                                </div>

                                {/* DCS tag table — one row per PV tag */}
                                {Object.keys(s.tag_values || {}).length > 0 && (
                                  <div style={{ padding: '0.5rem 0.75rem' }}>
                                    {/* Column headers */}
                                    <div style={{
                                      display: 'grid',
                                      gridTemplateColumns: '6.5rem 1fr 1fr 5rem',
                                      fontSize: '0.68rem', fontWeight: 700,
                                      color: '#475569',
                                      textTransform: 'uppercase', letterSpacing: '0.06em',
                                      paddingBottom: '0.3rem',
                                      borderBottom: '1px solid rgba(255,255,255,0.06)',
                                      marginBottom: '0.25rem',
                                    }}>
                                      <span>Tag</span>
                                      <span>Predicted</span>
                                      <span>{hasTracking ? 'Actual (DCS)' : 'Verify on DCS'}</span>
                                      <span style={{ textAlign: 'right' }}>{hasTracking ? 'Δ %' : ''}</span>
                                    </div>

                                    {Object.entries(s.tag_values)
                                      .filter(([tag]) => !tag.endsWith('.OP'))
                                      .map(([tag, val]) => {
                                        const dev = tr?.deviations?.[tag] as
                                          | { predicted: number; actual: number; deviation_pct: number; unit: string }
                                          | undefined
                                        const deviating = dev && dev.deviation_pct > 5
                                        return (
                                          <div key={tag} style={{
                                            display: 'grid',
                                            gridTemplateColumns: '6.5rem 1fr 1fr 5rem',
                                            alignItems: 'center',
                                            padding: '0.3rem 0',
                                            borderBottom: '1px solid rgba(255,255,255,0.04)',
                                            fontFamily: 'var(--font-mono)',
                                          }}>
                                            {/* Tag name */}
                                            <span style={{
                                              fontSize: '0.78rem', fontWeight: 700,
                                              color: deviating ? '#FCA5A5' : '#7DD3FC',
                                            }}>
                                              {tag}
                                            </span>

                                            {/* Predicted value — always visible */}
                                            <span style={{
                                              fontSize: '0.8rem',
                                              color: dev ? '#64748B' : '#CBD5E1',
                                              textDecoration: dev ? 'line-through' : 'none',
                                              fontWeight: dev ? 400 : 600,
                                            }}>
                                              {(typeof val === 'number' ? val : 0).toFixed(1)}
                                              {dev?.unit && (
                                                <span style={{ fontSize: '0.7rem', marginLeft: 2 }}>
                                                  {dev.unit}
                                                </span>
                                              )}
                                            </span>

                                            {/* Actual value — shown after timer fires */}
                                            {dev ? (
                                              <span style={{
                                                fontSize: '0.82rem', fontWeight: 700,
                                                color: deviating ? '#F87171' : '#34D399',
                                                display: 'flex', alignItems: 'center', gap: '0.25rem',
                                              }}>
                                                {deviating ? '⚠' : '✓'}
                                                {' '}{dev.actual.toFixed(1)}
                                                {dev.unit && (
                                                  <span style={{ fontSize: '0.72rem', fontWeight: 400, color: '#94A3B8' }}>
                                                    {dev.unit}
                                                  </span>
                                                )}
                                              </span>
                                            ) : (
                                              <span style={{
                                                fontSize: '0.75rem', color: '#475569',
                                                fontStyle: 'italic',
                                              }}>
                                                — pending
                                              </span>
                                            )}

                                            {/* Deviation % */}
                                            <span style={{
                                              fontSize: '0.75rem', textAlign: 'right',
                                              fontWeight: 700,
                                              color: dev
                                                ? deviating ? '#F87171' : '#34D399'
                                                : 'transparent',
                                            }}>
                                              {dev ? `${dev.deviation_pct.toFixed(1)}%` : '—'}
                                            </span>
                                          </div>
                                        )
                                      })}

                                    {/* Recompute inline for this horizon */}
                                    {tr && tr.suggest_reoptimize && (
                                      <div style={{ paddingTop: '0.4rem' }}>
                                        <button
                                          className="btn btn-sm"
                                          style={{
                                            fontSize: '0.75rem', padding: '0.25rem 0.7rem',
                                            background: 'rgba(239,68,68,0.12)',
                                            border: '1px solid rgba(239,68,68,0.4)',
                                            color: '#FCA5A5', fontWeight: 600,
                                          }}
                                          onClick={fetchOptimization}
                                        >
                                          ⟳ Recompute with current conditions
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                              )
                            })}
                          </div>

                          <div style={{
                            fontSize: '0.72rem', color: '#64748B', marginTop: '0.625rem',
                            fontStyle: 'italic',
                          }}>
                            Timers auto-fire. If actual DCS readings deviate significantly from predicted, click Recompute.
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

                  {/* ── OP setpoints ── */}
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

                  {/* ── SP setpoints (admin-configured) ── */}
                  {recommendation.sp_config && recommendation.sp_config.length > 0 && (
                    <>
                      <div className="text-xs text-muted" style={{ marginTop: '0.5rem' }}>
                        Recommended SP setpoints
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--accent)', lineHeight: 1.8 }}>
                        {recommendation.sp_config.map(sp => (
                          sp.recommended != null && (
                            <div key={sp.tag}>
                              <span style={{ color: 'var(--text-low)', fontSize: '0.7rem' }}>
                                {sp.desc || sp.tag}{' '}
                              </span>
                              <span>
                                {sp.recommended.toFixed(sp.unit === '°C' ? 1 : 0)}
                                {' '}{sp.unit}
                              </span>
                            </div>
                          )
                        ))}
                      </div>
                    </>
                  )}

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
                  : (applied
                      ? trackingResults.some(tr => tr?.suggest_reoptimize)
                      : isStale && !!recommendation)
                    ? '⚠ Recompute (conditions changed)' : '⚡ Update Recommendation'
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
              : <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {alerts.slice(0, 50).map(a => <AlertRow key={a.id} alert={a} />)}
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
