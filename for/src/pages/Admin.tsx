/**
 * OPTIQ DSS · Admin Panel
 * Role-aware:
 *  - system_admin: Companies + Sites + Columns + Users + Config
 *  - company_admin: Sites + Columns + Users + Config (no company creation)
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from '@/components/Sidebar'
import { adminApi, authApi, siteApi, columnApi, spConfigApi, fopdtConfigApi } from '@/api/client'
import type { Company, CompanyCreate, Site, SiteCreate, DistillationColumn, ColumnCreate, SetpointEntry, FopdtEntry } from '@/api/client'
import { useBranding } from '@/branding/BrandingContext'
import { useAuth } from '@/auth/AuthContext'
import { isAdmin } from '@/api/client'
import { useMobileNav } from '@/context/MobileNavContext'

const SECTORS = ['LNG', 'Crude Oil', 'Pharmaceutical', 'Chemical', 'Food & Beverage', 'Other']
const SECTOR_PALETTES: Record<string, { primary: string; accent: string; bg: string }> = {
  'LNG':             { primary: '#00D9FF', accent: '#FFD700', bg: '#0D1B2A' },
  'Crude Oil':       { primary: '#FF6B35', accent: '#FFD700', bg: '#1A0D00' },
  'Pharmaceutical':  { primary: '#00E87A', accent: '#7C3AED', bg: '#0A1628' },
  'Chemical':        { primary: '#F59E0B', accent: '#EF4444', bg: '#1C1209' },
  'Food & Beverage': { primary: '#34D399', accent: '#F472B6', bg: '#0A1A10' },
  'Other':           { primary: '#A78BFA', accent: '#60A5FA', bg: '#12101A' },
}

type Tab = 'companies' | 'sites' | 'columns' | 'users' | 'config' | 'setpoints' | 'dynamics'

const Admin: React.FC = () => {
  const { user }            = useAuth()
  const { setCompanySlug }  = useBranding()
  const systemAdmin         = isAdmin(user)
  const { toggle: toggleSidebar } = useMobileNav()

  const [tab, setTab] = useState<Tab>(systemAdmin ? 'companies' : 'sites')

  const [companies,  setCompanies]  = useState<Company[]>([])
  const [sites,      setSites]      = useState<Site[]>([])
  const [columns,    setColumns]    = useState<DistillationColumn[]>([])
  const [loading,    setLoading]    = useState(true)
  const [toast,      setToast]      = useState<{ msg: string; ok: boolean } | null>(null)
  const [cfg,        setCfg]        = useState<Record<string, unknown>>({})

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  // ── Load all data ─────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const promises: PromiseLike<any>[] = [
        siteApi.list(),
        columnApi.list(),
        adminApi.getConfig(),
      ]
      if (systemAdmin) promises.push(adminApi.listCompanies())

      const results = await Promise.all(promises)
      setSites(results[0].data)
      setColumns(results[1].data.sort((a: DistillationColumn, b: DistillationColumn) =>
        a.sequence_order - b.sequence_order))
      setCfg(results[2].data)
      if (systemAdmin) setCompanies(results[3].data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [systemAdmin])

  useEffect(() => { load() }, [load])

  const tabs: Array<{ id: Tab; label: string; adminOnly?: boolean }> = [
    { id: 'companies' as Tab, label: 'Companies', adminOnly: true },
    { id: 'sites' as Tab, label: 'Sites' },
    { id: 'columns' as Tab, label: 'Columns' },
    { id: 'users' as Tab, label: 'Users' },
    { id: 'config' as Tab, label: 'Config' },
    { id: 'setpoints' as Tab, label: 'Setpoints' },
    { id: 'dynamics' as Tab, label: 'Dynamics' },
  ].filter(t => !t.adminOnly || systemAdmin)

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-content">
        <header className="topbar">
          <div className="flex items-center gap-3">
            <button className="btn-icon mobile-only" onClick={toggleSidebar} aria-label="Menu">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
            <div>
              <div className="font-display font-bold text-xl">Admin Panel</div>
              <div className="text-xs text-muted">
                {systemAdmin ? 'System admin — full access' : 'Company admin — sites, columns, users'}
              </div>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <div className={`badge badge-${systemAdmin ? 'error' : 'warning'}`}>
              {systemAdmin ? 'System Admin' : 'Company Admin'}
            </div>
          </div>
        </header>

        <main className="page-content">
          {/* Tab bar */}
          <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: '0.4rem 1rem',
                  borderRadius: 'var(--r-md) var(--r-md) 0 0',
                  background: tab === t.id ? 'var(--primary)' : 'transparent',
                  color: tab === t.id ? '#000' : 'var(--text-mid)',
                  border: 'none', cursor: 'pointer',
                  fontWeight: tab === t.id ? 700 : 400,
                  fontSize: '0.82rem',
                  transition: 'all 0.15s',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {loading && (
            <div style={{ padding: '3rem', display: 'grid', placeItems: 'center' }}>
              <div className="spinner" style={{ width: 28, height: 28 }} />
            </div>
          )}

          {!loading && (
            <>
              {tab === 'companies' && systemAdmin && (
                <CompaniesTab
                  companies={companies}
                  onRefresh={load}
                  showToast={showToast}
                  setCompanySlug={setCompanySlug}
                />
              )}
              {tab === 'sites' && (
                <SitesTab
                  sites={sites}
                  companies={companies}
                  user={user}
                  onRefresh={load}
                  showToast={showToast}
                />
              )}
              {tab === 'columns' && (
                <ColumnsTab
                  columns={columns}
                  sites={sites}
                  onRefresh={load}
                  showToast={showToast}
                />
              )}
              {tab === 'users' && (
                <UsersTab showToast={showToast} companies={companies} />
              )}
              {tab === 'config' && (
                <ConfigTab cfg={cfg} setCfg={setCfg} showToast={showToast} />
              )}
              {tab === 'setpoints' && (
                <SetpointsTab showToast={showToast} />
              )}
              {tab === 'dynamics' && (
                <DynamicsTab showToast={showToast} />
              )}
            </>
          )}

          <div style={{ textAlign: 'center', marginTop: '2rem', paddingBottom: '1rem' }}>
            <div className="optiq-badge"><span>OPTIQ</span> Industrial AI Platform · v2.0</div>
          </div>
        </main>
      </div>

      {toast && (
        <div style={{
          position: 'fixed', bottom: '1.5rem', right: '1.5rem',
          background: toast.ok ? 'rgba(0,232,122,0.12)' : 'rgba(255,61,90,0.12)',
          border: `1px solid ${toast.ok ? 'rgba(0,232,122,0.3)' : 'rgba(255,61,90,0.3)'}`,
          color: toast.ok ? 'var(--success)' : 'var(--error)',
          borderRadius: 'var(--r-md)', padding: '0.75rem 1.25rem',
          fontSize: '0.875rem', fontWeight: 600, zIndex: 2000,
          animation: 'fadeUp 0.2s var(--ease) both', maxWidth: 360,
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPANIES TAB (system admin only)
// ─────────────────────────────────────────────────────────────────────────────
const CompaniesTab: React.FC<{
  companies: Company[]
  onRefresh: () => void
  showToast: (msg: string, ok?: boolean) => void
  setCompanySlug: (slug: string) => void
}> = ({ companies, onRefresh, showToast, setCompanySlug }) => {
  const DEFAULT_FORM: CompanyCreate = {
    slug: '', name: '', sector: 'LNG',
    logo_url: '', primary_color: '#00D9FF', accent_color: '#FFD700', background_color: '#0D1B2A',
  }
  const [showModal,  setShowModal]  = useState(false)
  const [editTarget, setEditTarget] = useState<Company | null>(null)
  const [form,       setForm]       = useState<CompanyCreate>(DEFAULT_FORM)
  const [saving,     setSaving]     = useState(false)
  const logoRef = useRef<HTMLInputElement>(null)

  const openCreate = () => { setEditTarget(null); setForm(DEFAULT_FORM); setShowModal(true) }
  const openEdit   = (c: Company) => {
    setEditTarget(c)
    setForm({ slug: c.slug, name: c.name, sector: c.sector,
              logo_url: c.logo_url ?? '', primary_color: c.primary_color,
              accent_color: c.accent_color, background_color: c.background_color })
    setShowModal(true)
  }

  const onSectorChange = (sector: string) => {
    const p = SECTOR_PALETTES[sector] ?? SECTOR_PALETTES['Other']
    setForm(prev => ({ ...prev, sector, primary_color: p.primary, accent_color: p.accent, background_color: p.bg }))
  }

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 500_000) { showToast('Logo must be under 500 KB', false); return }
    const reader = new FileReader()
    reader.onload = () => setForm(p => ({ ...p, logo_url: reader.result as string }))
    reader.readAsDataURL(file)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (editTarget) { await adminApi.updateCompany(editTarget.id, form); showToast('Company updated ✓') }
      else            { await adminApi.createCompany(form);                showToast('Company created ✓') }
      setShowModal(false); onRefresh()
    } catch (e: any) {
      showToast(e?.response?.data?.detail ?? 'Error saving', false)
    } finally { setSaving(false) }
  }

  const handleDelete = async (c: Company) => {
    if (!confirm(`Delete "${c.name}"? This cannot be undone.`)) return
    try { await adminApi.deleteCompany(c.id); showToast('Deleted'); onRefresh() }
    catch { showToast('Delete failed', false) }
  }

  const f = (k: keyof CompanyCreate) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }))

  return (
    <section className="card">
      <div className="flex justify-between items-center mb-4">
        <div>
          <div className="font-semibold text-lg">Companies</div>
          <div className="text-xs text-muted">System admin only — creates tenants</div>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ Add Company</button>
      </div>

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
                    {c.logo_url && <img src={c.logo_url} alt={c.name} style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'contain', background: c.background_color, border: '1px solid var(--border)' }} />}
                    <span className="font-semibold">{c.name}</span>
                  </div>
                </td>
                <td><code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--primary)' }}>{c.slug}</code></td>
                <td className="text-muted">{c.sector}</td>
                <td>
                  <div className="flex gap-1">
                    {[c.primary_color, c.accent_color, c.background_color].map((col, i) => (
                      <div key={i} title={col} style={{ width: 18, height: 18, borderRadius: 3, background: col, border: '1px solid var(--border)' }} />
                    ))}
                  </div>
                </td>
                <td><div className={`badge badge-${c.is_active ? 'success' : 'error'}`}>{c.is_active ? 'Active' : 'Inactive'}</div></td>
                <td>
                  <div className="flex gap-2">
                    <button className="btn btn-ghost btn-sm" onClick={() => setCompanySlug(c.slug)}>Preview</button>
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
            No companies yet. Click <strong>+ Add Company</strong>.
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div className="modal" style={{ maxWidth: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="flex justify-between items-center mb-5" style={{ flexShrink: 0 }}>
              <div className="font-display font-bold text-lg">{editTarget ? 'Edit Company' : 'Add Company'}</div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4, marginRight: -4 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                <Field label="Company name *">
                  <input className="input" placeholder="e.g. Sonatrach LNG" value={form.name} onChange={f('name')} />
                </Field>
                <Field label="Slug *">
                  <input className="input" placeholder="e.g. sonatrach-lng" value={form.slug} onChange={f('slug')}
                    disabled={!!editTarget} style={{ opacity: editTarget ? 0.6 : 1 }} />
                </Field>
                <Field label="Sector">
                  <select className="input" value={form.sector} onChange={e => onSectorChange(e.target.value)}>
                    {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Logo">
                  <div className="flex gap-2 items-center">
                    {form.logo_url && <img src={form.logo_url} alt="" style={{ width: 44, height: 44, objectFit: 'contain', background: form.background_color, borderRadius: 6, border: '1px solid var(--border)', flexShrink: 0 }} />}
                    <div style={{ flex: 1 }}>
                      <button className="btn btn-ghost btn-sm w-full" onClick={() => logoRef.current?.click()}>
                        {form.logo_url ? '⬆ Replace logo' : '⬆ Upload logo'}
                      </button>
                      <input ref={logoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoUpload} />
                    </div>
                    {form.logo_url && <button className="btn btn-danger btn-sm" onClick={() => setForm(p => ({ ...p, logo_url: '' }))}>✕</button>}
                  </div>
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.75rem' }}>
                  <ColourField label="Primary"    value={form.primary_color}    onChange={v => setForm(p => ({ ...p, primary_color: v }))} />
                  <ColourField label="Accent"     value={form.accent_color}     onChange={v => setForm(p => ({ ...p, accent_color: v }))} />
                  <ColourField label="Background" value={form.background_color} onChange={v => setForm(p => ({ ...p, background_color: v }))} />
                </div>
                {/* Live preview */}
                <div style={{ borderRadius: 'var(--r-md)', padding: '0.875rem 1rem', background: form.background_color, border: `1px solid ${form.primary_color}55` }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, color: form.primary_color }}>{form.name || 'Company Name'}</div>
                  <div style={{ fontSize: '0.65rem', color: form.accent_color }}>{form.sector} · POWERED BY OPTIQ</div>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6" style={{ flexShrink: 0, paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleSave}
                disabled={saving || !form.name || !form.slug}>
                {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving…</> : editTarget ? 'Save Changes' : 'Create Company'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SITES TAB
// ─────────────────────────────────────────────────────────────────────────────
const SitesTab: React.FC<{
  sites: Site[]
  companies: Company[]
  user: any
  onRefresh: () => void
  showToast: (msg: string, ok?: boolean) => void
}> = ({ sites, companies, user, onRefresh, showToast }) => {
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<SiteCreate>({ company_id: 0, name: '', location: '', description: '' })
  const [editTarget, setEditTarget] = useState<Site | null>(null)
  const [saving, setSaving] = useState(false)

  const defaultCompanyId = user?.company_id ?? companies[0]?.id ?? 0

  const openCreate = () => {
    setEditTarget(null)
    setForm({ company_id: defaultCompanyId, name: '', location: '', description: '' })
    setShowModal(true)
  }
  const openEdit = (s: Site) => {
    setEditTarget(s)
    setForm({ company_id: s.company_id, name: s.name, location: s.location ?? '', description: s.description ?? '' })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.name) { showToast('Name is required', false); return }
    setSaving(true)
    try {
      if (editTarget) { await siteApi.update(editTarget.id, form); showToast('Site updated ✓') }
      else            { await siteApi.create(form);                 showToast('Site created ✓') }
      setShowModal(false); onRefresh()
    } catch (e: any) {
      showToast(e?.response?.data?.detail ?? 'Error saving site', false)
    } finally { setSaving(false) }
  }

  const handleDelete = async (s: Site) => {
    if (!confirm(`Delete site "${s.name}"? All columns on this site will also be deleted.`)) return
    try { await siteApi.delete(s.id); showToast('Site deleted'); onRefresh() }
    catch { showToast('Delete failed', false) }
  }

  const getCompanyName = (id: number) => companies.find(c => c.id === id)?.name ?? `Company ${id}`

  return (
    <section className="card">
      <div className="flex justify-between items-center mb-4">
        <div>
          <div className="font-semibold text-lg">Sites</div>
          <div className="text-xs text-muted">Plant locations and branches within a company</div>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ Add Site</button>
      </div>

      <table className="data-table">
        <thead>
          <tr><th>Site</th><th>Company</th><th>Location</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {sites.map(s => (
            <tr key={s.id}>
              <td>
                <div className="font-semibold">{s.name}</div>
                {s.description && <div className="text-xs text-muted">{s.description}</div>}
              </td>
              <td className="text-muted">{getCompanyName(s.company_id)}</td>
              <td className="text-muted">{s.location ?? '—'}</td>
              <td><div className={`badge badge-${s.is_active ? 'success' : 'error'}`}>{s.is_active ? 'Active' : 'Inactive'}</div></td>
              <td>
                <div className="flex gap-2">
                  <button className="btn btn-ghost btn-sm" onClick={() => openEdit(s)}>Edit</button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(s)}>Delete</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {sites.length === 0 && (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-low)' }}>No sites yet.</div>
      )}

      {showModal && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="flex justify-between items-center mb-5">
              <div className="font-display font-bold text-lg">{editTarget ? 'Edit Site' : 'Add Site'}</div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              {companies.length > 1 && !editTarget && (
                <Field label="Company">
                  <select className="input" value={form.company_id}
                    onChange={e => setForm(p => ({ ...p, company_id: Number(e.target.value) }))}>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Site name *">
                <input className="input" placeholder="e.g. Arzew Plant" value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
              </Field>
              <Field label="Location">
                <input className="input" placeholder="e.g. Arzew, Algeria" value={form.location ?? ''}
                  onChange={e => setForm(p => ({ ...p, location: e.target.value }))} />
              </Field>
              <Field label="Description">
                <input className="input" placeholder="Optional description" value={form.description ?? ''}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
              </Field>
            </div>
            <div className="flex gap-3 mt-6">
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleSave} disabled={saving || !form.name}>
                {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving…</> : editTarget ? 'Save' : 'Create Site'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COLUMNS TAB
// ─────────────────────────────────────────────────────────────────────────────
const ColumnsTab: React.FC<{
  columns: DistillationColumn[]
  sites: Site[]
  onRefresh: () => void
  showToast: (msg: string, ok?: boolean) => void
}> = ({ columns, sites, onRefresh, showToast }) => {
  const DEFAULT_COL: ColumnCreate = {
    site_id: 0, name: '', tag: '', sequence_order: 1,
    description: '', product_name: '', bottoms_name: '', feed_from: '',
  }
  const [showModal,  setShowModal]  = useState(false)
  const [editTarget, setEditTarget] = useState<DistillationColumn | null>(null)
  const [form,       setForm]       = useState<ColumnCreate>(DEFAULT_COL)
  const [saving,     setSaving]     = useState(false)

  const openCreate = () => {
    setEditTarget(null)
    setForm({ ...DEFAULT_COL, site_id: sites[0]?.id ?? 0 })
    setShowModal(true)
  }
  const openEdit = (c: DistillationColumn) => {
    setEditTarget(c)
    setForm({
      site_id: c.site_id, name: c.name, tag: c.tag,
      sequence_order: c.sequence_order,
      description: c.description ?? '', product_name: c.product_name ?? '',
      bottoms_name: c.bottoms_name ?? '', feed_from: c.feed_from ?? '',
    })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.name || !form.tag) { showToast('Name and tag are required', false); return }
    setSaving(true)
    try {
      if (editTarget) { await columnApi.update(editTarget.id, form); showToast('Column updated ✓') }
      else            { await columnApi.create(form);                 showToast('Column created ✓') }
      setShowModal(false); onRefresh()
    } catch (e: any) {
      showToast(e?.response?.data?.detail ?? 'Error saving column', false)
    } finally { setSaving(false) }
  }

  const handleDelete = async (c: DistillationColumn) => {
    if (!confirm(`Delete column "${c.name}" (${c.tag})? This cannot be undone.`)) return
    try { await columnApi.delete(c.id); showToast('Column deleted'); onRefresh() }
    catch { showToast('Delete failed', false) }
  }

  const getSiteName = (id: number) => sites.find(s => s.id === id)?.name ?? `Site ${id}`

  return (
    <section className="card">
      <div className="flex justify-between items-center mb-4">
        <div>
          <div className="font-semibold text-lg">Distillation Columns</div>
          <div className="text-xs text-muted">Configure the fractionation train sequence</div>
        </div>
        <button className="btn btn-primary" onClick={openCreate} disabled={sites.length === 0}>
          + Add Column
        </button>
      </div>

      {sites.length === 0 && (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--warning)', fontSize: '0.85rem' }}>
          ⚠ Add a site first before adding columns
        </div>
      )}

      <table className="data-table">
        <thead>
          <tr><th>Column</th><th>Tag</th><th>Site</th><th>Seq</th><th>Products</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {columns.map(c => (
            <tr key={c.id}>
              <td>
                <div className="font-semibold">{c.name}</div>
                {c.description && <div className="text-xs text-muted">{c.description}</div>}
              </td>
              <td><code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--primary)' }}>{c.tag}</code></td>
              <td className="text-muted">{getSiteName(c.site_id)}</td>
              <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{c.sequence_order}</td>
              <td>
                <div style={{ fontSize: '0.75rem' }}>
                  {c.product_name && <div style={{ color: '#00D9FF' }}>↑ {c.product_name}</div>}
                  {c.bottoms_name && <div style={{ color: '#F59E0B' }}>↓ {c.bottoms_name}</div>}
                </div>
              </td>
              <td><div className={`badge badge-${c.is_active ? 'success' : 'error'}`}>{c.is_active ? 'Active' : 'Inactive'}</div></td>
              <td>
                <div className="flex gap-2">
                  <button className="btn btn-ghost btn-sm" onClick={() => openEdit(c)}>Edit</button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(c)}>Delete</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {columns.length === 0 && (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-low)' }}>No columns yet.</div>
      )}

      {showModal && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <div className="flex justify-between items-center mb-5">
              <div className="font-display font-bold text-lg">{editTarget ? 'Edit Column' : 'Add Column'}</div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', maxHeight: '65vh', overflowY: 'auto' }}>
              <Field label="Site">
                <select className="input" value={form.site_id}
                  onChange={e => setForm(p => ({ ...p, site_id: Number(e.target.value) }))}>
                  {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <Field label="Column name *">
                  <input className="input" placeholder="e.g. DC4 Debutanizer" value={form.name}
                    onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
                </Field>
                <Field label="Tag * (e.g. DC4)">
                  <input className="input" placeholder="DC4" value={form.tag}
                    onChange={e => setForm(p => ({ ...p, tag: e.target.value.toUpperCase() }))} />
                </Field>
              </div>
              <Field label="Sequence order">
                <input className="input" type="number" min={1} value={form.sequence_order}
                  onChange={e => setForm(p => ({ ...p, sequence_order: Number(e.target.value) }))} />
              </Field>
              <Field label="Description">
                <input className="input" placeholder="Optional" value={form.description ?? ''}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                <Field label="Feed from (tag)">
                  <input className="input" placeholder="DC3" value={form.feed_from ?? ''}
                    onChange={e => setForm(p => ({ ...p, feed_from: e.target.value }))} />
                </Field>
                <Field label="Overhead product">
                  <input className="input" placeholder="e.g. Butane" value={form.product_name ?? ''}
                    onChange={e => setForm(p => ({ ...p, product_name: e.target.value }))} />
                </Field>
                <Field label="Bottoms product">
                  <input className="input" placeholder="e.g. C5+" value={form.bottoms_name ?? ''}
                    onChange={e => setForm(p => ({ ...p, bottoms_name: e.target.value }))} />
                </Field>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleSave}
                disabled={saving || !form.name || !form.tag}>
                {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving…</> : editTarget ? 'Save' : 'Create Column'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// USERS TAB
// ─────────────────────────────────────────────────────────────────────────────
const ROLE_COLORS: Record<string, string> = {
  system_admin:  'var(--error)',
  company_admin: 'var(--warning)',
  engineer:      'var(--primary)',
  operator:      'var(--info)',
  viewer:        'var(--text-low)',
  admin:         'var(--error)',
}

const UsersTab: React.FC<{
  showToast: (msg: string, ok?: boolean) => void
  companies: Company[]
}> = ({ showToast, companies }) => {
  const { user: me } = useAuth()

  interface UserRow { id: number; username: string; role: string; is_active: boolean; company_id: number | null }
  interface UserForm { username: string; password: string; role: string; company_id: number | null }

  const [users,       setUsers]       = useState<UserRow[]>([])
  const [loading,     setLoading]     = useState(true)
  const [showModal,   setShowModal]   = useState(false)
  const [form,        setForm]        = useState<UserForm>({ username: '', password: '', role: 'operator', company_id: null })
  const [saving,      setSaving]      = useState(false)
  const [deleteId,    setDeleteId]    = useState<number | null>(null)
  const [deleting,    setDeleting]    = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authApi.listUsers()
      setUsers(res.data)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!form.username || !form.password) { showToast('Username and password are required', false); return }
    if (form.password.length < 8) { showToast('Password must be ≥ 8 characters', false); return }
    setSaving(true)
    try {
      await authApi.createUser(form)
      showToast(`User "${form.username}" created ✓`)
      setShowModal(false)
      setForm({ username: '', password: '', role: 'operator', company_id: null })
      load()
    } catch (e: any) {
      showToast(e?.response?.data?.detail ?? 'Error creating user', false)
    } finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (deleteId === null) return
    setDeleting(true)
    try {
      await authApi.deleteUser(deleteId)
      showToast('User deleted ✓')
      setUsers(u => u.filter(x => x.id !== deleteId))
    } catch (e: any) {
      showToast(e?.response?.data?.detail ?? 'Error deleting user', false)
    } finally { setDeleting(false); setDeleteId(null) }
  }

  const companyName = (id: number | null) =>
    companies.find(c => c.id === id)?.name ?? '—'

  return (
    <section className="card">
      <div className="flex justify-between items-center mb-4">
        <div>
          <div className="font-semibold text-lg">User Management</div>
          <div className="text-xs text-muted">{users.length} user{users.length !== 1 ? 's' : ''} · click ✕ to delete</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>+ Add User</button>
      </div>

      {/* User list */}
      {loading ? (
        <div style={{ padding: '2rem', display: 'grid', placeItems: 'center' }}>
          <div className="spinner" style={{ width: 28, height: 28 }} />
        </div>
      ) : users.length === 0 ? (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-low)', fontSize: '0.85rem' }}>
          No users found. Click <strong>+ Add User</strong> to create one.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {users.map(u => (
            <div key={u.id} style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto auto auto',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.65rem 0.875rem',
              background: 'var(--bg-hover)',
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--border)',
            }}>
              {/* Avatar + name */}
              <div className="flex items-center gap-3">
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: `${ROLE_COLORS[u.role] ?? 'var(--primary)'}22`,
                  border: `1px solid ${ROLE_COLORS[u.role] ?? 'var(--primary)'}44`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.75rem', fontWeight: 700, color: ROLE_COLORS[u.role] ?? 'var(--primary)',
                  flexShrink: 0,
                }}>
                  {u.username[0].toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-hi)' }}>
                    {u.username}
                    {u.id === me?.id && (
                      <span style={{ marginLeft: 6, fontSize: '0.65rem', color: 'var(--text-low)',
                        fontFamily: 'var(--font-mono)', background: 'var(--bg-panel)',
                        padding: '1px 6px', borderRadius: 4 }}>you</span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-low)', fontFamily: 'var(--font-mono)' }}>
                    {companyName(u.company_id)}
                  </div>
                </div>
              </div>

              {/* Role badge */}
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: '0.65rem', fontWeight: 700,
                letterSpacing: '0.06em', textTransform: 'uppercase',
                color: ROLE_COLORS[u.role] ?? 'var(--primary)',
                background: `${ROLE_COLORS[u.role] ?? 'var(--primary)'}15`,
                padding: '3px 8px', borderRadius: 999,
                border: `1px solid ${ROLE_COLORS[u.role] ?? 'var(--primary)'}30`,
                whiteSpace: 'nowrap',
              }}>
                {u.role.replace('_', ' ')}
              </span>

              {/* Active badge */}
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: '0.65rem',
                color: u.is_active ? 'var(--success)' : 'var(--text-low)',
              }}>
                {u.is_active ? '● active' : '○ inactive'}
              </span>

              {/* Delete button — hide for own account */}
              {u.id !== me?.id ? (
                <button
                  className="btn-icon"
                  style={{ width: 28, height: 28, color: 'var(--error)', borderColor: 'rgba(255,69,96,0.2)', flexShrink: 0 }}
                  title={`Delete ${u.username}`}
                  onClick={() => setDeleteId(u.id)}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              ) : (
                <div style={{ width: 28 }} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showModal && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="flex justify-between items-center mb-5">
              <div className="font-display font-bold text-lg">Add User</div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              <Field label="Username *">
                <input className="input" placeholder="e.g. operator1" value={form.username}
                  onChange={e => setForm(p => ({ ...p, username: e.target.value }))} />
              </Field>
              <Field label="Password * (min 8 chars)">
                <input className="input" type="password" placeholder="••••••••" value={form.password}
                  onChange={e => setForm(p => ({ ...p, password: e.target.value }))} />
              </Field>
              <Field label="Role">
                <select className="input" value={form.role}
                  onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
                  <option value="engineer">Engineer — optimisation + apply</option>
                  <option value="operator">Operator — dashboard + alerts</option>
                  <option value="viewer">Viewer — read-only</option>
                  <option value="company_admin">Company Admin — manage sites &amp; columns</option>
                </select>
              </Field>
              {companies.length > 0 && (
                <Field label="Company">
                  <select className="input" value={form.company_id ?? ''}
                    onChange={e => setForm(p => ({ ...p, company_id: e.target.value ? Number(e.target.value) : null }))}>
                    <option value="">No company</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
              )}
              <div style={{ background: 'var(--bg-panel)', borderRadius: 'var(--r-md)', padding: '0.75rem 1rem', fontSize: '0.78rem', color: 'var(--text-mid)', border: '1px solid var(--border)' }}>
                {form.role === 'company_admin' && <><strong style={{ color: 'var(--warning)' }}>Company Admin:</strong> Manages sites, columns, and users. Cannot create companies.</>}
                {form.role === 'engineer'      && <><strong style={{ color: 'var(--primary)' }}>Engineer:</strong> Runs optimisation and confirms applied setpoints.</>}
                {form.role === 'operator'      && <><strong style={{ color: 'var(--info)' }}>Operator:</strong> Views dashboard, acknowledges alerts, no optimisation.</>}
                {form.role === 'viewer'        && <><strong style={{ color: 'var(--text-low)' }}>Viewer:</strong> Read-only access to dashboard and statistics.</>}
              </div>
              <button className="btn btn-primary w-full" onClick={handleCreate} disabled={saving}>
                {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Creating…</> : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteId !== null && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setDeleteId(null) }}>
          <div className="modal" style={{ maxWidth: 380 }}>
            <div className="font-display font-bold text-lg mb-3">Delete User?</div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-mid)', marginBottom: '1.25rem' }}>
              This will permanently remove <strong style={{ color: 'var(--text-hi)' }}>
                {users.find(u => u.id === deleteId)?.username}
              </strong>. This action cannot be undone.
            </div>
            <div className="flex gap-3">
              <button className="btn btn-ghost flex-1" onClick={() => setDeleteId(null)} disabled={deleting}>Cancel</button>
              <button
                className="btn flex-1"
                style={{ background: 'rgba(255,61,90,0.12)', border: '1px solid rgba(255,61,90,0.3)', color: 'var(--error)', fontWeight: 700 }}
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Deleting…</> : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// ───────────────────────────────────────────────────────────────────────────────
// CONFIG TAB
// ───────────────────────────────────────────────────────────────────────────────
const ConfigTab: React.FC<{
  cfg: Record<string, unknown>
  setCfg: React.Dispatch<React.SetStateAction<Record<string, unknown>>>
  showToast: (msg: string, ok?: boolean) => void
}> = ({ cfg, setCfg, showToast }) => {
  const [saving, setSaving] = useState(false)

  const setKey = async (key: string, value: unknown) => {
    setSaving(true)
    try {
      await adminApi.setConfig(key, value)
      setCfg(prev => ({ ...prev, [key]: value }))
      showToast(`Config: ${key} updated ✓`)
    } catch {
      showToast('Failed to update config', false)
    } finally { setSaving(false) }
  }

  const CONFIG_KEYS = [
    { key: 'ingestion_interval_sec', label: 'Ingestion interval (seconds)', type: 'number', default: 3 },
    { key: 'alert_energy_threshold', label: 'Alert threshold: energy (kg/kg)', type: 'number', default: 2.0 },
    { key: 'alert_purity_min',       label: 'Alert threshold: purity min (%)', type: 'number', default: 90.0 },
  ]

  return (
    <div className="card">
      <div className="font-semibold text-lg mb-4">System Configuration</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 480 }}>
        {CONFIG_KEYS.map(({ key, label, type, default: def }) => (
          <div key={key}>
            <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 6 }}>
              {label}
            </label>
            <div className="flex gap-2 items-center">
              <input
                className="input"
                type={type}
                defaultValue={String(cfg[key] ?? def)}
                onBlur={e => setKey(key, type === 'number' ? parseFloat(e.target.value) : e.target.value)}
                style={{ maxWidth: 160, fontFamily: 'var(--font-mono)' }}
              />
              <span style={{ fontSize: '0.72rem', color: 'var(--text-low)', fontFamily: 'var(--font-mono)' }}>
                current: {String(cfg[key] ?? def)}
              </span>
            </div>
          </div>
        ))}
        {saving && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', color: 'var(--text-low)' }}>
            <div className="spinner" style={{ width: 14, height: 14 }} /> Saving…
          </div>
        )}
      </div>
    </div>
  )
}

// SHARED HELPERS
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 6 }}>
      {label}
    </label>
    {children}
  </div>
)

