import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'

interface Props {
  children: React.ReactNode
  adminOnly?: boolean
}

export const ProtectedRoute: React.FC<Props> = ({ children, adminOnly }) => {
  const { user, loading } = useAuth()

  if (loading) return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <div className="spinner" style={{ width: 32, height: 32 }} />
    </div>
  )

  const ADMIN_ROLES = new Set(['admin', 'system_admin', 'company_admin'])

  if (!user) return <Navigate to="/login" replace />
  if (adminOnly && !ADMIN_ROLES.has(user.role)) return <Navigate to="/" replace />

  return <>{children}</>
}

export default ProtectedRoute
