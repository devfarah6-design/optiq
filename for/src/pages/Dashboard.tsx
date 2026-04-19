import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  PointElement, LineElement, Filler, Tooltip, Legend,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import Sidebar from '../components/Sidebar'
import { alertApi, predictApi, Alert, OptimizeResult, Prediction, BASE_URL } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useBranding } from '../branding/BrandingContext'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

interface DataPoint { ts: number; energy: number; purity: number }

// ── Icon set ──────────────────────────────────────────────────────
const Icon = {
  Bolt:    () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  Drop:    () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>,
  Shield:  () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  Bell:    () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  Sun:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
  Moon:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  Refresh: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>,
  Brain:   () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/></svg>,
  Chart:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
}

const Dashboard: React.FC = () => {
  const { user } = useAuth()
  const { company, theme, toggleTheme } = useBranding()
  const [current, setCurrent]           = useState<Prediction | null>(null)
  const [history, setHistory]           = useState<DataPoint[]>([])
  const [alerts, setAlerts]             = useState<Alert[]>([])
  const [recommendation, setRecommendation] = useState<OptimizeResult | null>(null)
  const [optLoading, setOptLoading]     = useState(false)
  const [wsStatus, setWsStatus]         = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const wsRef = useRef<WebSocket | null>(null)

  // ── WebSocket ──────────────────────────────────────────────────
  const connect = useCallback(() => {
    const proto = BASE_URL.startsWith('https') ? 'wss' : 'ws'
    const host  = BASE_URL.replace(/^https?:\/\//, '')
    const ws    = new WebSocket(`${proto}://${host}/ws`)
    wsRef.current = ws
  
    ws.onopen  = () => setWsStatus('connected')
    ws.onclose = () => { setWsStatus('disconnected'); setTimeout(connect, 3000) }
    ws.onerror = () => ws.close()
    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'new_prediction') {
          // Extract tags from message
          const tags = msg.tags || {}
          const p: Prediction = {
            energy: msg.energy,
            purity: msg.purity,
            stability: msg.stability || 0,
            model_type: msg.model_type || 'ensemble',
            confidence: 0.95,
            is_outlier: msg.is_outlier || false,
            outlier_score: 0,
            timestamp: msg.timestamp || new Date().toISOString(),
            tags: tags
          }
          setCurrent(p)
          setHistory(prev => [...prev.slice(-59), { ts: Date.now(), energy: p.energy, purity: p.purity }])
        } else if (msg.type === 'new_alert') {
          setAlerts(prev => [msg.alert, ...prev.slice(0, 49)])
        }
      } catch { /* ignore */ }
    }
  }, [])
  useEffect(() => {
    alertApi.list().then(r => setAlerts(r.data)).catch(() => {})
    connect()
    return () => wsRef.current?.close()
  }, [connect])
  // Helper to get current setpoints from tags
