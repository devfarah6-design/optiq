import React, { useState, useEffect } from 'react'
import Sidebar from '../components/Sidebar'
import { alertApi, predictApi, Prediction } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useBranding } from '../branding/BrandingContext'

interface TagStatus {
  tag: string
  value: number
  unit: string
  nominal: number
  min: number
  max: number
  status: 'normal' | 'warning' | 'critical'
  description: string
}

const Monitoring: React.FC = () => {
  const { user } = useAuth()
  const { company } = useBranding()
  const [currentData, setCurrentData] = useState<Prediction | null>(null)
  const [tagStatuses, setTagStatuses] = useState<TagStatus[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [wsStatus, setWsStatus] = useState<'connected' | 'disconnected'>('disconnected')

  // Tag definitions with expected ranges
  const tagDefinitions = {
    '2FI422.PV': { nominal: 3000, min: 2200, max: 3800, unit: 'kg/h', desc: 'Steam flow to reboiler' },
    '2TI1_414.PV': { nominal: 74, min: 62, max: 78, unit: '°C', desc: 'Reflux temperature' },
    '2TIC403.PV': { nominal: 94, min: 88, max: 100, unit: '°C', desc: 'Bottom temperature' },
    '2PIC409.PV': { nominal: 6.2, min: 4.8, max: 7.6, unit: 'bar(g)', desc: 'Overhead pressure' },
    '2FIC419.PV': { nominal: 25, min: 12, max: 42, unit: 'm³/h', desc: 'Reflux flow rate' },
    '2LIC409.PV': { nominal: 52, min: 20, max: 80, unit: '%', desc: 'Bottom level' },
    'AI_BUTANE_C5.PV': { nominal: 0.35, min: 0, max: 0.8, unit: '%mol', desc: 'C5+ in product' },
  }

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8000/ws')
    
    ws.onopen = () => setWsStatus('connected')
    ws.onclose = () => setWsStatus('disconnected')
    
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.type === 'new_prediction') {
        setCurrentData(msg)
        
        // Process tag statuses
        const tags = msg.tags || {}
        const statuses: TagStatus[] = Object.entries(tagDefinitions).map(([tag, def]) => {
          const value = tags[tag] || def.nominal
          let status: 'normal' | 'warning' | 'critical' = 'normal'
          
          if (value < def.min || value > def.max) {
            status = 'critical'
          } else if (value < def.min * 1.1 || value > def.max * 0.9) {
            status = 'warning'
          }
          
          return {
            tag,
            value,
            unit: def.unit,
            nominal: def.nominal,
            min: def.min,
            max: def.max,
            status,
            description: def.desc
          }
        })
        
        setTagStatuses(statuses)
      }
    }
    
    return () => ws.close()
  }, [])

  const toggleTagSelection = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) 
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    )
  }

  const generateReport = () => {
    const reportData = {
      timestamp: new Date().toISOString(),
      energy: currentData?.energy,
      purity: currentData?.purity,
      tags: tagStatuses.filter(t => selectedTags.includes(t.tag) || selectedTags.length === 0),
      summary: {
        critical: tagStatuses.filter(t => t.status === 'critical').length,
        warning: tagStatuses.filter(t => t.status === 'warning').length,
        normal: tagStatuses.filter(t => t.status === 'normal').length,
      }
    }
    
    // Create downloadable report
    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `monitoring-report-${new Date().toISOString().slice(0,19)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const printReport = () => {
    window.print()
  }

  return (
    <div className="app-shell">
      <Sidebar />
      
      <div className="main-content">
        <header className="topbar">
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', margin: 0 }}>
              Process Monitoring & Analytics
            </h1>
            <p style={{ color: 'var(--text-low)', margin: '4px 0 0' }}>
              Real-time sensor health and performance metrics
            </p>
          </div>
          
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button className="btn btn-secondary" onClick={generateReport}>
              📊 Export Report
            </button>
            <button className="btn btn-primary" onClick={printReport}>
              🖨️ Print View
            </button>
          </div>
        </header>

        <main className="page-content">
          {/* Summary Cards */}
          <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
            <div className="kpi-card">
              <div className="kpi-label">System Status</div>
              <div className="kpi-value" style={{ 
                color: wsStatus === 'connected' ? 'var(--success)' : 'var(--error)' 
              }}>
                {wsStatus === 'connected' ? '● LIVE' : '○ OFFLINE'}
              </div>
            </div>
            
            <div className="kpi-card">
              <div className="kpi-label">Current Energy</div>
              <div className="kpi-value">
                {currentData?.energy.toFixed(3) || '—'} <span className="kpi-unit">kg/kg</span>
              </div>
            </div>
            
            <div className="kpi-card">
              <div className="kpi-label">Current Purity</div>
              <div className="kpi-value">
                {currentData?.purity.toFixed(1) || '—'} <span className="kpi-unit">%</span>
              </div>
            </div>
            
            <div className="kpi-card">
              <div className="kpi-label">Active Alerts</div>
              <div className="kpi-value" style={{ color: 'var(--warning)' }}>
                {tagStatuses.filter(t => t.status !== 'normal').length}
              </div>
            </div>
          </div>

          {/* Tag Status Table */}
          <div className="card">
            <div style={{ marginBottom: '1rem' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', margin: '0 0 0.5rem' }}>
                Sensor Health Monitor
              </h3>
              <p style={{ color: 'var(--text-low)', fontSize: '0.85rem', margin: 0 }}>
                Comparing current values against expected operating ranges
              </p>
            </div>
            
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '0.75rem', textAlign: 'left' }}>
                    <input 
                      type="checkbox" 
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedTags(tagStatuses.map(t => t.tag))
                        } else {
                          setSelectedTags([])
                        }
                      }}
                    />
                  </th>
                  <th style={{ padding: '0.75rem', textAlign: 'left' }}>Tag</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left' }}>Description</th>
                  <th style={{ padding: '0.75rem', textAlign: 'right' }}>Current</th>
                  <th style={{ padding: '0.75rem', textAlign: 'right' }}>Expected</th>
                  <th style={{ padding: '0.75rem', textAlign: 'right' }}>Range</th>
                  <th style={{ padding: '0.75rem', textAlign: 'center' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {tagStatuses.map(tag => (
                  <tr key={tag.tag} style={{ 
                    borderBottom: '1px solid var(--border)',
                    background: tag.status === 'critical' ? 'rgba(255,69,96,0.05)' : 
                               tag.status === 'warning' ? 'rgba(255,180,71,0.05)' : 'transparent'
                  }}>
                    <td style={{ padding: '0.75rem' }}>
                      <input 
                        type="checkbox"
                        checked={selectedTags.includes(tag.tag)}
                        onChange={() => toggleTagSelection(tag.tag)}
                      />
                    </td>
                    <td style={{ padding: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                      {tag.tag}
                    </td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-mid)' }}>
                      {tag.description}
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                      {tag.value.toFixed(2)} {tag.unit}
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-low)' }}>
                      {tag.nominal} {tag.unit}
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-low)' }}>
                      [{tag.min} - {tag.max}]
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                      <span className={`badge badge-${tag.status === 'critical' ? 'error' : tag.status === 'warning' ? 'warning' : 'success'}`}>
                        {tag.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Process Insights */}
          <div className="card" style={{ marginTop: '1.5rem' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', margin: '0 0 1rem' }}>
              Process Insights & Recommendations
            </h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--text-low)', marginBottom: '0.5rem' }}>
                  Current Operating Point
                </h4>
                <ul style={{ listStyle: 'none', padding: 0 }}>
                  <li style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                    <strong>Steam/Feed Ratio:</strong>{' '}
                    {currentData?.tags?.['2FI422.PV'] && currentData?.tags?.['FI_FEED.PV']
                      ? (currentData.tags['2FI422.PV'] / currentData.tags['FI_FEED.PV']).toFixed(2)
                      : '—'}
                  </li>
                  <li style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                    <strong>Reflux Ratio:</strong>{' '}
                    {currentData?.tags?.['2FIC419.PV'] && currentData?.tags?.['2FI449A.PV']
                      ? (currentData.tags['2FIC419.PV'] / currentData.tags['2FI449A.PV']).toFixed(2)
                      : '—'}
                  </li>
                  <li style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                    <strong>Column ΔT:</strong>{' '}
                    {currentData?.tags?.['2TIC403.PV'] && currentData?.tags?.['2TI1_409.PV']
                      ? (currentData.tags['2TIC403.PV'] - currentData.tags['2TI1_409.PV']).toFixed(1) + ' °C'
                      : '—'}
                  </li>
                </ul>
              </div>
              
              <div>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--text-low)', marginBottom: '0.5rem' }}>
                  Active Issues
                </h4>
                {tagStatuses.filter(t => t.status !== 'normal').length === 0 ? (
                  <p style={{ color: 'var(--success)' }}>✓ All systems operating normally</p>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0 }}>
                    {tagStatuses.filter(t => t.status === 'critical').map(t => (
                      <li key={t.tag} style={{ padding: '0.5rem 0', color: 'var(--error)' }}>
                        ⚠️ {t.tag}: {t.value.toFixed(2)} {t.unit} (expected {t.min}-{t.max})
                      </li>
                    ))}
                    {tagStatuses.filter(t => t.status === 'warning').map(t => (
                      <li key={t.tag} style={{ padding: '0.5rem 0', color: 'var(--warning)' }}>
                        ⚡ {t.tag}: Approaching limit ({t.value.toFixed(2)} {t.unit})
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

export default Monitoring