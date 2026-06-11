// src/App.tsx
import React from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { BrandingProvider } from './branding/BrandingContext'
import { MobileNavProvider } from './context/MobileNavContext'
import { ProtectedRoute } from './auth/ProtectedRoute'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Admin from './pages/Admin'
import Monitoring from './pages/Monitoring'
import ProcessChain from './pages/ProcessChain'
import Statistics from './pages/Statistics'
import AuditLog from './pages/AuditLog'
import Help from './pages/Help'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <BrandingProvider>
          <MobileNavProvider>
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route path="/" element={
              <ProtectedRoute><Dashboard /></ProtectedRoute>
            } />

            <Route path="/monitoring" element={
              <ProtectedRoute><Monitoring /></ProtectedRoute>
            } />

            {/* Process chain — all authenticated users */}
            <Route path="/process-chain" element={
              <ProtectedRoute><ProcessChain /></ProtectedRoute>
            } />

            {/* Statistics — operator+ */}
            <Route path="/statistics" element={
              <ProtectedRoute><Statistics /></ProtectedRoute>
            } />

            {/* Admin panel — company_admin+ */}
            <Route path="/admin" element={
              <ProtectedRoute adminOnly><Admin /></ProtectedRoute>
            } />

            {/* Audit log — company_admin+ */}
            <Route path="/audit-log" element={
              <ProtectedRoute adminOnly><AuditLog /></ProtectedRoute>
            } />

            {/* Help & Documentation — all authenticated users */}
            <Route path="/help" element={
              <ProtectedRoute><Help /></ProtectedRoute>
            } />

            <Route path="*" element={<Login />} />
          </Routes>
          </MobileNavProvider>
        </BrandingProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
