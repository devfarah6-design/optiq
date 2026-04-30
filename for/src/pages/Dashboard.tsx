import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  PointElement, LineElement, Filler, Tooltip, Legend,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import Sidebar from '@/components/Sidebar'
import { alertApi, predictApi, Alert, OptimizeResult, Prediction } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
import { useBranding } from '@/branding/BrandingContext'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

// ── WebSocket URL builder ─────────────────────────────────────────────────────
// Correctly converts http/https → ws/wss for production
function getWsUrl(): string {
  const apiUrl = (import.meta as any).env?.VITE_API_URL as string | undefined
  if (apiUrl) {
    // Replace http:// → ws://, https:// → wss://
    return apiUrl.replace(/^http/, 'ws') + '/ws'
  }
  // Local dev fallback
  return 'ws://localhost:8000/ws'
}

interface DataPoint { ts: number; energy: number; purity: number }

const Dashboard: React.FC = () => {
  const { user }       = useAuth()
  const { company }    = useBranding()
  const [current,        setCurrent]        = useState<Prediction | null>(null)
  const [history,        setHistory]        = useState<DataPoint[]>([])
  const [alerts,         setAlerts]         = useState<Alert[]>([])
  const [recommendation, setRecommendation] = useState<OptimizeResult | null>(null)
  const [optLoading,     setOptLoading]     = useState(false)
  const [wsStatus,       setWsStatus]       = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [exportLoading,  setExportLoading]  = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  // ── WebSocket ──────────────────────────────────────────────────────────────
  const connect = useCallback(() => {
    const url = getWsUrl()
    console.log('[WS] Connecting to:', url)

    try {
      const ws = new WebSocket(url)
      wsRef.current = ws
      setWsStatus('connecting')

      ws.onopen  = () => {
        console.log('[WS] Connected')
        setWsStatus('connected')
      }
      ws.onclose = (e) => {
        console.log('[WS] Closed:', e.code, e.reason)
        setWsStatus('disconnected')
        setTimeout(connect, 4000)
      }
      ws.onerror = (e) => {
        console.error('[WS] Error:', e)
        ws.close()
      }
      ws.onmessage = ev => {
        try {
          const msg = JSON.parse(ev.data as string)
          if (msg.type === 'new_prediction') {
            const p = msg as Prediction & { type: string }
            setCurrent(p)
            setHistory(prev => [
              ...prev.slice(-59),
              { ts: Date.now(), energy: p.energy, purity: p.purity },
            ])
          } else if (msg.type === 'new_alert') {
            setAlerts(prev => [msg.alert as Alert, ...prev.slice(0, 49)])
          }
        } catch { /* ignore parse errors */ }
      }
    } catch (err) {
      console.error('[WS] Failed to create WebSocket:', err)
      setWsStatus('disconnected')
      setTimeout(connect, 4000)
    }
  }, [])

  useEffect(() => {
    alertApi.list().then(r => setAlerts(r.data)).catch(() => {})
    connect()
    return () => { wsRef.current?.close() }
  }, [connect])

  // ── Optimisation ────────────────────────────────────────────────────────────
  const fetchOptimization = async () => {
    setOptLoading(true)
    try {
      // Debug: Log available tags
      if (current?.tags) {
        console.log('Available tags:', Object.keys(current.tags))
        console.log('SP tags found:', Object.keys(current.tags).filter(k => k.includes('.SP')))
        console.log('PV values:', {
          steam_pv: current?.tags?.['2FI422.PV'],
          steam_sp: current?.tags?.['2FI422.SP'],
          reflux_pv: current?.tags?.['2TI1_414.PV'],
          reflux_sp: current?.tags?.['2TI1_414.SP'],
          bottom_pv: current?.tags?.['2TIC403.PV'],
          bottom_sp: current?.tags?.['2TIC403.SP'],
        })
      }
      
      const currentSetpoints = [
        current?.tags?.['2FI422.SP']  ?? current?.tags?.['2FI422.PV'] ?? 3000.0,
        current?.tags?.['2TI1_414.SP'] ?? current?.tags?.['2TI1_414.PV'] ?? 74.0,
        current?.tags?.['2TIC403.SP']  ?? current?.tags?.['2TIC403.PV'] ?? 94.0,
      ]
      
      console.log('Sending setpoints to optimizer:', currentSetpoints)
      const res = await predictApi.optimize(currentSetpoints)
      setRecommendation(res.data)
    } catch (e) { 
      console.error('Optimize failed:', e)
    } finally { 
      setOptLoading(false)
    }
  }

  // ── PDF Export ─────────────────────────────────────────────────────────────
  const exportPDF = async () => {
    setExportLoading(true)
    try {
      // Build HTML report and print to PDF via browser
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
<html>
<head>
  <meta charset="UTF-8"/>
  <title>OPTIQ DSS Report — ${now}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 24px; color: #1a1a1a; }
    .header { background: #0D1B2A; color: white; padding: 20px 24px; border-radius: 8px; margin-bottom: 24px; }
    .header h1 { margin:0; font-size:22px; color:#00D9FF; }
    .header p  { margin:4px 0 0; font-size:13px; color:#7A9BB5; }
    .kpi-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:24px; }
    .kpi { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:14px; }
    .kpi-label { font-size:10px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:#64748b; }
    .kpi-value { font-size:24px; font-weight:700; color:#0D1B2A; margin:4px 0 2px; font-family:monospace; }
    .kpi-unit  { font-size:11px; color:#94a3b8; }
    h2 { font-size:16px; color:#0D1B2A; border-bottom:2px solid #00D9FF; padding-bottom:6px; margin:24px 0 12px; }
    table { width:100%; border-collapse:collapse; font-family:Arial,sans-serif; }
    th { background:#0D1B2A; color:white; padding:8px; font-size:12px; text-align:left; }
    .footer { margin-top:32px; text-align:center; font-size:11px; color:#94a3b8; border-top:1px solid #e2e8f0; padding-top:12px; }
    @media print { body { padding:0; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>OPTIQ DSS — Process Monitoring Report</h1>
    <p>DC4 Butane Debutanizer · Generated: ${now} · Operator: ${user?.username}</p>
  </div>

  <div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-label">Energy Consumption</div>
      <div class="kpi-value">${current?.energy.toFixed(4) ?? '—'}</div>
      <div class="kpi-unit">kg steam / kg butane</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Butane Purity</div>
      <div class="kpi-value">${current?.purity.toFixed(2) ?? '—'}%</div>
      <div class="kpi-unit">Product quality</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Process Stability</div>
      <div class="kpi-value">${current ? (current.stability*100).toFixed(1) : '—'}%</div>
      <div class="kpi-unit">Model confidence</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Active Alerts</div>
      <div class="kpi-value" style="color:${alerts.filter(a=>!a.acknowledged).length>0?'#dc2626':'#16a34a'}">${alerts.filter(a=>!a.acknowledged).length}</div>
      <div class="kpi-unit">Unacknowledged</div>
    </div>
  </div>

  ${recommendation ? `
  <h2>AI Setpoint Recommendation</h2>
  <table>
    <tr><th>Metric</th><th>Current</th><th>Recommended</th><th>Improvement</th></tr>
    <tr><td>Energy (kg/kg)</td><td>${recommendation.current_energy.toFixed(4)}</td><td>${recommendation.expected_energy.toFixed(4)}</td><td style="color:#16a34a;font-weight:700">-${recommendation.energy_savings_percent.toFixed(1)}%</td></tr>
    <tr><td>Purity (%)</td><td>${recommendation.current_purity.toFixed(2)}%</td><td>${recommendation.expected_purity.toFixed(2)}%</td><td style="color:#16a34a;font-weight:700">+${recommendation.purity_improvement_percent.toFixed(2)}%</td></tr>
    <tr><td>Steam setpoint</td><td colspan="2">${recommendation.recommended_setpoints[0]?.toFixed(1)} kg/h</td><td><span style="background:${recommendation.status==='optimal'?'#dcfce7':'#fef3c7'};padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700">${recommendation.status.toUpperCase()}</span></td></tr>
  </table>` : ''}

  <h2>Recent Process History (last 20 readings)</h2>
  <table>
    <tr><th>Time</th><th>Energy (kg/kg)</th><th>Purity (%)</th></tr>
    ${historyRows || '<tr><td colspan="3" style="padding:12px;text-align:center;color:#94a3b8">No history yet</td></tr>'}
  </table>

  <h2>Recent Alerts (last 20)</h2>
  <table>
    <tr><th>Time</th><th>Tag</th><th>Severity</th><th>Description</th></tr>
    ${alertsHtml || '<tr><td colspan="4" style="padding:12px;text-align:center;color:#94a3b8">No alerts</td></tr>'}
  </table>

  <div class="footer">OPTIQ DSS · DC4 Butane Debutanizer · Powered by OPTIQ · Made in Algeria</div>
</body>
</html>`

      const w = window.open('', '_blank')
      if (w) {
        w.document.write(html)
        w.document.close()
        setTimeout(() => w.print(), 500)
      }
    } catch (e) {
      console.error('Export failed:', e)
    } finally {
      setExportLoading(false)
    }
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
        fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2,
      },
      {
        label: 'Purity (%)',
        data: history.map(d => d.purity),
        borderColor: accent,
        backgroundColor: `${accent}12`,
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
        callbacks: {
          label: (ctx: any) => {
            const label = ctx.dataset.label || ''
            return ` ${label}: ${ctx.parsed.y.toFixed(4)}`
          },
        },
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
          <div>
            <div className="font-display font-bold text-xl">
              {company?.name ?? 'OPTIQ'} · DC4 Debutanizer DSS
            </div>
            <div className="text-xs text-muted" style={{ fontFamily: 'var(--font-mono)' }}>
              Live Process Monitoring
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* WebSocket status */}
            <div className="flex items-center gap-2">
              <div className={`status-dot ${wsStatus !== 'connected' ? 'error' : ''}`} />
              <span className="text-xs text-muted" style={{ fontFamily: 'var(--font-mono)' }}>
                {wsStatus === 'connected' ? 'LIVE' : wsStatus === 'connecting' ? 'CONNECTING…' : 'OFFLINE'}
              </span>
            </div>
            {/* PDF Export */}
            <button
              className="btn btn-ghost btn-sm"
              onClick={exportPDF}
              disabled={exportLoading}
              title="Export report as PDF"
            >
              {exportLoading ? '⏳' : '⬇'} PDF Report
            </button>
            <div className="text-xs text-lo">{user?.username} · {user?.role}</div>
          </div>
        </header>

        <main className="page-content">

          {/* KPI row */}
          <div className="kpi-grid mb-6">
            <KpiCard
              label="Energy Consumption"
              value={current ? current.energy.toFixed(4) : '—'}
              unit="kg steam / kg butane"
              delay={0}
            />
            <KpiCard
              label="Product Purity"
              value={current ? `${current.purity.toFixed(2)}%` : '—'}
              unit="Butane purity"
              color="var(--accent)" delay={60}
            />
            <KpiCard
              label="Process Stability"
              value={current ? `${(current.stability * 100).toFixed(1)}%` : '—'}
              unit="Model confidence"
              color="var(--success)" delay={120}
            />
            <KpiCard
              label="Active Alerts"
              value={String(unacked)}
              unit="Unacknowledged"
              color={unacked > 0 ? 'var(--error)' : 'var(--success)'}
              delay={180}
            />
          </div>

          {/* Chart + Advisor */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: '1rem', marginBottom: '1.5rem' }}>
            <div className="card">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <div className="font-semibold">Process Trends</div>
                  <div className="text-xs text-muted">Last 60 samples · live update every 5s</div>
                </div>
                {wsStatus === 'disconnected' && (
                  <div className="badge badge-error">WebSocket Offline — reconnecting…</div>
                )}
                {history.length === 0 && wsStatus === 'connected' && (
                  <div className="badge badge-info">Waiting for first data point…</div>
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
                <div className="text-xs text-muted">NSGA-II multi-objective optimisation</div>
              </div>
              {recommendation ? (
  <div style={{ flex: 1 }}>

    {/* Status badge */}
    <div className={`badge badge-${
      recommendation.status === 'optimal'  ? 'success' :
      recommendation.status === 'warning'  ? 'warning' : 'error'
    } mb-3`}>
      {recommendation.status.toUpperCase()}
    </div>

    {/* No-improvement message */}
    {recommendation.energy_savings_percent <= 0 && (
      <div style={{
        background: 'rgba(0,217,255,0.06)',
        border: '1px solid rgba(0,217,255,0.15)',
        borderRadius: 'var(--r-md)',
        padding: '0.6rem 0.875rem',
        fontSize: '0.8rem',
        color: 'var(--text-mid)',
        marginBottom: '0.75rem',
      }}>
        Current operation is near-optimal for this model. No improvement found.
      </div>
    )}

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
      <Metric
        label="Energy savings"
        value={recommendation.energy_savings_percent > 0
          ? `-${recommendation.energy_savings_percent.toFixed(1)}%`
          : 'Near optimal'}
        positive={recommendation.energy_savings_percent > 0}
      />
      <Metric
        label="Purity gain"
        value={recommendation.purity_improvement_percent > 0.01
          ? `+${recommendation.purity_improvement_percent.toFixed(2)}%`
          : 'Unchanged'}
        positive={recommendation.purity_improvement_percent > 0.01}
      />
      <Metric label="Current energy" value={recommendation.current_energy.toFixed(4)} />
      <Metric label="Best found"     value={recommendation.expected_energy.toFixed(4)} />
    </div>

    <div className="text-xs text-muted mb-1">Recommended setpoints</div>
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--primary)', lineHeight: 1.8 }}>
      Steam:  {recommendation.recommended_setpoints[0]?.toFixed(1)} kg/h<br/>
      Reflux: {recommendation.recommended_setpoints[1]?.toFixed(1)} °C<br/>
      Bottom: {recommendation.recommended_setpoints[2]?.toFixed(1)} °C
    </div>
  </div>
) : (
                <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--text-low)', fontSize: '0.85rem', textAlign: 'center', padding: '1rem' }}>
                  Click below to compute<br/>optimal setpoints
                </div>
              )}
              <button className="btn btn-primary w-full" onClick={fetchOptimization} disabled={optLoading}>
                {optLoading
                  ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Computing…</>
                  : '⚡ Update Recommendation'
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
            <div className="optiq-badge"><span>OPTIQ</span> Industrial AI Platform · v1.0</div>
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