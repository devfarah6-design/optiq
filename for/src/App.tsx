// src/App.tsx
import React from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { BrandingProvider } from './branding/BrandingContext'
import { ProtectedRoute } from './auth/ProtectedRoute'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Admin from './pages/Admin'
import Monitoring from './pages/Monitoring'

function App() {
  return (
    <BrowserRouter>                      {/* ← moved to outermost */}
      <AuthProvider>
        <BrandingProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={
              <ProtectedRoute><Dashboard /></ProtectedRoute>
            } />
            <Route path="/admin" element={
              <ProtectedRoute adminOnly><Admin /></ProtectedRoute>
            } />
             <Route path="/monitoring" element={
  <ProtectedRoute><Monitoring /></ProtectedRoute>
} />
            <Route path="*" element={<Login />} />
          </Routes>
        </BrandingProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App