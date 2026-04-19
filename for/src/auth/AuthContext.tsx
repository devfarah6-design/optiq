import React, { createContext, useContext, useState, useEffect } from 'react'
import { authApi, User } from '../api/client'

interface AuthCtx {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthCtx | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('optiq_token')
    if (!token) { setLoading(false); return }
  
    const fetchUser = async () => {
      try {
        const r = await authApi.me()
        setUser(r.data)
      } catch {
        localStorage.removeItem('optiq_token')
      } finally {
        setLoading(false)
      }
    }
  
    fetchUser()
  }, [])

  const login = async (username: string, password: string) => {
    const tokenRes = await authApi.login(username, password)
    localStorage.setItem('optiq_token', tokenRes.data.access_token)
    const me = await authApi.me()
    setUser(me.data)
  }

  const logout = () => {
    localStorage.removeItem('optiq_token')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