const ColourField: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => (
  <div>
    <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 6 }}>
      {label}
    </label>
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <input
        type="color"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ width: 36, height: 36, padding: 2, borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', background: 'transparent' }}
      />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="input"
        style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}
        placeholder="#RRGGBB"
      />
    </div>
  </div>
)

// SETPOINTS TAB
// ───────────────────────────────────────────────────────────────────────────────
const SetpointsTab: React.FC<{
  showToast: (msg: string, ok?: boolean) => void
}> = ({ showToast }) => {
  const { primary } = useBranding()
  const [columnTag, setColumnTag] = useState('DC4')
  const [setpoints, setSetpoints] = useState<SetpointEntry[]>([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await spConfigApi.get(columnTag)
      setSetpoints(res.data.setpoints)
    } catch {
      showToast('Failed to load setpoint config', false)
    } finally {
      setLoading(false)
    }
  }, [columnTag, showToast])

  useEffect(() => { load() }, [load])

  const update = (i: number, field: keyof SetpointEntry, raw: string) => {
    setSetpoints(prev => {
      const next = [...prev]
      const val  = parseFloat(raw)
      next[i] = { ...next[i], [field]: isNaN(val) ? raw : val } as SetpointEntry
      return next
    })
  }

  const save = async () => {
    setSaving(true)
    try {
      await spConfigApi.update(setpoints, columnTag)
      showToast('Setpoint config saved', true)
    } catch {
      showToast('Save failed', false)
    } finally {
      setSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 4,
    color: 'var(--text)',
    padding: '0.25rem 0.4rem',
    fontSize: '0.78rem',
    width: '100%',
  }

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, color: primary, margin: 0 }}>
          🎯 SP Setpoint Config
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-low)' }}>
          Column:
          <input
            value={columnTag}
            onChange={e => setColumnTag(e.target.value.toUpperCase())}
            style={{ ...inputStyle, width: 80 }}
          />
        </div>
        <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-low)', flex: 1 }}>
          Configure the SP setpoints displayed alongside OP recommendations on the dashboard.
          Changes apply company-wide for the selected column.
        </p>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-low)', fontSize: '0.85rem', padding: '1rem 0' }}>Loading…</div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ color: 'var(--text-low)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  {['Tag', 'Description', 'Unit', 'Nominal', 'Lo', 'Hi', 'Recommended'].map(h => (
                    <th key={h} style={{ padding: '0.4rem 0.6rem', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {setpoints.map((sp, i) => (
                  <tr key={sp.tag} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '0.4rem 0.6rem', fontFamily: 'var(--font-mono)', color: primary, whiteSpace: 'nowrap' }}>{sp.tag}</td>
                    <td style={{ padding: '0.4rem 0.6rem' }}>
                      <input value={sp.desc}    onChange={e => update(i, 'desc',        e.target.value)} style={inputStyle} />
                    </td>
                    <td style={{ padding: '0.4rem 0.6rem' }}>
                      <input value={sp.unit}    onChange={e => update(i, 'unit',        e.target.value)} style={{ ...inputStyle, width: 60 }} />
                    </td>
                    <td style={{ padding: '0.4rem 0.6rem' }}>
                      <input type="number" value={sp.nominal}     onChange={e => update(i, 'nominal',     e.target.value)} style={{ ...inputStyle, width: 80 }} />
                    </td>
                    <td style={{ padding: '0.4rem 0.6rem' }}>
                      <input type="number" value={sp.lo}          onChange={e => update(i, 'lo',          e.target.value)} style={{ ...inputStyle, width: 80 }} />
                    </td>
                    <td style={{ padding: '0.4rem 0.6rem' }}>
                      <input type="number" value={sp.hi}          onChange={e => update(i, 'hi',          e.target.value)} style={{ ...inputStyle, width: 80 }} />
                    </td>
                    <td style={{ padding: '0.4rem 0.6rem' }}>
                      <input type="number" value={sp.recommended ?? ''} onChange={e => update(i, 'recommended', e.target.value)} style={{ ...inputStyle, width: 90, color: 'var(--accent)' }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : '💾 Save Setpoints'}
            </button>
            <button className="btn" onClick={load} disabled={loading} style={{ opacity: 0.7 }}>
              ↺ Reset
            </button>
          </div>
        </>
      )}
    </section>
  )
}

// DYNAMICS TAB — FOPDT process dynamics parameters
// ───────────────────────────────────────────────────────────────────────────────
const DynamicsTab: React.FC<{
  showToast: (msg: string, ok?: boolean) => void
}> = ({ showToast }) => {
  const { primary } = useBranding()
  const [columnTag, setColumnTag] = useState('DC4')
  const [params,    setParams]    = useState<FopdtEntry[]>([])
  const [horizons,  setHorizons]  = useState<number[]>([300, 900, 1800])
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fopdtConfigApi.get(columnTag)
      setParams(res.data.params)
      setHorizons(res.data.horizons)
    } catch {
      showToast('Failed to load dynamics config', false)
    } finally {
      setLoading(false)
    }
  }, [columnTag, showToast])

  useEffect(() => { load() }, [load])

  const updateParam = (i: number, field: keyof FopdtEntry, raw: string) => {
    setParams(prev => {
      const next = [...prev]
      const num  = parseFloat(raw)
      next[i] = { ...next[i], [field]: isNaN(num) ? raw : num } as FopdtEntry
      return next
    })
  }

  const save = async () => {
    setSaving(true)
    try {
      await fopdtConfigApi.update(params, horizons, columnTag)
      showToast('Dynamics config saved', true)
    } catch {
      showToast('Save failed', false)
    } finally {
      setSaving(false)
    }
  }

  const numInput: React.CSSProperties = {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 4,
    color: 'var(--text)',
    padding: '0.25rem 0.4rem',
    fontSize: '0.78rem',
    width: '100%',
  }

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, color: primary, margin: 0 }}>
          📈 FOPDT Process Dynamics
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-low)' }}>
          Column:
          <input value={columnTag} onChange={e => setColumnTag(e.target.value.toUpperCase())}
            style={{ ...numInput, width: 80 }} />
        </div>
      </div>

      <div style={{ fontSize: '0.78rem', color: 'var(--text-low)', marginBottom: '1rem', lineHeight: 1.6 }}>
        These parameters define how each controller output (OP) change propagates to the
        process variable (PV) over time. Used by the post-apply FOPDT simulation so
        engineers can verify actual DCS readings against predictions.
        <br />
        <strong style={{ color: 'var(--text)' }}>K</strong> = process gain (PV unit per % OP) &nbsp;|&nbsp;
        <strong style={{ color: 'var(--text)' }}>tau</strong> = time constant (s, 63% settled at theta+tau) &nbsp;|&nbsp;
        <strong style={{ color: 'var(--text)' }}>theta</strong> = dead time (s, delay before any response) &nbsp;|&nbsp;
        <strong style={{ color: 'var(--text)' }}>PV nom</strong> = DCS reading at 50% OP baseline
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-low)', fontSize: '0.85rem' }}>Loading…</div>
      ) : (
        <>
          <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ color: 'var(--text-low)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  {['OP Tag', 'PV Tag', 'Description', 'Unit', 'K', 'tau (s)', 'theta (s)', 'PV nom'].map(h => (
                    <th key={h} style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {params.map((p, i) => (
                  <tr key={p.op_tag} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'var(--font-mono)', color: primary, fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{p.op_tag}</td>
                    <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '0.75rem' }}>{p.pv_tag}</td>
                    <td style={{ padding: '0.4rem 0.5rem' }}>
                      <input value={p.desc} onChange={e => updateParam(i, 'desc', e.target.value)} style={numInput} />
                    </td>
                    <td style={{ padding: '0.4rem 0.5rem' }}>
                      <input value={p.unit} onChange={e => updateParam(i, 'unit', e.target.value)} style={{ ...numInput, width: 60 }} />
                    </td>
                    {(['K', 'tau', 'theta', 'pv_nom'] as const).map(field => (
                      <td key={field} style={{ padding: '0.4rem 0.5rem' }}>
                        <input type="number" step="any"
                          value={p[field] as number}
                          onChange={e => updateParam(i, field, e.target.value)}
                          style={{ ...numInput, width: 80 }} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Horizons */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)', marginBottom: '0.4rem' }}>
              Prediction horizons (seconds)
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {horizons.map((h, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', color: 'var(--text-low)' }}>
                  <span>H{i + 1}:</span>
                  <input type="number" value={h}
                    onChange={e => setHorizons(prev => { const n = [...prev]; n[i] = parseInt(e.target.value) || h; return n })}
                    style={{ ...numInput, width: 70 }} />
                  <span style={{ fontSize: '0.7rem' }}>({Math.round(h / 60)} min)</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : '💾 Save Dynamics Config'}
            </button>
            <button className="btn" onClick={load} disabled={loading} style={{ opacity: 0.7 }}>
              ↺ Reset
            </button>
          </div>
        </>
      )}
    </section>
  )
}

export default Admin