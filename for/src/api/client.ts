/**
 * OPTIQ DSS · API Client v2
 * Central axios instance with auth interceptors + typed helper methods.
 */
import axios from 'axios'

export const BASE_URL = (import.meta.env.VITE_API_URL as string) || 'http://localhost:8000'

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

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (username: string, password: string) => {
    const fd = new URLSearchParams()
    fd.append('username', username)
    fd.append('password', password)
    return api.post<{ access_token: string; token_type: string }>('/token', fd)
  },
  me:         () => api.get<User>('/users/me'),
  createUser: (data: { username: string; password: string; role: string; company_id?: number | null }) =>
    api.post<User>('/users', data),
  listUsers:  () => api.get<User[]>('/users'),
  deleteUser: (id: number) => api.delete(`/users/${id}`),
}

// ── Prediction ────────────────────────────────────────────────────────────────
export const predictApi = {
  predict:      (readings: number[]) => api.post<Prediction>('/predict', { readings }),
  optimize:     (current_state: number[], column_tag = 'DC4', base_readings?: number[]) =>
    api.post<OptimizeResult>('/optimize', { current_state, column_tag, base_readings }),
  latestFromDB: (column_tag = 'DC4') =>
    api.get<Prediction & { readings?: number[]; tags?: Record<string, number> }>(
      `/predictions/latest?column_tag=${column_tag}`
    ),
}

// ── Recommendations ───────────────────────────────────────────────────────────
export const recommendationApi = {
  list:       (column_tag?: string, limit = 50) =>
    api.get<OptimizationRecord[]>(`/recommendations?limit=${limit}${column_tag ? `&column_tag=${column_tag}` : ''}`),
  apply:      (result_id: number) =>
    api.post<ApplyResult>(`/recommendations/${result_id}/apply`),
  checkDrift: (result_id: number, current_readings: Record<string, number>) =>
    api.post<DriftCheck>('/recommendations/drift-check', { result_id, current_readings }),
}

// ── Alerts ────────────────────────────────────────────────────────────────────
export const alertApi = {
  list:        (limit = 50) => api.get<Alert[]>(`/alerts?limit=${limit}`),
  acknowledge: (id: number) => api.patch(`/alerts/${id}/acknowledge`),
}

// ── Admin ─────────────────────────────────────────────────────────────────────
export const adminApi = {
  listCompanies:  () => api.get<Company[]>('/admin/companies'),
  createCompany:  (data: CompanyCreate) => api.post<Company>('/admin/companies', data),
  updateCompany:  (id: number, data: Partial<CompanyCreate>) =>
    api.put<Company>(`/admin/companies/${id}`, data),
  deleteCompany:  (id: number) => api.delete(`/admin/companies/${id}`),
  getConfig:      () => api.get<Record<string, unknown>>('/admin/config'),
  setConfig:      (key: string, value: unknown) => api.post('/admin/config', { key, value }),
  getAuditLog:    (params?: { limit?: number; action?: string; username?: string }) =>
    api.get<AuditEntry[]>(`/audit-log`, { params }),
}

// ── Sites ─────────────────────────────────────────────────────────────────────
export const siteApi = {
  list:   (company_id?: number) =>
    api.get<Site[]>(`/sites${company_id ? `?company_id=${company_id}` : ''}`),
  create: (data: SiteCreate) => api.post<Site>('/sites', data),
  update: (id: number, data: Partial<SiteCreate>) => api.put<Site>(`/sites/${id}`, data),
  delete: (id: number) => api.delete(`/sites/${id}`),
}

// ── Columns ───────────────────────────────────────────────────────────────────
export const columnApi = {
  list:   (site_id?: number) =>
    api.get<DistillationColumn[]>(`/columns${site_id ? `?site_id=${site_id}` : ''}`),
  get:    (id: number) => api.get<DistillationColumn>(`/columns/${id}`),
  create: (data: ColumnCreate) => api.post<DistillationColumn>('/columns', data),
  update: (id: number, data: Partial<ColumnCreate>) =>
    api.put<DistillationColumn>(`/columns/${id}`, data),
  delete: (id: number) => api.delete(`/columns/${id}`),
}

