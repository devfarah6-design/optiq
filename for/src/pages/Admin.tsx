import React, { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from '@/components/Sidebar'
import { adminApi, authApi } from '@/api/client'
import type { Company, CompanyCreate } from '@/api/client'
import { useBranding } from '@/branding/BrandingContext'

const SECTORS = ['LNG', 'Crude Oil', 'Pharmaceutical', 'Chemical', 'Food & Beverage', 'Other']

// ── Default colour palettes per sector ───────────────────────────────────────
const SECTOR_PALETTES: Record<string, { primary: string; accent: string; bg: string }> = {
  'LNG':              { primary: '#00D9FF', accent: '#FFD700', bg: '#0D1B2A' },
  'Crude Oil':        { primary: '#FF6B35', accent: '#FFD700', bg: '#1A0D00' },
  'Pharmaceutical':   { primary: '#00E87A', accent: '#7C3AED', bg: '#0A1628' },
  'Chemical':         { primary: '#F59E0B', accent: '#EF4444', bg: '#1C1209' },
  'Food & Beverage':  { primary: '#34D399', accent: '#F472B6', bg: '#0A1A10' },
  'Other':            { primary: '#A78BFA', accent: '#60A5FA', bg: '#12101A' },
}

const DEFAULT_FORM: CompanyCreate = {
  slug: '', name: '', sector: 'LNG',
  logo_url: '', primary_color: '#00D9FF', accent_color: '#FFD700', background_color: '#0D1B2A',
}

// ── User creation form ────────────────────────────────────────────────────────
interface UserForm { username: string; password: string; role: string }
const DEFAULT_USER: UserForm = { username: '', password: '', role: 'operator' }

const Admin: React.FC = () => {
  const { setCompanySlug } = useBranding()

  // Company state
  const [companies,  setCompanies]  = useState<Company[]>([])
  const [loading,    setLoading]    = useState(true)
  const [showModal,  setShowModal]  = useState(false)
  const [editTarget, setEditTarget] = useState<Company | null>(null)
  const [form,       setForm]       = useState<CompanyCreate>(DEFAULT_FORM)
  const [saving,     setSaving]     = useState(false)

  // User management state
  const [showUserModal, setShowUserModal] = useState(false)
  const [userForm,      setUserForm]      = useState<UserForm>(DEFAULT_USER)
  const [userSaving,    setUserSaving]    = useState(false)

  // Config state
  const [cfg,     setCfg]     = useState<Record<string, unknown>>({})
  const [cfgSaving, setCfgSaving] = useState(false)

  // Toast
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  // Logo file upload
  const logoInputRef = useRef<HTMLInputElement>(null)

  // ── Data loading ─────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [co, config] = await Promise.all([adminApi.listCompanies(), adminApi.getConfig()])
      setCompanies(co.data)
      setCfg(config.data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  // ── Company modal helpers ─────────────────────────────────────────────────────
  const openCreate = () => { setEditTarget(null); setForm(DEFAULT_FORM); setShowModal(true) }
  const openEdit   = (c: Company) => {
    setEditTarget(c)
    setForm({ slug: c.slug, name: c.name, sector: c.sector,
              logo_url: c.logo_url ?? '', primary_color: c.primary_color,
              accent_color: c.accent_color, background_color: c.background_color })
    setShowModal(true)
  }

  // ── When sector changes → apply colour palette ────────────────────────────────
  const onSectorChange = (sector: string) => {
    const palette = SECTOR_PALETTES[sector] ?? SECTOR_PALETTES['Other']
    setForm(p => ({
      ...p,
      sector,
      primary_color:    palette.primary,
      accent_color:     palette.accent,
      background_color: palette.bg,
    }))
  }

  // ── Logo file upload → convert to base64 data URL ────────────────────────────
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 500_000) { showToast('Logo must be under 500 KB', false); return }
    const reader = new FileReader()
    reader.onload = () => setForm(p => ({ ...p, logo_url: reader.result as string }))
    reader.readAsDataURL(file)
  }

  // ── Save company ──────────────────────────────────────────────────────────────
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
    } catch (e: unknown) {
      const msg = (e as any)?.response?.data?.detail
      showToast(msg ?? 'Error saving company', false)
    } finally { setSaving(false) }
  }

  const handleDelete = async (c: Company) => {
    if (!confirm(`Delete "${c.name}"? This cannot be undone.`)) return
    try { await adminApi.deleteCompany(c.id); showToast('Deleted'); load() }
    catch { showToast('Delete failed', false) }
  }

  const applyBranding = (slug: string) => { setCompanySlug(slug); showToast(`Branding applied: ${slug}`) }

  // ── Create user ───────────────────────────────────────────────────────────────
  const handleCreateUser = async () => {
    if (!userForm.username || !userForm.password) {
      showToast('Username and password are required', false); return
    }
    if (userForm.password.length < 8) {
      showToast('Password must be at least 8 characters', false); return
    }
    setUserSaving(true)
    try {
      await authApi.createUser(userForm)
      showToast(`User "${userForm.username}" created ✓`)
      setShowUserModal(false)
      setUserForm(DEFAULT_USER)
    } catch (e: unknown) {
      const msg = (e as any)?.response?.data?.detail
      showToast(msg ?? 'Error creating user', false)
    } finally { setUserSaving(false) }
  }

  // ── Save config key ───────────────────────────────────────────────────────────
  const saveCfgKey = async (key: string, value: unknown) => {
    try {
      await adminApi.setConfig(key, value)
      setCfg(prev => ({ ...prev, [key]: value }))
      showToast(`Saved: ${key}`)
    } catch { showToast('Config save failed', false) }
  }

  // ── Save alert email (real: stored in config, backend reads it for notifications) ──
  const saveAlertEmail = async (email: string) => {
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('Enter a valid email address', false); return
    }
    await saveCfgKey('alert_email', email)
    if (email) showToast(`Alert notifications will be sent to ${email}`)
    else showToast('Alert email cleared')
  }

  const f = (k: keyof CompanyCreate) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [k]: e.target.value }))

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-content">
        <header className="topbar">
          <div>
            <div className="font-display font-bold text-xl">Admin Panel</div>
            <div className="text-xs text-muted">Company management · Users · System configuration</div>
          </div>
          <div className="flex gap-2 items-center">
            <div className="badge badge-warning">Admin only</div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowUserModal(true)}>
              + Add User
            </button>
          </div>
        </header>

        <main className="page-content">

          {/* ── Company branding ──────────────────────────────────────────── */}
          <section className="card mb-6">
            <div className="flex justify-between items-center mb-4">
              <div>
                <div className="font-semibold text-lg">Company Branding</div>
                <div className="text-xs text-muted">Sector change auto-applies colour palette. Logo upload supported.</div>
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
                    <tr><th>Company</th><th>Slug</th><th>Sector</th><th>Colours</th><th>Status</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {companies.map(c => (
                      <tr key={c.id}>
                        <td>
                          <div className="flex items-center gap-2">
                            {c.logo_url && (
                              <img src={c.logo_url} alt={c.name}
                                   style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'contain',
                                            background: c.background_color, border: '1px solid var(--border)' }} />
                            )}
                            <span className="font-semibold">{c.name}</span>
                          </div>
                        </td>
                        <td><code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--primary)' }}>{c.slug}</code></td>
                        <td className="text-muted">{c.sector}</td>
                        <td>
                          <div className="flex gap-1 items-center">
                            {[c.primary_color, c.accent_color, c.background_color].map((col, i) => (
                              <div key={i} title={col} style={{ width: 18, height: 18, borderRadius: 3, background: col, border: '1px solid var(--border)' }} />
                            ))}
                          </div>
                        </td>
                        <td><div className={`badge badge-${c.is_active ? 'success' : 'error'}`}>{c.is_active ? 'Active' : 'Inactive'}</div></td>
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
                    No companies yet. Click <strong>+ Add Company</strong> to start.
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── System configuration ─────────────────────────────────────── */}
          <section className="card mb-6">
            <div className="font-semibold text-lg mb-1">System Configuration</div>
            <div className="text-xs text-muted mb-4">Changes save on blur.</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
              <ConfigInput label="Anomaly threshold (σ)" type="number" step="0.1"
                value={String(cfg['anomaly_threshold'] ?? 3.5)}
                onBlur={v => saveCfgKey('anomaly_threshold', parseFloat(v))} />
              <ConfigInput label="Stuck sensor scans" type="number"
                value={String(cfg['stuck_timeout'] ?? 10)}
                onBlur={v => saveCfgKey('stuck_timeout', parseInt(v))} />
              <div>
                <label className="input-label">Alert email</label>
                <AlertEmailInput
                  value={String(cfg['alert_email'] ?? '')}
                  onSave={saveAlertEmail}
                />
                <div className="text-xs text-lo mt-1">
                  Critical alerts will be sent here via the backend notification service.
                </div>
              </div>
            </div>
          </section>

          <div style={{ textAlign: 'center', marginTop: '2rem', paddingBottom: '1rem' }}>
            <div className="optiq-badge"><span>OPTIQ</span> Industrial AI Platform · v1.0</div>
          </div>
        </main>
      </div>

      {/* ── Company modal ─────────────────────────────────────────────────── */}
     {/* ── Company modal ─────────────────────────────────────────────────── */}
{showModal && (
  <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}>
    <div className="modal" style={{ 
      maxWidth: 520, 
      maxHeight: '90vh', 
      display: 'flex', 
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      <div className="flex justify-between items-center mb-5" style={{ flexShrink: 0 }}>
        <div className="font-display font-bold text-lg">{editTarget ? 'Edit Company' : 'Add Company'}</div>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>✕</button>
      </div>

      {/* Scrollable content area */}
      <div style={{ 
        flex: 1, 
        overflowY: 'auto', 
        paddingRight: '4px',
        marginRight: '-4px'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <ModalField label="Company name *">
            <input className="input" placeholder="e.g. Sonatrach LNG" value={form.name} onChange={f('name')} />
          </ModalField>

          <ModalField label="Slug (URL-safe) *">
            <input className="input" placeholder="e.g. sonatrach-lng"
                   value={form.slug} onChange={f('slug')}
                   disabled={!!editTarget} style={{ opacity: editTarget ? 0.6 : 1 }} />
          </ModalField>

          {/* Sector — auto-updates palette */}
          <ModalField label="Sector">
            <select className="input" value={form.sector}
                    onChange={e => onSectorChange(e.target.value)}>
              {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="text-xs text-lo mt-1">Changing sector applies a matching colour palette automatically.</div>
          </ModalField>

          {/* Logo upload */}
          <ModalField label="Logo">
            <div className="flex gap-2 items-center">
              {form.logo_url && (
                <img src={form.logo_url} alt="logo preview"
                     style={{ width: 44, height: 44, objectFit: 'contain',
                              background: form.background_color, borderRadius: 6, border: '1px solid var(--border)', flexShrink: 0 }} />
              )}
              <div style={{ flex: 1 }}>
                <button className="btn btn-ghost btn-sm w-full" onClick={() => logoInputRef.current?.click()}>
                  {form.logo_url ? '⬆ Replace logo' : '⬆ Upload logo from computer'}
                </button>
                <input ref={logoInputRef} type="file" accept="image/*"
                       style={{ display: 'none' }} onChange={handleLogoUpload} />
                <div className="text-xs text-lo mt-1">PNG / SVG / JPG — max 500 KB</div>
              </div>
              {form.logo_url && (
                <button className="btn btn-danger btn-sm" onClick={() => setForm(p => ({ ...p, logo_url: '' }))}>✕</button>
              )}
            </div>
          </ModalField>

          {/* Colour pickers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
            <ColourField label="Primary"    value={form.primary_color}    onChange={v => setForm(p => ({ ...p, primary_color: v }))} />
            <ColourField label="Accent"     value={form.accent_color}     onChange={v => setForm(p => ({ ...p, accent_color: v }))} />
            <ColourField label="Background" value={form.background_color} onChange={v => setForm(p => ({ ...p, background_color: v }))} />
          </div>

          {/* Live preview */}
          <div style={{
            borderRadius: 'var(--r-md)', padding: '0.875rem 1rem',
            background: form.background_color,
            border: `1px solid ${form.primary_color}55`,
            display: 'flex', alignItems: 'center', gap: '0.875rem',
          }}>
            {form.logo_url && (
              <img src={form.logo_url} alt="" style={{ width: 32, height: 32, objectFit: 'contain' }} />
            )}
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1rem', color: form.primary_color }}>
                {form.name || 'Company Name'}
              </div>
              <div style={{ fontSize: '0.65rem', letterSpacing: '0.12em', color: form.accent_color, opacity: 0.8 }}>
                {form.sector} · POWERED BY OPTIQ
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Fixed footer with buttons */}
      <div className="flex gap-3 mt-6" style={{ flexShrink: 0, paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowModal(false)}>Cancel</button>
        <button className="btn btn-primary" style={{ flex: 2 }}
                onClick={handleSave} disabled={saving || !form.name || !form.slug}>
          {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving…</> : editTarget ? 'Save Changes' : 'Create Company'}
        </button>
      </div>
    </div>
  </div>
)}
      {/* ── Add User modal ────────────────────────────────────────────────── */}
      {showUserModal && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setShowUserModal(false) }}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="flex justify-between items-center mb-5">
              <div className="font-display font-bold text-lg">Add User</div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowUserModal(false)}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              <ModalField label="Username *">
                <input className="input" placeholder="e.g. operator1"
                       value={userForm.username}
                       onChange={e => setUserForm(p => ({ ...p, username: e.target.value }))} />
              </ModalField>

              <ModalField label="Password * (min 8 characters)">
                <input className="input" type="password" placeholder="••••••••"
                       value={userForm.password}
                       onChange={e => setUserForm(p => ({ ...p, password: e.target.value }))} />
              </ModalField>

              <ModalField label="Role">
                <select className="input" value={userForm.role}
                        onChange={e => setUserForm(p => ({ ...p, role: e.target.value }))}>
                  <option value="operator">Operator — dashboard + optimisation</option>
                  <option value="viewer">Viewer — dashboard read-only</option>
                  <option value="admin">Admin — full access</option>
                </select>
              </ModalField>

              {/* Role description */}
              <div style={{ background: 'var(--navy)', borderRadius: 'var(--r-md)', padding: '0.75rem 1rem', fontSize: '0.8rem' }}>
                {userForm.role === 'admin'    && <><strong style={{ color: 'var(--warning)' }}>Admin:</strong> Full access — dashboard, optimisation, admin panel, user management.</>}
                {userForm.role === 'operator' && <><strong style={{ color: 'var(--primary)' }}>Operator:</strong> Dashboard with live data, anomaly alerts, and AI setpoint recommendations. No admin panel.</>}
                {userForm.role === 'viewer'   && <><strong style={{ color: 'var(--text-mid)' }}>Viewer:</strong> Dashboard read-only. Cannot trigger optimisation. Ideal for supervisors or clients.</>}
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowUserModal(false)}>Cancel</button>
              <button className="btn btn-primary" style={{ flex: 2 }}
                      onClick={handleCreateUser}
                      disabled={userSaving || !userForm.username || !userForm.password}>
                {userSaving ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Creating…</> : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '1.5rem', right: '1.5rem',
          background: toast.ok ? 'rgba(0,232,122,0.12)' : 'rgba(255,61,90,0.12)',
          border: `1px solid ${toast.ok ? 'rgba(0,232,122,0.3)' : 'rgba(255,61,90,0.3)'}`,
          color: toast.ok ? 'var(--success)' : 'var(--error)',
          borderRadius: 'var(--r-md)', padding: '0.75rem 1.25rem',
          fontSize: '0.875rem', fontWeight: 600, zIndex: 2000,
          animation: 'fadeUp 0.2s var(--ease) both',
          maxWidth: 360,
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

// ── Helper sub-components ──────────────────────────────────────────────────────
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
             style={{ width: 36, height: 36, border: 'none', borderRadius: 6, background: 'transparent', cursor: 'pointer', padding: 0, flexShrink: 0 }} />
      <input className="input" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}
             value={value} onChange={e => onChange(e.target.value)} maxLength={7} />
    </div>
  </div>
)

const ConfigInput: React.FC<{
  label: string; type?: string; step?: string; value: string; onBlur: (v: string) => void
}> = ({ label, type = 'text', step, value, onBlur }) => {
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  return (
    <div>
      <label className="input-label">{label}</label>
      <input className="input" type={type} step={step} value={local}
             onChange={e => setLocal(e.target.value)} onBlur={() => onBlur(local)} />
    </div>
  )
}

// Alert email with validation indicator
const AlertEmailInput: React.FC<{ value: string; onSave: (v: string) => void }> = ({ value, onSave }) => {
  const [local, setLocal] = useState(value)
  const [dirty, setDirty] = useState(false)
  useEffect(() => { setLocal(value); setDirty(false) }, [value])
  const valid = !local || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(local)
  return (
    <div className="flex gap-2">
      <input className="input" type="email" placeholder="alerts@company.com"
             value={local} style={{ borderColor: !valid ? 'var(--error)' : undefined }}
             onChange={e => { setLocal(e.target.value); setDirty(true) }} />
      {dirty && (
        <button className="btn btn-primary btn-sm" onClick={() => { onSave(local); setDirty(false) }}
                disabled={!valid}>
          Save
        </button>
      )}
    </div>
  )
}

export default Admin