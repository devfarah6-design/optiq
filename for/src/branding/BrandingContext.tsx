/**
 * OPTIQ DSS · Branding + Theme Context v3
 * Handles company branding AND light/dark mode.
 * Now also sets --primary-rgb and --accent-rgb for rgba() usage in CSS.
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { brandingApi, Company } from '../api/client'

type Theme = 'dark' | 'light'

interface BrandingCtx {
  company:        Company | null
  loading:        boolean
  theme:          Theme
  toggleTheme:    () => void
  setCompanySlug: (slug: string) => void
}

const BrandingContext = createContext<BrandingCtx>({
  company: null, loading: false,
  theme: 'dark', toggleTheme: () => {},
  setCompanySlug: () => {},
})

/** Convert a hex colour (#RRGGBB or #RGB) to "R,G,B" for CSS rgba() */
function hexToRgb(hex: string): string {
  const clean = hex.replace('#', '')
  const full = clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `${r},${g},${b}`
}

export const BrandingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(false)

  // ── Theme ──────────────────────────────────────────────────────
  const getInitialTheme = (): Theme => {
    const stored = localStorage.getItem('optiq_theme') as Theme | null
    if (stored) return stored
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('optiq_theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() =>
    setTheme(t => t === 'dark' ? 'light' : 'dark'), [])

  // ── Branding ───────────────────────────────────────────────────
  const applyBranding = useCallback((c: Company) => {
    const root = document.documentElement
    root.style.setProperty('--primary', c.primary_color)
    root.style.setProperty('--primary-rgb', hexToRgb(c.primary_color))
    root.style.setProperty('--accent', c.accent_color)
    root.style.setProperty('--accent-rgb', hexToRgb(c.accent_color))
    // Derive glow from primary
    const rgb = hexToRgb(c.primary_color)
    root.style.setProperty('--glow-sm', `0 0 12px rgba(${rgb},0.22)`)
    root.style.setProperty('--glow-md', `0 0 28px rgba(${rgb},0.38)`)
    root.style.setProperty('--glow-lg', `0 0 60px rgba(${rgb},0.20)`)
  }, [])

  const load = useCallback(async (slug: string) => {
    setLoading(true)
    try {
      const res = await brandingApi.get(slug)
      setCompany(res.data)
      applyBranding(res.data)
      localStorage.setItem('optiq_company_slug', slug)
    } catch {
      // Keep default OPTIQ colours
    } finally {
      setLoading(false)
    }
  }, [applyBranding])

  useEffect(() => {
    const slug = localStorage.getItem('optiq_company_slug')
    if (slug) load(slug)
  }, [load])

  return (
    <BrandingContext.Provider value={{
      company, loading, theme, toggleTheme, setCompanySlug: load,
    }}>
      {children}
    </BrandingContext.Provider>
  )
}

export const useBranding = () => useContext(BrandingContext)