// ── Setpoint Config ───────────────────────────────────────────────────────────
export const spConfigApi = {
  get:    (column_tag = 'DC4') =>
    api.get<SetpointConfigOut>(`/config/setpoints?column_tag=${column_tag}`),
  update: (setpoints: SetpointEntry[], column_tag = 'DC4') =>
    api.put<SetpointConfigOut>(`/config/setpoints?column_tag=${column_tag}`, { setpoints }),
}

// ── FOPDT Process Dynamics Config ────────────────────────────────────────────
export const fopdtConfigApi = {
  get:    (column_tag = 'DC4') =>
    api.get<FopdtConfigOut>(`/config/fopdt?column_tag=${column_tag}`),
  update: (params: FopdtEntry[], horizons: number[], column_tag = 'DC4') =>
    api.put<FopdtConfigOut>(`/config/fopdt?column_tag=${column_tag}`, { params, horizons }),
  checkTracking: (result_id: number, actual_tag_values: Record<string, number>) =>
    api.post<TrackingOut>(`/recommendations/${result_id}/tracking`, actual_tag_values),
}

// ── Stats ─────────────────────────────────────────────────────────────────────
export const statsApi = {
  get: (column_tag = 'DC4', period_hours = 24) =>
    api.get<ProcessStats>(`/stats?column_tag=${column_tag}&period_hours=${period_hours}`),
}

