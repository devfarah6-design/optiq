import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useBranding } from '../branding/BrandingContext'
import { useMobileNav } from '../context/MobileNavContext'
import { isAdmin } from '../api/client'

interface NavItem {
  path: string
  label: string
  icon: React.ReactNode
  /** minimum role rank required; omit = any authenticated user */
  minRole?: 'operator' | 'engineer' | 'company_admin' | 'admin'
}

const ROLE_RANK: Record<string, number> = {
  viewer: 0,
  operator: 1,
  engineer: 2,
  company_admin: 3,
  admin: 4,
  system_admin: 5,
}

function meetsMin(userRole: string | undefined, minRole: NavItem['minRole']): boolean {
  if (!minRole) return true
  const rank = ROLE_RANK[userRole ?? ''] ?? 0
  return rank >= (ROLE_RANK[minRole] ?? 0)
}

const NAV_ITEMS: NavItem[] = [
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
  {
    path: '/process-chain',
    label: 'Process Chain',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 9h16M4 15h16M9 3l-5 6 5 6M15 3l5 6-5 6"/>
      </svg>
    ),
  },
  {
    path: '/monitoring',
    label: 'Monitoring',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
  {
    path: '/statistics',
    label: 'Statistics',
    minRole: 'operator',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10"/>
        <line x1="12" y1="20" x2="12" y2="4"/>
        <line x1="6" y1="20" x2="6" y2="14"/>
        <line x1="2" y1="20" x2="22" y2="20"/>
      </svg>
    ),
  },
  {
    path: '/admin',
    label: 'Admin',
    minRole: 'company_admin',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4"/>
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
      </svg>
    ),
  },
  {
    path: '/audit-log',
    label: 'Audit Log',
    minRole: 'company_admin',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
    ),
  },
  {
    path: '/help',
    label: 'Help & Docs',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    ),
  },
]

const Sidebar: React.FC = () => {
  const { user, logout }             = useAuth()
  const { company, theme, toggleTheme } = useBranding()
  const navigate                     = useNavigate()
  const location                     = useLocation()
  const { isOpen, close }            = useMobileNav()

  const go = (path: string) => { navigate(path); close() }

  const visibleItems = NAV_ITEMS.filter(n => meetsMin(user?.role, n.minRole))

  return (
    <>
      {/* Mobile overlay backdrop */}
      {isOpen && (
        <div
          onClick={close}
          style={{
            position: 'fixed', inset: 0, zIndex: 199,
            background: 'rgba(0,0,0,0.5)',
            backdropFilter: 'blur(4px)',
            display: 'none',
          }}
          className="mobile-overlay"
        />
      )}
    <aside className={`sidebar${isOpen ? ' open' : ''}`}>

      {/* ── Mobile close button ── */}
      <button
        onClick={close}
        className="sidebar-close-btn"
        aria-label="Close menu"
        style={{
          display: 'none',
          position: 'absolute', top: 12, right: 12,
          background: 'var(--bg-hover)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)', padding: '6px',
          color: 'var(--text-mid)', cursor: 'pointer',
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>

      {/* ── Logo / company branding ── */}
      <div className="sidebar-logo">
        {company?.logo_url ? (
          <div>
            <img
              src={company.logo_url}
              alt={company.name}
              style={{
                maxHeight: 38, maxWidth: '100%',
                objectFit: 'contain', marginBottom: 6, display: 'block',
              }}
            />
            <div className="optiq-badge" style={{ marginTop: 4 }}>Powered by <span>OPTIQ</span></div>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 7,
                background: 'var(--primary)', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                boxShadow: 'var(--glow-sm)', flexShrink: 0,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                </svg>
              </div>
              <div className="font-display font-bold" style={{ color: 'var(--primary)', fontSize: '1.3rem', letterSpacing: '0.08em' }}>
                OPTIQ
              </div>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', letterSpacing: '0.14em', color: 'var(--text-low)', textTransform: 'uppercase' }}>
              Decision Support System
            </div>
          </div>
        )}

        {company?.sector && (
          <div style={{ marginTop: 8 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 999,
              background: 'rgba(var(--primary-rgb),0.10)',
              border: '1px solid rgba(var(--primary-rgb),0.20)',
              fontFamily: 'var(--font-mono)', fontSize: '0.58rem',
              letterSpacing: '0.12em', color: 'var(--primary)', textTransform: 'uppercase',
            }}>
              <svg width="6" height="6" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="currentColor"/></svg>
              {company.sector}
            </span>
          </div>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="sidebar-nav">
        <div className="nav-section-label">Navigation</div>

        {visibleItems.map(n => (
          <button
            key={n.path}
            className={`nav-item ${location.pathname === n.path ? 'active' : ''}`}
            onClick={() => go(n.path)}
          >
            <span className="nav-icon">{n.icon}</span>
            {n.label}
            {location.pathname === n.path && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                style={{ marginLeft: 'auto', opacity: 0.5 }}>
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            )}
          </button>
        ))}
      </nav>

      {/* ── Theme toggle ── */}
      <div style={{
        margin: '0 0.75rem',
        padding: '0.625rem 0.875rem',
        borderRadius: 'var(--r-md)',
        background: 'var(--bg-hover)',
        border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--text-low)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {theme === 'dark' ? 'Dark' : 'Light'} Mode
        </span>
        <button
          onClick={toggleTheme}
          style={{
            all: 'unset', cursor: 'pointer', width: 38, height: 20,
            borderRadius: 999,
            background: theme === 'dark' ? 'rgba(var(--primary-rgb),0.15)' : 'rgba(var(--primary-rgb),0.25)',
            border: '1px solid var(--border-hi)',
            position: 'relative', transition: 'all 0.2s', flexShrink: 0,
          }}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          <div style={{
            position: 'absolute', top: 2, left: theme === 'dark' ? 2 : 18,
            width: 14, height: 14, borderRadius: '50%',
            background: 'var(--primary)', transition: 'left 0.2s var(--ease)',
            boxShadow: 'var(--glow-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center',
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
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0.5rem 0.625rem', marginBottom: '0.5rem',
          borderRadius: 'var(--r-md)', background: 'var(--bg-hover)', border: '1px solid var(--border)',
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'rgba(var(--primary-rgb),0.15)',
            border: '1px solid rgba(var(--primary-rgb),0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--primary)', fontSize: '0.7rem', fontWeight: 700,
            fontFamily: 'var(--font-display)', letterSpacing: '0.04em', flexShrink: 0,
          }}>
            {user?.username?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-hi)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.username}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--primary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {user?.role}
            </div>
          </div>
        </div>

        <button className="btn btn-ghost btn-sm w-full" onClick={logout} style={{ justifyContent: 'center', gap: 6 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Logout
        </button>
      </div>
    </aside>
    </>
  )
}

export default Sidebar
