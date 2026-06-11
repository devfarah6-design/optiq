/**
 * LiveDataContext — persistent WebSocket + live prediction state.
 *
 * Lives at the App level so it never unmounts on navigation.
 * Dashboard (and any other page) reads from this context instead of
 * managing its own WS connection.
 */
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { alertApi, predictApi } from '@/api/client'
import type { Prediction, Alert, OptimizeResult, SimulationStep } from '@/api/client'

interface DataPoint { ts: number; energy: number; purity: number }

function getWsUrl(): string {
  const apiUrl = (import.meta as any).env?.VITE_API_URL as string | undefined
  if (apiUrl) return apiUrl.replace(/^http/, 'ws') + '/ws'
  return 'ws://localhost:8000/ws'
}

interface LiveDataState {
  current:        (Prediction & { readings?: number[]; tags?: Record<string, number> }) | null
  history:        DataPoint[]
  alerts:         Alert[]
  wsStatus:       'connecting' | 'connected' | 'disconnected'
  recommendation: OptimizeResult | null
  applied:        boolean
  simulation:     SimulationStep[]
  setRecommendation: (r: OptimizeResult | null) => void
  setApplied:        (v: boolean) => void
  setSimulation:     (s: SimulationStep[]) => void
  clearRecommendation: () => void
}

const LiveDataContext = createContext<LiveDataState | null>(null)

export const LiveDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [current,        setCurrent]        = useState<LiveDataState['current']>(null)
  const [history,        setHistory]        = useState<DataPoint[]>([])
  const [alerts,         setAlerts]         = useState<Alert[]>([])
  const [wsStatus,       setWsStatus]       = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [recommendation, setRecommendation] = useState<OptimizeResult | null>(null)
  const [applied,        setApplied]        = useState(false)
  const [simulation,     setSimulation]     = useState<SimulationStep[]>([])
  const wsRef = useRef<WebSocket | null>(null)

  const clearRecommendation = useCallback(() => {
    setRecommendation(null)
    setApplied(false)
    setSimulation([])
  }, [])

  const applyPrediction = useCallback((p: any) => {
    setCurrent(p as Prediction)
    setHistory(prev => [
      ...prev.slice(-499),
      { ts: p.timestamp ? new Date(p.timestamp).getTime() : Date.now(), energy: p.energy, purity: p.purity },
    ])
  }, [])

  const fetchLatest = useCallback(async () => {
    try {
      const res = await predictApi.latestFromDB()
      applyPrediction(res.data)
    } catch { /* 404 = no data yet */ }
  }, [applyPrediction])

  const connect = useCallback(() => {
    const url = getWsUrl()
    try {
      const ws = new WebSocket(url)
      wsRef.current = ws
      setWsStatus('connecting')
      ws.onopen  = () => setWsStatus('connected')
      ws.onclose = () => {
        setWsStatus('disconnected')
        setTimeout(connect, 4000)
      }
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

  // Boot once — never re-runs on navigation
  useEffect(() => {
    alertApi.list().then(r => setAlerts(r.data)).catch(() => {})
    fetchLatest()
    connect()
    return () => { wsRef.current?.close() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // HTTP polling when WS is down
  useEffect(() => {
    if (wsStatus === 'connected') return
    const id = setInterval(fetchLatest, 5000)
    return () => clearInterval(id)
  }, [wsStatus, fetchLatest])

  return (
    <LiveDataContext.Provider value={{
      current, history, alerts, wsStatus,
      recommendation, applied, simulation,
      setRecommendation, setApplied, setSimulation,
      clearRecommendation,
    }}>
      {children}
    </LiveDataContext.Provider>
  )
}

export function useLiveData(): LiveDataState {
  const ctx = useContext(LiveDataContext)
  if (!ctx) throw new Error('useLiveData must be used inside LiveDataProvider')
  return ctx
}