// ── Branding ──────────────────────────────────────────────────────────────────
export const brandingApi = {
  get: (slug: string) => api.get<Company>(`/branding/${slug}`),
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface User {
  id:         number
  username:   string
  role:       'system_admin' | 'company_admin' | 'engineer' | 'operator' | 'viewer' | 'admin'
  is_active:  boolean
  company_id: number | null
}

export function isAdmin(user: User | null): boolean {
  return user?.role === 'system_admin' || user?.role === 'admin'
}

export function isCompanyAdmin(user: User | null): boolean {
  return isAdmin(user) || user?.role === 'company_admin'
}

export function canOptimize(user: User | null): boolean {
  return isCompanyAdmin(user) || user?.role === 'engineer' || user?.role === 'operator'
}

export interface Prediction {
  energy:        number
  purity:        number
  butane:        number
  stability:     number
  model_type:    string
  confidence:    number
  is_outlier:    boolean
  outlier_score: number
  timestamp:     string
  tags?:         Record<string, number>
}

export interface SetpointEntry {
  tag:          string
  desc:         string
  unit:         string
  nominal:      number
  lo:           number
  hi:           number
  recommended:  number | null
}

export interface SetpointConfigOut {
  column_tag: string
  setpoints:  SetpointEntry[]
}

export interface OptimizeResult {
  result_id?:                  number
  current_setpoints:           number[]
  recommended_setpoints:       number[]
  current_energy:              number
  expected_energy:             number
  current_purity:              number
  expected_purity:             number
  energy_savings_percent:      number
  purity_improvement_percent:  number
  current_butane:              number
  expected_butane:             number
  butane_improvement_percent:  number
  status:                      'optimal' | 'warning' | 'critical'
  feasibility_score:           number
  computed_at?:                string
  process_snapshot?:           Record<string, number>
  sp_config?:                  SetpointEntry[]
}

export interface OptimizationRecord {
  id:                     number
  column_tag:             string
  requested_by_username:  string
  requested_at:           string
  current_setpoints:      number[]
  recommended_setpoints:  number[]
  current_energy:         number
  expected_energy:        number
  energy_savings_pct:     number
  current_purity:         number
  expected_purity:        number
  purity_improvement_pct: number
  status:                 string
  feasibility_score:      number
  applied:                boolean
  applied_at:             string | null
  applied_by_username:    string | null
}

export interface SimulationStep {
  step:             number
  time_s:           number          // seconds after apply
  label:            string          // "+5 min", "+15 min", "+30 min"
  energy:           number
  purity:           number
  butane:           number
  energy_delta_pct: number
  purity_delta_pct: number
  tag_values:       Record<string, number>  // DCS-readable: {2TIC403: 94.8, ...}
}

export interface FopdtEntry {
  op_tag:  string   // controller output tag e.g. "2TIC403.OP"
  pv_tag:  string   // process variable tag e.g. "2TIC403"
  desc:    string
  unit:    string
  K:       number   // process gain (PV unit per % OP)
  tau:     number   // time constant (seconds)
  theta:   number   // dead time (seconds)
  pv_nom:  number   // nominal PV at 50% OP
}

export interface FopdtConfigOut {
  column_tag: string
  params:     FopdtEntry[]
  horizons:   number[]   // seconds: [300, 900, 1800]
}

export interface TrackingOut {
  result_id:           number
  elapsed_s:           number
  tracking_ok:         boolean
  tracking_score:      number
  worst_deviation_pct: number
  deviations:          Record<string, {
    predicted:     number
    actual:        number
    deviation_pct: number
    unit:          string
  }>
  message:             string
  suggest_reoptimize:  boolean
}

export interface ApplyResult {
  result_id:           number
  applied_at:          string
  applied_by_username: string
  message:             string
  simulation:          SimulationStep[]
}

export interface DriftCheck {
  result_id:     number
  stale:         boolean
  max_drift_pct: number
  drifted_tags:  string[]
  message:       string
}

export interface Alert {
  id:             number
  timestamp:      string
  alert_type:     string
  tag_name:       string
  severity:       'info' | 'warning' | 'critical'
  value:          number | null
  threshold:      number | null
  z_score:        number | null
  description:    string
  acknowledged:   boolean
  acknowledged_by?: string | null
  column_tag:     string
}

export interface Company {
  id:               number
  slug:             string
  name:             string
  sector:           string
  logo_url:         string | null
  primary_color:    string
  accent_color:     string
  background_color: string
  api_endpoint:     string | null
  is_active:        boolean
  created_at:       string
  updated_at:       string
}

export interface CompanyCreate {
  slug:             string
  name:             string
  sector:           string
  logo_url?:        string
  primary_color:    string
  accent_color:     string
  background_color: string
}

export interface Site {
  id:          number
  company_id:  number
  name:        string
  location:    string | null
  description: string | null
  is_active:   boolean
  created_at:  string
}

export interface SiteCreate {
  company_id:  number
  name:        string
  location?:   string
  description?: string
}

export interface DistillationColumn {
  id:             number
  site_id:        number
  name:           string
  tag:            string
  sequence_order: number
  description:    string | null
  feed_from:      string | null
  product_name:   string | null
  bottoms_name:   string | null
  model_path:     string | null
  config:         ColumnConfig | null
  is_active:      boolean
  created_at:     string
  updated_at:     string
}

export interface ColumnConfig {
  setpoints?: Array<{
    tag:     string
    name:    string
    unit:    string
    min:     number
    max:     number
    nominal: number
  }>
  kpis?:      string[]
  purity_min?: number
}

export interface ColumnCreate {
  site_id:        number
  name:           string
  tag:            string
  sequence_order?: number
  description?:   string
  feed_from?:     string
  product_name?:  string
  bottoms_name?:  string
  config?:        ColumnConfig
}

export interface AuditEntry {
  id:          number
  timestamp:   string
  username:    string | null
  role:        string | null
  action:      string
  endpoint:    string | null
  detail:      unknown
  ip_address:  string | null
  status_code: number | null
}

export interface ProcessStats {
  column_tag:          string
  period_hours:        number
  total_predictions:   number
  avg_energy:          number
  min_energy:          number
  max_energy:          number
  avg_purity:          number
  min_purity:          number
  max_purity:          number
  total_optimizations: number
  total_applied:       number
  avg_energy_saving:   number
  total_alerts:        number
  critical_alerts:     number
}
