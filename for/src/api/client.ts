/**
 * OPTIQ DSS · API Client
 * Central axios instance with auth interceptors + typed helper methods.
 */
import axios from 'axios'

const BASE_URL = 'http://localhost:8000'

export const api = axios.create({ baseURL: BASE_URL })

// Attach JWT on every request
api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('optiq_token')
  if (token && cfg.headers) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

// 401 → clear token and redirect to login
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('optiq_token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// ── Typed request helpers ─────────────────────────────────────────────────────
export const authApi = {
  login: (username: string, password: string) => {
    const fd = new FormData()
    fd.append('username', username)
    fd.append('password', password)
    return api.post<{ access_token: string; token_type: string }>('/token', fd)
  },
  me: () => api.get<User>('/users/me'),
  createUser: (data: { username: string; password: string; role: string }) =>
    api.post<User>('/users', data),
}

export const predictApi = {
  predict: (readings: number[]) =>
    api.post<Prediction>('/predict', { readings }),
  optimize: (current_state: number[]) =>
    api.post<OptimizeResult>('/optimize', { current_state }),
}

export const alertApi = {
  list: (limit = 50) => api.get<Alert[]>(`/alerts?limit=${limit}`),
  acknowledge: (id: number) => api.patch(`/alerts/${id}/acknowledge`),
}

export const adminApi = {
  listCompanies: () => api.get<Company[]>('/admin/companies'),
  createCompany: (data: CompanyCreate) => api.post<Company>('/admin/companies', data),
  updateCompany: (id: number, data: Partial<CompanyCreate>) =>
    api.put<Company>(`/admin/companies/${id}`, data),
  deleteCompany: (id: number) => api.delete(`/admin/companies/${id}`),
  getConfig: () => api.get<Record<string, unknown>>('/admin/config'),
  setConfig: (key: string, value: unknown) => api.post('/admin/config', { key, value }),
}

export const brandingApi = {
  get: (slug: string) => api.get<Company>(`/branding/${slug}`),
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface User {
  id: number
  username: string
  role: string
  is_active: boolean
  company_id: number | null
}

export interface Prediction {
  energy: number
  purity: number
  stability: number
  model_type: string
  confidence: number
  is_outlier: boolean
  outlier_score: number
  timestamp: string
}

export interface OptimizeResult {
  current_setpoints: number[]
  recommended_setpoints: number[]
  current_energy: number
  expected_energy: number
  current_purity: number
  expected_purity: number
  energy_savings_percent: number
  purity_improvement_percent: number
  status: 'optimal' | 'warning' | 'critical'
  feasibility_score: number
}

export interface Alert {
  id: number
  timestamp: string
  alert_type: string
  tag_name: string
  severity: 'info' | 'warning' | 'critical'
  value: number | null
  threshold: number | null
  z_score: number | null
  description: string
  acknowledged: boolean
}

export interface Company {
  id: number
  slug: string
  name: string
  sector: string
  logo_url: string | null
  primary_color: string
  accent_color: string
  background_color: string
  api_endpoint: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CompanyCreate {
  slug: string
  name: string
  sector: string
  logo_url?: string
  primary_color: string
  accent_color: string
  background_color: string
}