const getCurrentSetpoints = (): number[] => {
  if (!current?.tags) {
    return [3000.0, 74.0, 94.0] // Steam, Reflux temp, Bottom temp
  }
  return [
    current.tags['2FI422.PV'] || 3000.0,
    current.tags['2TI1_414.PV'] || 74.0,
    current.tags['2TIC403.PV'] || 94.0
  ]
}
  // ── Optimisation ───────────────────────────────────────────────
  const fetchOptimization = async () => {
    setOptLoading(true)
    try {
      const setpoints = getCurrentSetpoints()
      const res = await predictApi.optimize(setpoints)
      setRecommendation(res.data)
    } catch { /* ignore */ }
    finally { setOptLoading(false) }
  }
  // ── Chart config ───────────────────────────────────────────────
  const primary = company?.primary_color ?? (theme === 'dark' ? '#E87C2C' : '#C4631A')
  const accent  = company?.accent_color  ?? (theme === 'dark' ? '#FFB347' : '#D4921A')
  const gridCol = theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)'
  const tickCol = theme === 'dark' ? '#8B97A8' : '#6B5C4A'

  const chartData = {
    labels: history.map((_, i) => i),
    datasets: [
      {
        label: 'Energy (kg/kg)',
        data: history.map(d => d.energy),
        borderColor: primary,
        backgroundColor: `${primary}14`,
        fill: true, tension: 0.4,
        pointRadius: 0, borderWidth: 2.5,
      },
      {
        label: 'Purity (%)',
        data: history.map(d => d.purity),
        borderColor: accent,
        backgroundColor: `${accent}10`,
        fill: true, tension: 0.4,
        pointRadius: 0, borderWidth: 2.5,
      },
    ],
  }

  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: {
        labels: {
          color: tickCol,
          font: { size: 11, family: "'Outfit'" },
          boxWidth: 12,
          usePointStyle: true,
          pointStyle: 'circle',
          padding: 16,
        }
      },
      tooltip: {
        backgroundColor: theme === 'dark' ? 'rgba(22,26,32,0.97)' : 'rgba(255,255,255,0.97)',
        titleColor: theme === 'dark' ? '#F1F3F7' : '#1A1410',
        bodyColor:  theme === 'dark' ? '#8B97A8' : '#6B5C4A',
        borderColor: theme === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)',
        borderWidth: 1,
        padding: 12,
        cornerRadius: 10,
        titleFont: { family: "'Outfit'", weight: 'bold' as const },
        bodyFont:  { family: "'JetBrains Mono'", size: 11 },
      },
    },
    scales: {
      x: { display: false },
      y: {
        grid: { color: gridCol },
        ticks: { color: tickCol, font: { size: 10, family: "'JetBrains Mono'" } },
        border: { color: 'transparent' },
      },
    },
  }

  const wsStatusVariant = wsStatus === 'connected' ? '' : wsStatus === 'disconnected' ? 'error' : 'warn'
  const unackCount = alerts.filter(a => !a.acknowledged).length

  const now = new Date()
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <div className="app-shell">
      <Sidebar />

      <div className="main-content">

        {/* ── Topbar ── */}
        <header className="topbar">
          <div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.35rem',
              fontWeight: 700,
              letterSpacing: '0.04em',
              color: 'var(--text-hi)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              {company?.name ?? 'OPTIQ'}
              <span style={{
                fontSize: '0.75rem',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-low)',
                fontWeight: 400,
                letterSpacing: '0.06em',
                padding: '2px 8px',
                borderRadius: 4,
                background: 'var(--bg-hover)',
                border: '1px solid var(--border)',
              }}>
                DC4 · DEBUTANIZER
              </span>
            </div>
            <div style={{
              fontSize: '0.72rem',
              color: 'var(--text-low)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.08em',
              marginTop: 2,
            }}>
              {dateStr} · {timeStr}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Connection status */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0.35rem 0.8rem',
              borderRadius: 'var(--r-md)',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
            }}>
              <div className={`status-dot ${wsStatusVariant}`} />
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.68rem',
                letterSpacing: '0.12em',
                color: wsStatus === 'connected' ? 'var(--success)' : wsStatus === 'disconnected' ? 'var(--error)' : 'var(--warning)',
                fontWeight: 600,
              }}>
                {wsStatus === 'connected' ? 'LIVE' : wsStatus.toUpperCase()}
              </span>
            </div>

            {/* User pill */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0.35rem 0.8rem',
              borderRadius: 'var(--r-md)',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
            }}>
              <div style={{
                width: 22, height: 22,
                borderRadius: '50%',
                background: 'rgba(var(--primary-rgb),0.15)',
                border: '1px solid rgba(var(--primary-rgb),0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--primary)',
                fontSize: '0.65rem',
                fontWeight: 700,
                fontFamily: 'var(--font-display)',
              }}>
                {user?.username?.[0]?.toUpperCase() ?? '?'}
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-mid)' }}>
                {user?.username}
              </span>
            </div>
          </div>
        </header>

        <main className="page-content">

          {/* ── KPI Row ── */}
          <div className="kpi-grid" style={{ marginBottom: '1.25rem' }}>

            <KpiCard
              label="Energy Consumption"
              value={current ? current.energy.toFixed(3) : '—'}
              unit="kg/kg"
              icon={<Icon.Bolt />}
            //  trend={current?.energy_savings_percent ? { value: current.energy_savings_percent, label: 'vs baseline' } : null}
            //  trendDir={current?.energy_savings_percent && current.energy_savings_percent > 0 ? 'up' : 'down'}
            />

            <KpiCard
              label="Product Purity"
              value={current ? `${current.purity.toFixed(1)}` : '—'}
              unit="%"
              icon={<Icon.Drop />}
              accentColor="var(--accent)"
            />

            <KpiCard
              label="Active Alerts"
              value={String(unackCount)}
              unit="unacknowledged"
              icon={<Icon.Bell />}
              alertMode={unackCount > 0}
            />

            <KpiCard
              label="System Status"
              value={wsStatus === 'connected' ? '99.8' : '—'}
              unit="% uptime"
              icon={<Icon.Shield />}
              status={wsStatus}
            />
          </div>

          {/* ── Chart + AI Advisor row ── */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) 320px',
            gap: '1.25rem',
            marginBottom: '1.25rem',
          }}>

            {/* Chart card */}
            <div className="card-accent">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 700, letterSpacing: '0.04em' }}>
                    Process Trends
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-low)', fontFamily: 'var(--font-mono)', marginTop: 2, letterSpacing: '0.06em' }}>
                    Last 60 samples · live update
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {history.length === 0 && (
                    <span className="badge badge-warning">Awaiting data…</span>
                  )}
                  <div style={{
                    width: 8, height: 8,
                    borderRadius: '50%',
                    background: primary,
                    boxShadow: wsStatus === 'connected' ? `0 0 8px ${primary}` : 'none',
                    opacity: wsStatus === 'connected' ? 1 : 0.3,
                    transition: 'opacity 0.3s',
                  }} />
                </div>
              </div>
              <div className="chart-wrap">
                <Line data={chartData} options={chartOpts} />
              </div>
            </div>

            {/* AI Advisor card */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <div style={{
                    width: 28, height: 28,
                    borderRadius: 'var(--r-md)',
                    background: 'rgba(var(--primary-rgb),0.12)',
                    border: '1px solid rgba(var(--primary-rgb),0.20)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--primary)',
                  }}>
                    <Icon.Brain />
                  </div>
                  <div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 700, letterSpacing: '0.04em' }}>
                      AI Setpoint Advisor
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-low)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>
                      NSGA-II optimisation
                    </div>
                  </div>
                </div>
              </div>

              {recommendation ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div className={`badge badge-${
                    recommendation.status === 'optimal' ? 'success' :
                    recommendation.status === 'warning' ? 'warning' : 'error'
                  }`} style={{ alignSelf: 'flex-start' }}>
                    <svg width="6" height="6" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="currentColor"/></svg>
                    {recommendation.status}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <MetricTile label="Energy saved"  value={`${recommendation.energy_savings_percent.toFixed(1)}%`}   positive />
                    <MetricTile label="Purity gain"   value={`${recommendation.purity_improvement_percent.toFixed(2)}%`} positive />
                    <MetricTile label="Exp. energy"   value={recommendation.expected_energy.toFixed(3)} />
                    <MetricTile label="Exp. purity"   value={`${recommendation.expected_purity.toFixed(1)}%`} />
                  </div>

                  {/* Setpoints */}
                  <div style={{
                    background: 'var(--bg-hover)',
                    borderRadius: 'var(--r-md)',
                    padding: '0.75rem',
                    border: '1px solid var(--border)',
                  }}>
                    <div style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.62rem',
                      color: 'var(--text-low)',
                      letterSpacing: '0.10em',
                      textTransform: 'uppercase',
                      marginBottom: 8,
                    }}>
                      Recommended Setpoints
                    </div>
                    <div style={{
                      display: 'flex',
                      gap: '0.75rem',
                    }}>
                     {[
  { label: 'Steam', unit: 'kg/h' },
  { label: 'Reflux', unit: '°C' },
  { label: 'Bottom', unit: '°C' }
].map((item, i) => (
  <div key={item.label} style={{ flex: 1 }}>
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', color: 'var(--text-low)', marginBottom: 2, textTransform: 'uppercase' }}>{item.label}</div>
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', fontWeight: 700, color: 'var(--primary)' }}>
      {recommendation.recommended_setpoints[i]?.toFixed(1) ?? '—'}
    </div>
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5rem', color: 'var(--text-low)', marginTop: 1, opacity: 0.7 }}>{item.unit}</div>
  </div>
))}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-low)',
                  fontSize: '0.82rem',
                  minHeight: 120,
                  gap: 8,
                  border: '1px dashed var(--border)',
                  borderRadius: 'var(--r-md)',
                  padding: '1.5rem',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.04em',
                }}>
                  <Icon.Chart />
                  No recommendation yet
                </div>
              )}

              <button
                className="btn btn-primary w-full"
                onClick={fetchOptimization}
                disabled={optLoading}
                style={{ justifyContent: 'center' }}
              >
                {optLoading
                  ? <><div className="spinner" style={{ width: 13, height: 13 }} /> Computing…</>
                  : <><Icon.Refresh /> Update Recommendation</>
                }
              </button>
            </div>
          </div>

          {/* ── Alerts ── */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 700, letterSpacing: '0.04em' }}>
                  Recent Alerts
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-low)', fontFamily: 'var(--font-mono)', marginTop: 2, letterSpacing: '0.06em' }}>
                  Anomaly detection · last 50 events
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {unackCount > 0 && (
                  <span className="badge badge-error">
                    {unackCount} unack'd
                  </span>
                )}
                <span className="badge badge-neutral">
                  {alerts.length} total
                </span>
              </div>
            </div>

            {alerts.length === 0 ? (
              <div style={{
                padding: '2.5rem',
                textAlign: 'center',
                color: 'var(--text-low)',
                fontSize: '0.82rem',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.06em',
                border: '1px dashed var(--border)',
                borderRadius: 'var(--r-md)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/>
                </svg>
                No anomalies detected
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {alerts.slice(0, 15).map(a => (
                  <AlertRow key={a.id} alert={a} />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{ textAlign: 'center', marginTop: '2rem', paddingBottom: '0.5rem' }}>
            <div className="optiq-badge">
              <span>OPTIQ</span> Industrial AI Platform · v1.0
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

// ── KPI Card ──────────────────────────────────────────────────────
const KpiCard: React.FC<{
  label: string
  value: string
  unit?: string
  icon: React.ReactNode
  trend?: { value: number; label: string } | null
  trendDir?: 'up' | 'down'
  alertMode?: boolean
  accentColor?: string
  status?: string
}> = ({ label, value, unit, icon, trend, trendDir = 'up', alertMode = false, accentColor, status }) => (
  <div className="kpi-card">
    {/* Top accent line */}
    <div style={{
      position: 'absolute',
      top: 0, left: 0, right: 0,
      height: 2,
      background: alertMode
        ? 'var(--error)'
        : accentColor
          ? accentColor
          : 'var(--primary)',
      opacity: 0.5,
      borderRadius: '16px 16px 0 0',
    }} />

    <div className="kpi-icon" style={{
      background: alertMode ? 'rgba(255,69,96,0.12)' : undefined,
      borderColor: alertMode ? 'rgba(255,69,96,0.22)' : undefined,
      color: alertMode ? 'var(--error)' : accentColor ? accentColor : 'var(--primary)',
    }}>
      {icon}
    </div>

    <div className="kpi-label">{label}</div>

    <div className="kpi-value" style={{
      color: alertMode && value !== '0'
        ? 'var(--error)'
        : accentColor ? accentColor : 'var(--text-hi)',
    }}>
      {value}
    </div>

    {unit && <div className="kpi-unit">{unit}</div>}

    {trend && (
      <div className={`kpi-trend ${trendDir}`}>
        {trendDir === 'up'
          ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="18 15 12 9 6 15"/></svg>
          : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>
        }
        {Math.abs(trend.value).toFixed(1)}% {trend.label}
      </div>
    )}

    {status && (
      <div style={{ marginTop: 6 }}>
        <span className={`badge badge-${status === 'connected' ? 'success' : status === 'disconnected' ? 'error' : 'warning'}`}>
          {status === 'connected' ? 'online' : status}
        </span>
      </div>
    )}
  </div>
)

// ── Metric tile (inside advisor) ──────────────────────────────────
const MetricTile: React.FC<{ label: string; value: string; positive?: boolean }> = ({ label, value, positive }) => (
  <div className="metric-tile">
    <div style={{
      fontFamily: 'var(--font-mono)',
      fontSize: '0.6rem',
      color: 'var(--text-low)',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      marginBottom: 4,
    }}>
      {label}
    </div>
    <div style={{
      fontFamily: 'var(--font-mono)',
      fontSize: '0.92rem',
      fontWeight: 700,
      color: positive ? 'var(--success)' : 'var(--text-hi)',
    }}>
      {value}
    </div>
  </div>
)

// ── Alert row ─────────────────────────────────────────────────────
const AlertRow: React.FC<{ alert: Alert }> = ({ alert: a }) => (
  <div className={`alert-row ${a.severity}`}>
    <div style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>
      {a.severity === 'critical'
        ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        : a.severity === 'warning'
          ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--info)" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      }
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        fontWeight: 600,
        fontSize: '0.84rem',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontFamily: 'var(--font-body)',
      }}>
        {a.tag_name} · {a.alert_type}
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-mid)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
        {a.description}
      </div>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
      <span className={`badge badge-${a.severity}`}>{a.severity}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--text-low)', letterSpacing: '0.04em' }}>
        {new Date(a.timestamp).toLocaleTimeString()}
      </span>
    </div>
  </div>
)

export default Dashboard