import React, { useState, useEffect, useCallback } from 'react'
import Sidebar from '../components/Sidebar'
import { adminApi, Company, CompanyCreate } from '../api/client'
import { useBranding } from '../branding/BrandingContext'

const SECTORS = ['LNG', 'Crude Oil', 'Pharmaceutical', 'Chemical', 'Food & Beverage', 'Other']

const DEFAULT_FORM: CompanyCreate = {
  slug: '', name: '', sector: 'LNG',
  logo_url: '', primary_color: '#00D9FF',
  accent_color: '#FFD700', background_color: '#0D1B2A',
}

const Admin: React.FC = () => {
  const { setCompanySlug } = useBranding()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editTarget, setEditTarget] = useState<Company | null>(null)
  const [form, setForm] = useState<CompanyCreate>(DEFAULT_FORM)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  // ── Config panel ───────────────────────────────────────────────────────────
  const [cfg, setCfg] = useState<Record<string, unknown>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [co, config] = await Promise.all([
        adminApi.listCompanies(),
        adminApi.getConfig(),
      ])
      setCompanies(co.data)
      setCfg(config.data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  // ── Modal helpers ───────────────────────────────────────────────────────────
  const openCreate = () => { setEditTarget(null); setForm(DEFAULT_FORM); setShowModal(true) }
  const openEdit = (c: Company) => {
    setEditTarget(c)
    setForm({ slug: c.slug, name: c.name, sector: c.sector,
               logo_url: c.logo_url ?? '', primary_color: c.primary_color,
               accent_color: c.accent_color, background_color: c.background_color })
    setShowModal(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (editTarget) {
        await adminApi.updateCompany(editTarget.id, form)
        showToast('Company updated ✓')
      } else {
        await adminApi.createCompany(form)
        showToast('Company created ✓')
      }
      setShowModal(false)
      load()
    } catch (e: any) {
      showToast(e?.response?.data?.detail ?? 'Error saving company', false)
    } finally { setSaving(false) }
  }

  const handleDelete = async (c: Company) => {
    if (!window.confirm(`Delete "${c.name}"? This cannot be undone.`)) return
    try {
      await adminApi.deleteCompany(c.id)
      showToast('Company deleted')
      load()
    } catch { showToast('Delete failed', false) }
  }

  const applyBranding = (slug: string) => {
    setCompanySlug(slug)
    showToast(`Branding applied: ${slug}`)
  }

  const saveCfgKey = async (key: string, value: unknown) => {
    try {
      await adminApi.setConfig(key, value)
      setCfg(prev => ({ ...prev, [key]: value }))
      showToast(`Config saved: ${key}`)
    } catch { showToast('Config save failed', false) }
  }

  const f = (k: keyof CompanyCreate) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-content">
        {/* Topbar */}
        <header className="topbar">
          <div>
            <div className="font-display font-bold text-xl">Admin Panel</div>
            <div className="text-xs text-muted">Company management & system configuration</div>
          </div>
          <div className="badge badge-warning">Admin only</div>
        </header>

        <main className="page-content">

          {/* ── Company management ─────────────────────────────────────── */}
          <section className="card mb-6">
            <div className="flex justify-between items-center mb-4">
              <div>
                <div className="font-semibold text-lg">Company Branding</div>
                <div className="text-xs text-muted">Manage multi-tenant branding configurations</div>
              </div>
              <button className="btn btn-primary" onClick={openCreate}>+ Add Company</button>
            </div>

            {loading ? (
              <div style={{ padding: '2rem', display: 'grid', placeItems: 'center' }}>
                <div className="spinner" style={{ width: 28, height: 28 }} />
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Slug</th>
                      <th>Sector</th>
                      <th>Colours</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map(c => (
                      <tr key={c.id}>
                        <td>
                          <div className="flex items-center gap-2">
                            {c.logo_url && (
                              <img src={c.logo_url} alt={c.name}
                                   style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'contain' }} />
                            )}
                            <span className="font-semibold">{c.name}</span>
                          </div>
                        </td>
                        <td><code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--primary)' }}>{c.slug}</code></td>
                        <td className="text-muted">{c.sector}</td>
                        <td>
                          <div className="flex gap-2">
                            {[c.primary_color, c.accent_color, c.background_color].map((col, i) => (
                              <div key={i} style={{
                                width: 20, height: 20, borderRadius: 4,
                                background: col, border: '1px solid var(--border)',
                              }} />
                            ))}
                          </div>
                        </td>
                        <td>
                          <div className={`badge badge-${c.is_active ? 'success' : 'error'}`}>
                            {c.is_active ? 'Active' : 'Inactive'}
                          </div>
                        </td>
                        <td>
                          <div className="flex gap-2">
                            <button className="btn btn-ghost btn-sm" onClick={() => applyBranding(c.slug)}>Preview</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => openEdit(c)}>Edit</button>
                            <button className="btn btn-danger btn-sm" onClick={() => handleDelete(c)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {companies.length === 0 && (
                  <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-low)' }}>
                    No companies configured yet. Click <strong>+ Add Company</strong> to get started.
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── System config ──────────────────────────────────────────── */}
          <section className="card mb-6">
            <div className="font-semibold text-lg mb-4">System Configuration</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
              <ConfigInput
                label="Anomaly threshold (σ)"
                type="number"
                step="0.1"
                value={String(cfg['anomaly_threshold'] ?? 3.0)}
                onBlur={v => saveCfgKey('anomaly_threshold', parseFloat(v))}
              />
              <ConfigInput
                label="Stuck sensor timeout (min)"
                type="number"
                value={String(cfg['stuck_timeout'] ?? 5)}
                onBlur={v => saveCfgKey('stuck_timeout', parseInt(v))}
              />
              <ConfigInput
                label="Alert email (optional)"
                type="email"
                value={String(cfg['alert_email'] ?? '')}
                onBlur={v => saveCfgKey('alert_email', v)}
              />
            </div>
          </section>

          {/* ── OPTIQ footer ───────────────────────────────────────────── */}
          <div style={{ textAlign: 'center', marginTop: '2rem', paddingBottom: '1rem' }}>
            <div className="optiq-badge"><span>OPTIQ</span> Industrial AI Platform · v1.0</div>
          </div>
        </main>
      </div>

      {/* ── Company modal ──────────────────────────────────────────────── */}
      {showModal && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="flex justify-between items-center mb-5">
              <div className="font-display font-bold text-lg">
                {editTarget ? 'Edit Company' : 'Add Company'}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              <ModalField label="Company name *">
                <input className="input" placeholder="e.g. Acme Refinery" value={form.name} onChange={f('name')} />
              </ModalField>
              <ModalField label="Slug (URL-safe, lowercase) *">
                <input className="input" placeholder="e.g. acme-refinery"
                       value={form.slug} onChange={f('slug')} disabled={!!editTarget}
                       style={{ opacity: editTarget ? 0.6 : 1 }} />
              </ModalField>
              <ModalField label="Sector">
                <select className="input" value={form.sector} onChange={f('sector')}>
                  {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </ModalField>
              <ModalField label="Logo URL (optional)">
                <input className="input" placeholder="https://…" value={form.logo_url ?? ''} onChange={f('logo_url')} />
              </ModalField>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                <ColourField label="Primary" value={form.primary_color}
                             onChange={v => setForm(p => ({ ...p, primary_color: v }))} />
                <ColourField label="Accent" value={form.accent_color}
                             onChange={v => setForm(p => ({ ...p, accent_color: v }))} />
                <ColourField label="Background" value={form.background_color}
                             onChange={v => setForm(p => ({ ...p, background_color: v }))} />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleSave} disabled={saving || !form.name || !form.slug}>
                {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving…</> : (editTarget ? 'Save Changes' : 'Create Company')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ──────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '1.5rem', right: '1.5rem',
          background: toast.ok ? 'rgba(0,232,122,0.12)' : 'rgba(255,61,90,0.12)',
          border: `1px solid ${toast.ok ? 'rgba(0,232,122,0.3)' : 'rgba(255,61,90,0.3)'}`,
          color: toast.ok ? 'var(--success)' : 'var(--error)',
          borderRadius: 'var(--r-md)',
          padding: '0.75rem 1.25rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          zIndex: 2000,
          animation: 'fadeUp 0.2s var(--ease) both',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

// ── Mini helper components ─────────────────────────────────────────────────────
const ModalField: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="input-label">{label}</label>
    {children}
  </div>
)

const ColourField: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => (
  <div>
    <label className="input-label">{label}</label>
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={e => onChange(e.target.value)}
             style={{ width: 36, height: 36, border: 'none', borderRadius: 6,
                      background: 'transparent', cursor: 'pointer', padding: 0 }} />
      <input className="input" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}
             value={value} onChange={e => onChange(e.target.value)} maxLength={7} />
    </div>
  </div>
)

const ConfigInput: React.FC<{
  label: string; type?: string; step?: string; value: string
  onBlur: (v: string) => void
}> = ({ label, type = 'text', step, value, onBlur }) => {
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  return (
    <div>
      <label className="input-label">{label}</label>
      <input className="input" type={type} step={step}
             value={local} onChange={e => setLocal(e.target.value)}
             onBlur={() => onBlur(local)} />
    </div>
  )
}

export default Admin