import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  PointElement, LineElement, Filler, Tooltip, Legend,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import Sidebar from '../components/Sidebar'
import { alertApi, predictApi, Alert, OptimizeResult, Prediction } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useBranding } from '../branding/BrandingContext'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

const BASE_URL = 'http://localhost:8000'

interface DataPoint { ts: number; energy: number; purity: number }

const Dashboard: React.FC = () => {
  const { user } = useAuth()
  const { company } = useBranding()
  const [current, setCurrent] = useState<Prediction | null>(null)
  const [history, setHistory] = useState<DataPoint[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [recommendation, setRecommendation] = useState<OptimizeResult | null>(null)
  const [optLoading, setOptLoading] = useState(false)
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const wsRef = useRef<WebSocket | null>(null)

  // ── WebSocket ──────────────────────────────────────────────────────────────
  const connect = useCallback(() => {
    const proto = BASE_URL.startsWith('https') ? 'wss' : 'ws'
    const host = BASE_URL.replace(/^https?:\/\//, '')
    const ws = new WebSocket(`${proto}://${host}/ws`)
    wsRef.current = ws

    ws.onopen = () => setWsStatus('connected')
    ws.onclose = () => {
      setWsStatus('disconnected')
      setTimeout(connect, 3000)   // auto-reconnect
    }
    ws.onerror = () => ws.close()
    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'new_prediction') {
          const p: Prediction = msg
          setCurrent(p)
          setHistory(prev => [
            ...prev.slice(-59),
            { ts: Date.now(), energy: p.energy, purity: p.purity },
          ])
        } else if (msg.type === 'new_alert') {
          setAlerts(prev => [msg.alert, ...prev.slice(0, 49)])
        }
      } catch { /* ignore parse errors */ }
    }
  }, [])

  useEffect(() => {
    alertApi.list().then(r => setAlerts(r.data)).catch(() => {})
    connect()
    return () => wsRef.current?.close()
  }, [connect])

  // ── Optimisation ────────────────────────────────────────────────────────────
  const fetchOptimization = async () => {
    setOptLoading(true)
    try {
      const mockState = [65.0, 72.0, 58.0]   // T1, T2, T3 setpoints
      const res = await predictApi.optimize(mockState)
      setRecommendation(res.data)
    } catch { /* ignore */ }
    finally { setOptLoading(false) }
  }

  // ── Chart ───────────────────────────────────────────────────────────────────
  const primary = company?.primary_color ?? '#00D9FF'
  const accent  = company?.accent_color  ?? '#FFD700'

  const chartData = {
    labels: history.map((_, i) => i),
    datasets: [
      {
        label: 'Energy (kg/kg)',
        data: history.map(d => d.energy),
        borderColor: primary,
        backgroundColor: `${primary}18`,
        fill: true, tension: 0.4,
        pointRadius: 0, borderWidth: 2,
      },
      {
        label: 'Purity (%)',
        data: history.map(d => d.purity),
        borderColor: accent,
        backgroundColor: `${accent}12`,
        fill: true, tension: 0.4,
        pointRadius: 0, borderWidth: 2,
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
        borderColor: 'rgba(0,217,255,0.2)',
        borderWidth: 1,
      },
    },
    scales: {
      x: { display: false },
      y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7A9BB5', font: { size: 10 } } },
    },
  }

  const statusClass = current?.is_outlier ? 'warn' : 'error'

  return (
    <div className="app-shell">
      <Sidebar />

      <div className="main-content">
        {/* Topbar */}
        <header className="topbar">
          <div>
            <div className="font-display font-bold text-xl">
              {company?.name ?? 'OPTIQ'} · DC4 Debutanizer DSS
            </div>
            <div className="text-xs text-muted" style={{ fontFamily: 'var(--font-mono)' }}>
              Live Process Monitoring
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={`status-dot ${wsStatus === 'connected' ? '' : statusClass}`} />
            <span className="text-xs text-muted" style={{ fontFamily: 'var(--font-mono)' }}>
              {wsStatus === 'connected' ? 'LIVE' : wsStatus.toUpperCase()}
            </span>
            <div className="text-xs text-lo">
              {user?.username} · {user?.role}
            </div>
          </div>
        </header>

        <main className="page-content">
          {/* KPI Cards */}
          <div className="kpi-grid mb-6">
            <div className="kpi-card animate-fade-up" style={{ animationDelay: '0ms' }}>
              <div className="kpi-label">Energy Consumption</div>
              <div className="kpi-value">
                {current ? current.energy.toFixed(3) : '—'}
              </div>
              <div className="kpi-unit">kg steam / kg butane</div>
            </div>
            <div className="kpi-card animate-fade-up" style={{ animationDelay: '60ms' }}>
              <div className="kpi-label">Product Purity</div>
              <div className="kpi-value" style={{ color: 'var(--accent)' }}>
                {current ? `${current.purity.toFixed(1)}%` : '—'}
              </div>
              <div className="kpi-unit">Butane purity</div>
            </div>
            <div className="kpi-card animate-fade-up" style={{ animationDelay: '120ms' }}>
              <div className="kpi-label">Process Stability</div>
              <div className="kpi-value" style={{ color: 'var(--success)' }}>
                {current ? `${(current.stability * 100).toFixed(1)}%` : '—'}
              </div>
              <div className="kpi-unit">Model confidence</div>
            </div>
            <div className="kpi-card animate-fade-up" style={{ animationDelay: '180ms' }}>
              <div className="kpi-label">Active Alerts</div>
              <div className="kpi-value" style={{
                color: alerts.filter(a => !a.acknowledged).length > 0 ? 'var(--error)' : 'var(--success)',
              }}>
                {alerts.filter(a => !a.acknowledged).length}
              </div>
              <div className="kpi-unit">Unacknowledged</div>
            </div>
          </div>

          {/* Row: Chart + Recommendation */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '1rem', marginBottom: '1.5rem' }}
               className="chart-recommendation-grid">
            {/* Chart */}
            <div className="card">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <div className="font-semibold">Process Trends</div>
                  <div className="text-xs text-muted">Last 60 samples · live update</div>
                </div>
                {history.length === 0 && (
                  <div className="badge badge-info">Awaiting data…</div>
                )}
              </div>
              <div className="chart-wrap">
                <Line data={chartData} options={chartOpts} />
              </div>
            </div>

            {/* AI Advisor */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <div className="font-semibold mb-1">AI Setpoint Advisor</div>
                <div className="text-xs text-muted">Model-driven optimisation recommendations</div>
              </div>

              {recommendation ? (
                <div style={{ flex: 1 }}>
                  <div className="mb-3">
                    <div className={`badge badge-${recommendation.status === 'optimal' ? 'success' : recommendation.status === 'warning' ? 'warning' : 'error'}`}>
                      {recommendation.status}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <Metric label="Energy savings" value={`${recommendation.energy_savings_percent.toFixed(1)}%`} positive />
                    <Metric label="Purity gain"    value={`${recommendation.purity_improvement_percent.toFixed(2)}%`} positive />
                    <Metric label="Expected energy" value={recommendation.expected_energy.toFixed(3)} />
                    <Metric label="Expected purity" value={`${recommendation.expected_purity.toFixed(1)}%`} />
                  </div>
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div className="text-xs text-muted mb-1">Recommended setpoints</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--primary)' }}>
                      T1: {recommendation.recommended_setpoints[0]?.toFixed(1)} &nbsp;
                      T2: {recommendation.recommended_setpoints[1]?.toFixed(1)} &nbsp;
                      T3: {recommendation.recommended_setpoints[2]?.toFixed(1)}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--text-low)', fontSize: '0.85rem' }}>
                  No recommendation yet
                </div>
              )}

              <button className="btn btn-primary w-full" onClick={fetchOptimization} disabled={optLoading}>
                {optLoading ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Computing…</> : '⚡ Update Recommendation'}
              </button>
            </div>
          </div>

          {/* Alerts */}
          <div className="card">
            <div className="flex justify-between items-center mb-4">
              <div>
                <div className="font-semibold">Recent Alerts</div>
                <div className="text-xs text-muted">Anomaly detection – last 50 events</div>
              </div>
            </div>
            {alerts.length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-low)', fontSize: '0.875rem' }}>
                ✓ No alerts detected
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {alerts.slice(0, 15).map(a => (
                  <AlertRow key={a.id} alert={a} />
                ))}
              </div>
            )}
          </div>

          {/* OPTIQ footer */}
          <div style={{ textAlign: 'center', marginTop: '2rem', paddingBottom: '1rem' }}>
            <div className="optiq-badge">
              <span>OPTIQ</span> Industrial AI Platform · v1.0
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────
const Metric: React.FC<{ label: string; value: string; positive?: boolean }> = ({ label, value, positive }) => (
  <div>
    <div className="text-xs text-muted mb-1">{label}</div>
    <div style={{
      fontFamily: 'var(--font-mono)',
      fontSize: '0.95rem',
      color: positive ? 'var(--success)' : 'var(--text-hi)',
      fontWeight: 700,
    }}>{value}</div>
  </div>
)

const AlertRow: React.FC<{ alert: Alert }> = ({ alert: a }) => (
  <div className={`alert-row ${a.severity}`}>
    <span style={{ fontSize: '1rem', flexShrink: 0 }}>
      {a.severity === 'critical' ? '⛔' : a.severity === 'warning' ? '⚠️' : 'ℹ️'}
    </span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="font-semibold text-sm truncate">{a.tag_name} · {a.alert_type}</div>
      <div className="text-xs text-muted">{a.description}</div>
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
