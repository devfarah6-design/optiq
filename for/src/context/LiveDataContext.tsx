/**
 * LiveDataContext — persistent WebSocket + live prediction state.
 *
 * Lives at the App level so it never unmounts on navigation.
 * Only starts polling/WS AFTER the user is authenticated.
 * Stops and cleans up cleanly on logout.
 */
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { alertApi, predictApi } from '@/api/client'
import { useAuth } from '@/auth/AuthContext'
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
  const { user, loading: authLoading } = useAuth()

  const [current,        setCurrent]        = useState<LiveDataState['current']>(null)
  const [history,        setHistory]        = useState<DataPoint[]>([])
  const [alerts,         setAlerts]         = useState<Alert[]>([])
  const [wsStatus,       setWsStatus]       = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [recommendation, setRecommendation] = useState<OptimizeResult | null>(null)
  const [applied,        setApplied]        = useState(false)
  const [simulation,     setSimulation]     = useState<SimulationStep[]>([])

  const wsRef           = useRef<WebSocket | null>(null)
  // Controls whether the WS reconnect loop should keep running
  const shouldReconnect = useRef(false)
  // Tracks whether the boot sequence has already fired for this session
  const booted          = useRef(false)

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
    } catch { /* 404 = no data yet, 401 handled by interceptor */ }
  }, [applyPrediction])

  // Forward-declared so the onclose handler can reference it
  const connectRef = useRef<() => void>(() => {})

  const connect = useCallback(() => {
    if (!shouldReconnect.current) return
    const url = getWsUrl()
    try {
      const ws = new WebSocket(url)
      wsRef.current = ws
      setWsStatus('connecting')
      ws.onopen  = () => setWsStatus('connected')
      ws.onclose = () => {
        setWsStatus('disconnected')
        // Only reconnect if we're still supposed to be connected
        if (shouldReconnect.current) setTimeout(() => connectRef.current(), 4000)
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
        } catch { /* ignore malformed messages */ }
      }
    } catch {
      setWsStatus('disconnected')
      if (shouldReconnect.current) setTimeout(() => connectRef.current(), 4000)
    }
  }, [applyPrediction])

  // Keep the ref in sync so onclose closures always call the latest connect
  useEffect(() => { connectRef.current = connect }, [connect])

  // ── Boot when authenticated, stop when logged out ──────────────────────────
  useEffect(() => {
    if (authLoading) return  // wait for AuthContext to resolve

    if (!user) {
      // Logged out (or never logged in) — stop everything
      shouldReconnect.current = false
      if (wsRef.current) {
        wsRef.current.onclose = null  // prevent the onclose from scheduling a reconnect
        wsRef.current.close()
        wsRef.current = null
      }
      booted.current = false
      setWsStatus('disconnected')
      return
    }

    // User is authenticated
    if (booted.current) return  // already running — don't double-boot
    booted.current = true
    shouldReconnect.current = true

    // Load initial data
    alertApi.list().then(r => setAlerts(r.data)).catch(() => {})
    fetchLatest()
    connect()

    return () => {
      // Cleanup on unmount (shouldn't happen since this lives at App level)
      shouldReconnect.current = false
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [user, authLoading, fetchLatest, connect])

  // ── HTTP polling fallback when WS is disconnected ─────────────────────────
  useEffect(() => {
    if (!user || wsStatus === 'connected') return
    const id = setInterval(fetchLatest, 5000)
    return () => clearInterval(id)
  }, [wsStatus, fetchLatest, user])

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
