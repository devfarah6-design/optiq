import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useBranding } from '../branding/BrandingContext'

interface Props { onClose?: () => void }

const NAV_ITEMS = [
  {
    path: '/',
    label: 'Dashboard',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1"/>
        <rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="14" y="14" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/>
      </svg>
    ),
  },
  // ADD THIS NEW ITEM
  {
    path: '/monitoring',
    label: 'Monitoring',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12v-2a5 5 0 0 0-5-5H8a5 5 0 0 0-5 5v2"/>
        <circle cx="12" cy="16" r="5"/>
        <line x1="12" y1="11" x2="12" y2="16"/>
        <line x1="9" y1="13" x2="15" y2="13"/>
      </svg>
    ),
  },
  {
    path: '/admin',
    label: 'Admin',
    adminOnly: true,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>
    ),
  },
]

const Sidebar: React.FC<Props> = ({ onClose }) => {
  const { user, logout } = useAuth()
  const { company, theme, toggleTheme } = useBranding()
  const navigate = useNavigate()
  const location = useLocation()

  const go = (path: string) => {
    navigate(path)
    onClose?.()
  }

  return (
    <aside className="sidebar">

      {/* ── Logo / company branding ── */}
      <div className="sidebar-logo">
        {company?.logo_url ? (
          <div>
            <img
              src={company.logo_url}
              alt={company.name}
              style={{
                maxHeight: 38,
                maxWidth: '100%',
                objectFit: 'contain',
                marginBottom: 6,
                display: 'block',
              }}
            />
            <div className="optiq-badge" style={{ marginTop: 4 }}>
              Powered by <span>OPTIQ</span>
            </div>
          </div>
        ) : (
          <div>
            {/* OPTIQ logo inline */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div style={{
                width: 28, height: 28,
                borderRadius: 7,
                background: 'var(--primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'var(--glow-sm)',
                flexShrink: 0,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                </svg>
              </div>
              <div className="font-display font-bold" style={{
                color: 'var(--primary)',
                fontSize: '1.3rem',
                letterSpacing: '0.08em',
              }}>
                OPTIQ
              </div>
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.58rem',
              letterSpacing: '0.14em',
              color: 'var(--text-low)',
              textTransform: 'uppercase',
            }}>
              Decision Support System
            </div>
          </div>
        )}

        {/* Sector badge */}
        {company?.sector && (
          <div style={{ marginTop: 8 }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              borderRadius: 999,
              background: 'rgba(var(--primary-rgb),0.10)',
              border: '1px solid rgba(var(--primary-rgb),0.20)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.58rem',
              letterSpacing: '0.12em',
              color: 'var(--primary)',
              textTransform: 'uppercase',
            }}>
              <svg width="6" height="6" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="currentColor"/></svg>
              {company.sector}
            </span>
          </div>
        )}
      </div>

      {/* ── Nav ── */}
      <nav className="sidebar-nav">
        <div className="nav-section-label">Navigation</div>

        {NAV_ITEMS.filter(n => !n.adminOnly || user?.role === 'admin').map(n => (
          <button
            key={n.path}
            className={`nav-item ${location.pathname === n.path ? 'active' : ''}`}
            onClick={() => go(n.path)}
          >
            <span className="nav-icon">{n.icon}</span>
            {n.label}

            {/* Active arrow indicator */}
            {location.pathname === n.path && (
              <svg
                width="12" height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                style={{ marginLeft: 'auto', opacity: 0.5 }}
              >
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            )}
          </button>
        ))}
      </nav>
     
      {/* ── Spacer + Theme toggle ── */}
      <div style={{
        margin: '0 0.75rem',
        padding: '0.625rem 0.875rem',
        borderRadius: 'var(--r-md)',
        background: 'var(--bg-hover)',
        border: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.62rem',
          color: 'var(--text-low)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          {theme === 'dark' ? 'Dark' : 'Light'} Mode
        </span>
        <button
          onClick={toggleTheme}
          style={{
            all: 'unset',
            cursor: 'pointer',
            width: 38,
            height: 20,
            borderRadius: 999,
            background: theme === 'dark'
              ? 'rgba(var(--primary-rgb),0.15)'
              : 'rgba(var(--primary-rgb),0.25)',
            border: '1px solid var(--border-hi)',
            position: 'relative',
            transition: 'all 0.2s',
            flexShrink: 0,
          }}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          <div style={{
            position: 'absolute',
            top: 2, left: theme === 'dark' ? 2 : 18,
            width: 14, height: 14,
            borderRadius: '50%',
            background: 'var(--primary)',
            transition: 'left 0.2s var(--ease)',
            boxShadow: 'var(--glow-sm)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {theme === 'dark'
              ? <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              : <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="5"/></svg>
            }
          </div>
        </button>
      </div>

      {/* ── Footer ── */}
      <div className="sidebar-footer">
        {/* User info */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0.5rem 0.625rem',
          marginBottom: '0.5rem',
          borderRadius: 'var(--r-md)',
          background: 'var(--bg-hover)',
          border: '1px solid var(--border)',
        }}>
          {/* Avatar */}
          <div style={{
            width: 28, height: 28,
            borderRadius: '50%',
            background: 'rgba(var(--primary-rgb),0.15)',
            border: '1px solid rgba(var(--primary-rgb),0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--primary)',
            fontSize: '0.7rem',
            fontWeight: 700,
            fontFamily: 'var(--font-display)',
            letterSpacing: '0.04em',
            flexShrink: 0,
          }}>
            {user?.username?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '0.8rem',
              fontWeight: 600,
              color: 'var(--text-hi)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {user?.username}
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.6rem',
              color: 'var(--primary)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}>
              {user?.role}
            </div>
          </div>
        </div>

        {/* Logout */}
        <button
          className="btn btn-ghost btn-sm w-full"
          onClick={logout}
          style={{ justifyContent: 'center', gap: 6 }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Logout
        </button>
      </div>
    </aside>
  )
}

export default Sidebar