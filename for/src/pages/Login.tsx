import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const Login: React.FC = () => {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password)
      navigate('/')
    } catch {
      setError('Invalid credentials. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      {/* Decorative scan-line */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        height: 1, background: 'linear-gradient(90deg, transparent, var(--primary), transparent)',
        animation: 'scan-line 6s linear infinite', opacity: 0.4, pointerEvents: 'none',
      }} />

      <div className="animate-fade-up" style={{ width: '100%', maxWidth: 400, padding: '1.5rem' }}>
        {/* Brand */}
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: '2.5rem',
            fontWeight: 800,
            color: 'var(--primary)',
            letterSpacing: '-0.04em',
            textShadow: 'var(--glow-md)',
            marginBottom: '0.25rem',
          }}>OPTIQ</div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.7rem',
            letterSpacing: '0.2em',
            color: 'var(--text-low)',
          }}>DECISION SUPPORT SYSTEM</div>
        </div>

        {/* Card */}
        <div className="card" style={{ borderColor: 'var(--border-hi)' }}>
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 4 }}>
              Sign in to your workspace
            </div>
            <div className="text-sm text-muted">
              Access is restricted to authorised personnel.
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '1rem' }}>
              <label className="input-label">Username</label>
              <input
                className="input"
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter your username"
                autoComplete="username"
                required
              />
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label className="input-label">Password</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </div>

            {error && (
              <div style={{
                background: 'rgba(255,61,90,0.08)',
                border: '1px solid rgba(255,61,90,0.25)',
                borderRadius: 'var(--r-md)',
                padding: '0.6rem 0.875rem',
                fontSize: '0.85rem',
                color: 'var(--error)',
                marginBottom: '1rem',
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary w-full btn-lg"
              disabled={loading}
            >
              {loading ? <><div className="spinner" style={{ width: 16, height: 16 }} /> Signing in…</> : 'Sign In'}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: '2rem' }}>
          <div className="optiq-badge">
            <span>OPTIQ</span> DSS · Industrial AI Platform
          </div>
        </div>
      </div>
    </div>
  )
}

export default Login
