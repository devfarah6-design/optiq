/**
 * OPTIQ DSS · Branding Context
 * Applies company-specific CSS variables while keeping OPTIQ brand intact.
 * Company slug is read from localStorage (set by admin panel or login flow).
 */
import React, { createContext, useContext, useState, useEffect } from 'react'
import { brandingApi, Company } from '../api/client'

interface BrandingCtx {
  company: Company | null
  loading: boolean
  setCompanySlug: (slug: string) => void
}

const BrandingContext = createContext<BrandingCtx>({
  company: null, loading: false, setCompanySlug: () => {},
})

export const BrandingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(false)

  const applyBranding = (c: Company) => {
    const root = document.documentElement
    root.style.setProperty('--primary', c.primary_color)
    root.style.setProperty('--accent', c.accent_color)
    root.style.setProperty('--navy', c.background_color)
    // Recalculate dependent tokens
    root.style.setProperty('--glow-sm',
      `0 0 10px ${c.primary_color}40`)
    root.style.setProperty('--glow-md',
      `0 0 24px ${c.primary_color}66`)
  }

  const load = async (slug: string) => {
    setLoading(true)
    try {
      const res = await brandingApi.get(slug)
      setCompany(res.data)
      applyBranding(res.data)
      localStorage.setItem('optiq_company_slug', slug)
    } catch {
      // Silently ignore – default OPTIQ colours remain
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const slug = localStorage.getItem('optiq_company_slug')
    if (slug) load(slug)
  }, [])

  return (
    <BrandingContext.Provider value={{ company, loading, setCompanySlug: load }}>
      {children}
    </BrandingContext.Provider>
  )
}

export const useBranding = () => useContext(BrandingContext)
