import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useBranding } from '../branding/BrandingContext'

const Login: React.FC = () => {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [focused, setFocused] = useState<string | null>(null)
  const { login } = useAuth()
  const navigate = useNavigate()
  const { theme, toggleTheme, company } = useBranding()

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

      {/* ── Animated scan line ── */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        height: '1px',
        background: 'linear-gradient(90deg, transparent 0%, var(--primary) 50%, transparent 100%)',
        opacity: 0.5,
        zIndex: 10,
        animation: 'scan-line 4s linear infinite',
      }} />

      {/* ── Corner decorations ── */}
      <div style={{
        position: 'fixed', top: 24, left: 24,
        width: 48, height: 48,
        borderTop: '1.5px solid var(--border-hi)',
        borderLeft: '1.5px solid var(--border-hi)',
        borderRadius: '4px 0 0 0',
        opacity: 0.6,
      }} />
      <div style={{
        position: 'fixed', bottom: 24, right: 24,
        width: 48, height: 48,
        borderBottom: '1.5px solid var(--border-hi)',
        borderRight: '1.5px solid var(--border-hi)',
        borderRadius: '0 0 4px 0',
        opacity: 0.6,
      }} />

      {/* ── Theme toggle ── */}
      <button
        onClick={toggleTheme}
        className="btn-icon"
        style={{ position: 'fixed', top: '1.25rem', right: '1.25rem', zIndex: 20 }}
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {theme === 'dark'
          ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        }
      </button>

      {/* ── Main card ── */}
      <div
        className="animate-fade-up"
        style={{ width: '100%', maxWidth: 420, padding: '1.5rem', position: 'relative', zIndex: 5 }}
      >

        {/* ── Brand header ── */}
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>

          {/* Company logo if set */}
          {company?.logo_url ? (
            <div style={{ marginBottom: '1rem' }}>
              <img
                src={company.logo_url}
                alt={company.name}
                style={{ maxHeight: 56, maxWidth: 180, objectFit: 'contain', display: 'block', margin: '0 auto' }}
              />
            </div>
          ) : (
            /* OPTIQ logo mark */
            <div style={{ marginBottom: '1rem', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              {/* Icon mark */}
              <div style={{
                width: 42, height: 42,
                borderRadius: 10,
                background: 'var(--primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'var(--glow-md)',
              }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                </svg>
              </div>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: '2.2rem',
                fontWeight: 800,
                color: 'var(--primary)',
                letterSpacing: '0.06em',
                textShadow: 'var(--glow-md)',
              }}>OPTIQ</div>
            </div>
          )}

          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.65rem',
            letterSpacing: '0.22em',
            color: 'var(--text-low)',
            textTransform: 'uppercase',
          }}>
            {company?.name ? `${company.name} · ` : ''}Decision Support System
          </div>

          {/* Sector badge */}
          {company?.sector && (
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center' }}>
              <span className="badge badge-primary">
                <svg width="8" height="8" viewBox="0 0 12 12" fill="currentColor"><circle cx="6" cy="6" r="3"/></svg>
                {company.sector}
              </span>
            </div>
          )}
        </div>

        {/* ── Login card ── */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-hi)',
          borderRadius: 'var(--r-xl)',
          padding: '2rem',
          boxShadow: 'var(--shadow-lg), var(--glow-sm)',
          backdropFilter: 'blur(8px)',
        }}>

          <div style={{ marginBottom: '1.75rem' }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.3rem',
              fontWeight: 700,
              letterSpacing: '0.04em',
              color: 'var(--text-hi)',
              marginBottom: 4,
            }}>
              Sign in to workspace
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-low)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
              Authorised personnel only
            </div>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            {/* Username */}
            <div>
              <label className="input-label">Username</label>
              <div style={{ position: 'relative' }}>
                <div style={{
                  position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                  color: focused === 'username' ? 'var(--primary)' : 'var(--text-low)',
                  transition: 'color 0.2s',
                  pointerEvents: 'none',
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                </div>
                <input
                  className="input"
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  onFocus={() => setFocused('username')}
                  onBlur={() => setFocused(null)}
                  placeholder="Enter your username"
                  autoComplete="username"
                  style={{ paddingLeft: '2.25rem' }}
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="input-label">Password</label>
              <div style={{ position: 'relative' }}>
                <div style={{
                  position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                  color: focused === 'password' ? 'var(--primary)' : 'var(--text-low)',
                  transition: 'color 0.2s',
                  pointerEvents: 'none',
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                </div>
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onFocus={() => setFocused('password')}
                  onBlur={() => setFocused(null)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  style={{ paddingLeft: '2.25rem' }}
                  required
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'rgba(255,69,96,0.08)',
                border: '1px solid rgba(255,69,96,0.25)',
                borderRadius: 'var(--r-md)',
                padding: '0.65rem 0.9rem',
                fontSize: '0.83rem',
                color: 'var(--error)',
                animation: 'fadeUp 0.2s var(--ease) both',
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              className="btn btn-primary w-full btn-lg"
              disabled={loading}
              style={{ marginTop: 4, justifyContent: 'center' }}
            >
              {loading
                ? <><div className="spinner" style={{ width: 16, height: 16 }} /> Authenticating…</>
                : <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
                    </svg>
                    Sign In
                  </>
              }
            </button>
          </form>
        </div>

        {/* ── Footer ── */}
        <div style={{
          textAlign: 'center',
          marginTop: '1.75rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
        }}>
          <div className="optiq-badge">
            Powered by <span>OPTIQ</span> · Industrial AI Platform
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.58rem',
            color: 'var(--text-low)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}>
            v1.0 · Secure Access
          </div>
        </div>

      </div>
    </div>
  )
}

export default Login