import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useBranding } from '../branding/BrandingContext'

interface Props { onClose?: () => void }

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: '◈' },
  { path: '/admin', label: 'Admin', icon: '⚙', adminOnly: true },
]

const Sidebar: React.FC<Props> = ({ onClose }) => {
  const { user, logout } = useAuth()
  const { company } = useBranding()
  const navigate = useNavigate()
  const location = useLocation()

  const go = (path: string) => {
    navigate(path)
    onClose?.()
  }

  return (
    <aside className="sidebar">
      {/* Logo / company branding */}
      <div className="sidebar-logo">
        {company?.logo_url ? (
          <img src={company.logo_url} alt={company.name}
               style={{ maxHeight: 36, maxWidth: '100%', objectFit: 'contain', marginBottom: 6 }} />
        ) : (
          <div style={{ marginBottom: 4 }}>
            <div className="font-display font-bold text-xl" style={{ color: 'var(--primary)', letterSpacing: '-0.02em' }}>
              {company?.name ?? 'OPTIQ'}
            </div>
          </div>
        )}
        <div className="optiq-badge" style={{ marginTop: 2 }}>
          Powered by <span>OPTIQ</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        {NAV_ITEMS.filter(n => !n.adminOnly || user?.role === 'admin').map(n => (
          <button
            key={n.path}
            className={`nav-item ${location.pathname === n.path ? 'active' : ''}`}
            onClick={() => go(n.path)}
          >
            <span style={{ fontSize: '1rem', width: 18, textAlign: 'center' }}>{n.icon}</span>
            {n.label}
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="text-xs text-lo mb-2" style={{ fontFamily: 'var(--font-mono)' }}>
          {user?.username} · {user?.role}
        </div>
        <button className="btn btn-ghost btn-sm w-full" onClick={logout}>
          Logout
        </button>
      </div>
    </aside>
  )
}

export default Sidebar
