import React, { useState, useEffect, useCallback } from 'react'
import Sidebar from '../components/Sidebar'
import { adminApi, Company, CompanyCreate } from '../api/client'
import { useBranding } from '../branding/BrandingContext'

const SECTORS = ['LNG', 'Crude Oil', 'Pharmaceutical', 'Chemical', 'Food & Beverage', 'Other']

const SECTOR_DEFAULTS: Record<string, { primary: string; accent: string; bg: string }> = {
  'LNG':             { primary: '#E87C2C', accent: '#FFB347', bg: '#0C0E12' },
  'Crude Oil':       { primary: '#A0522D', accent: '#D2691E', bg: '#0E0C0A' },
  'Pharmaceutical':  { primary: '#00B4D8', accent: '#90E0EF', bg: '#060C12' },
  'Chemical':        { primary: '#06D6A0', accent: '#38BDF8', bg: '#060C10' },
  'Food & Beverage': { primary: '#80B918', accent: '#AACC00', bg: '#080C06' },
  'Other':           { primary: '#8B5CF6', accent: '#A78BFA', bg: '#08060E' },
}

const DEFAULT_FORM: CompanyCreate = {
  slug: '', name: '', sector: 'LNG',
  logo_url: '', primary_color: '#E87C2C',
  accent_color: '#FFB347', background_color: '#0C0E12',
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

  const openCreate = () => { setEditTarget(null); setForm(DEFAULT_FORM); setShowModal(true) }
  const openEdit = (c: Company) => {
    setEditTarget(c)
    setForm({
      slug: c.slug, name: c.name, sector: c.sector,
      logo_url: c.logo_url ?? '', primary_color: c.primary_color,
      accent_color: c.accent_color, background_color: c.background_color
    })
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

  const handleSectorChange = (sector: string) => {
    const defaults = SECTOR_DEFAULTS[sector]
    if (defaults && !editTarget) {
      setForm(prev => ({
        ...prev,
        sector,
        primary_color: defaults.primary,
        accent_color: defaults.accent,
        background_color: defaults.bg,
      }))
    } else {
      setForm(prev => ({ ...prev, sector }))
    }
  }

  return (
    <div className="app-shell">
      <Sidebar />

      <div className="main-content">
        <header className="topbar">
          <div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(1.2rem, 4vw, 1.35rem)',
              fontWeight: 700,
              letterSpacing: '0.04em',
              color: 'var(--text-hi)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}>
              Admin Panel
              <span className="badge badge-warning">Admin Only</span>
            </div>
            <div style={{
              fontSize: '0.72rem',
              color: 'var(--text-low)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.08em',
              marginTop: 2,
            }}>
              Company management & system configuration
            </div>
          </div>
        </header>

        <main className="page-content">
          {/* Company Management Section */}
          <section className="card" style={{ marginBottom: '1.25rem' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '1.25rem',
              flexWrap: 'wrap',
              gap: '1rem',
            }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 700, letterSpacing: '0.04em' }}>
                  Company Branding
                </div>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.68rem',
                  color: 'var(--text-low)',
                  letterSpacing: '0.06em',
                  marginTop: 2,
                }}>
                  Multi-tenant branding configurations
                </div>
              </div>
              <button className="btn btn-primary" onClick={openCreate} style={{ gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Add Company
              </button>
            </div>

            {loading ? (
              <div style={{ padding: '3rem', display: 'grid', placeItems: 'center' }}>
                <div className="spinner" style={{ width: 32, height: 32 }} />
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  minWidth: '700px',
                }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ textAlign: 'left', padding: '0.75rem', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-low)' }}>Company</th>
                      <th style={{ textAlign: 'left', padding: '0.75rem', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-low)' }}>Slug</th>
                      <th style={{ textAlign: 'left', padding: '0.75rem', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-low)' }}>Sector</th>
                      <th style={{ textAlign: 'left', padding: '0.75rem', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-low)' }}>Theme</th>
                      <th style={{ textAlign: 'left', padding: '0.75rem', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-low)' }}>Status</th>
                      <th style={{ textAlign: 'left', padding: '0.75rem', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-low)' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map(c => (
                      <tr key={c.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }}>
                        <td style={{ padding: '0.75rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {c.logo_url ? (
                              <img src={c.logo_url} alt={c.name}
                                   style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'contain', background: c.background_color, padding: 2 }} />
                            ) : (
                              <div style={{
                                width: 28, height: 28,
                                borderRadius: 6,
                                background: `${c.primary_color}22`,
                                border: `1px solid ${c.primary_color}44`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: c.primary_color,
                                fontFamily: 'var(--font-display)',
                                fontSize: '0.8rem',
                                fontWeight: 700,
                              }}>
                                {c.name[0]}
                              </div>
                            )}
                            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{c.name}</span>
                          </div>
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          <code style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.78rem',
                            color: c.primary_color,
                            background: `${c.primary_color}15`,
                            padding: '2px 8px',
                            borderRadius: 4,
                            display: 'inline-block',
                          }}>
                            {c.slug}
                          </code>
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: `${c.primary_color}15`,
                            border: `1px solid ${c.primary_color}30`,
                            fontSize: '0.7rem',
                            fontWeight: 500,
                            color: c.primary_color,
                          }}>
                            {c.sector}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <div style={{ width: 20, height: 20, borderRadius: 4, background: c.primary_color, border: '1px solid var(--border)' }} title="Primary" />
                            <div style={{ width: 20, height: 20, borderRadius: 4, background: c.accent_color, border: '1px solid var(--border)' }} title="Accent" />
                            <div style={{ width: 20, height: 20, borderRadius: 4, background: c.background_color, border: '1px solid var(--border)' }} title="Background" />
                          </div>
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          <div className={`badge badge-${c.is_active ? 'success' : 'error'}`} style={{ fontSize: '0.65rem' }}>
                            <svg width="6" height="6" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="currentColor"/></svg>
                            {c.is_active ? 'Active' : 'Inactive'}
                          </div>
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button className="btn btn-ghost" style={{ padding: '0.3rem 0.7rem', fontSize: '0.7rem' }} onClick={() => applyBranding(c.slug)}>
                              Preview
                            </button>
                            <button className="btn btn-ghost" style={{ padding: '0.3rem 0.7rem', fontSize: '0.7rem' }} onClick={() => openEdit(c)}>
                              Edit
                            </button>
                            <button className="btn btn-danger" style={{ padding: '0.3rem 0.7rem', fontSize: '0.7rem' }} onClick={() => handleDelete(c)}>
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {companies.length === 0 && (
                  <div style={{
                    padding: '3rem',
                    textAlign: 'center',
                    color: 'var(--text-low)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.82rem',
                    letterSpacing: '0.06em',
                    border: '1px dashed var(--border)',
                    borderRadius: 'var(--r-md)',
                    margin: '1rem',
                  }}>
                    No companies configured yet. Click <strong>+ Add Company</strong> to get started.
                  </div>
                )}
              </div>
            )}
          </section>

          {/* System Configuration Section */}
          <section className="card" style={{ marginBottom: '1.25rem' }}>
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 700, letterSpacing: '0.04em' }}>
                System Configuration
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-low)', letterSpacing: '0.06em', marginTop: 2 }}>
                Runtime parameters · changes apply immediately
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
              <ConfigInput
                label="Anomaly threshold (σ)"
                type="number"
                step="0.1"
                value={String(cfg['anomaly_threshold'] ?? 3.0)}
                onBlur={v => saveCfgKey('anomaly_threshold', parseFloat(v))}
                hint="Standard deviations for anomaly detection"
              />
              <ConfigInput
                label="Stuck sensor timeout (min)"
                type="number"
                value={String(cfg['stuck_timeout'] ?? 5)}
                onBlur={v => saveCfgKey('stuck_timeout', parseInt(v))}
                hint="Minutes before marking sensor as stuck"
              />
              <ConfigInput
                label="Alert email (optional)"
                type="email"
                value={String(cfg['alert_email'] ?? '')}
                onBlur={v => saveCfgKey('alert_email', v)}
                hint="Notification destination for critical alerts"
              />
            </div>
          </section>

          {/* Footer */}
          <div style={{ textAlign: 'center', marginTop: '2rem', paddingBottom: '1rem' }}>
            <div className="optiq-badge"><span>OPTIQ</span> Industrial AI Platform · v1.0</div>
          </div>
        </main>
      </div>

      {/* Modal - Responsive with visible buttons */}
      {showModal && (
        <div 
          className="modal-backdrop" 
          onClick={e => e.target === e.currentTarget && setShowModal(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
        >
          <div style={{
            maxWidth: 'min(90vw, 500px)',
            width: '100%',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-card)',
            borderRadius: 'var(--r-xl)',
            boxShadow: 'var(--shadow-lg)',
            overflow: 'hidden',
            position: 'relative',
          }}>
            {/* Header */}
            <div style={{
              padding: '1.5rem 1.5rem 0.75rem 1.5rem',
              flexShrink: 0,
              borderBottom: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.15rem', letterSpacing: '0.04em' }}>
                    {editTarget ? 'Edit Company' : 'Add Company'}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--text-low)', letterSpacing: '0.08em', marginTop: 2 }}>
                    {editTarget ? `Editing: ${editTarget.name}` : 'Configure new tenant branding'}
                  </div>
                </div>
                <button 
                  className="btn btn-ghost" 
                  onClick={() => setShowModal(false)}
                  style={{
                    width: 32,
                    height: 32,
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Scrollable Content */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '1.25rem 1.5rem',
              minHeight: 0,
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label className="input-label">Company name *</label>
                  <input 
                    className="input" 
                    placeholder="e.g. Sonatrach GNL" 
                    value={form.name} 
                    onChange={f('name')}
                    autoFocus
                  />
                </div>

                <div>
                  <label className="input-label">Slug (URL-safe, lowercase) *</label>
                  <input
                    className="input"
                    placeholder="e.g. sonatrach-gnl"
                    value={form.slug}
                    onChange={f('slug')}
                    disabled={!!editTarget}
                    style={{ 
                      opacity: editTarget ? 0.6 : 1, 
                      fontFamily: 'var(--font-mono)',
                      background: editTarget ? 'var(--bg-hover)' : 'var(--bg-input)',
                    }}
                  />
                  {editTarget && (
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-low)', marginTop: 4 }}>
                      ⚠️ Slug cannot be changed after creation
                    </div>
                  )}
                </div>

                <div>
                  <label className="input-label">Sector</label>
                  <select className="input" value={form.sector} onChange={e => handleSectorChange(e.target.value)}>
                    {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-low)', fontFamily: 'var(--font-mono)', marginTop: 4, letterSpacing: '0.04em' }}>
                    Sector auto-fills brand colours for new companies
                  </div>
                </div>

                <div>
                  <label className="input-label">Logo URL (optional)</label>
                  <input 
                    className="input" 
                    placeholder="https://cdn.example.com/logo.svg" 
                    value={form.logo_url ?? ''} 
                    onChange={f('logo_url')}
                  />
                </div>

                <div>
                  <label className="input-label" style={{ marginBottom: '0.5rem', display: 'block' }}>Brand Colours</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
                    <div>
                      <label style={{
                        display: 'block',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.6rem',
                        fontWeight: 600,
                        letterSpacing: '0.10em',
                        color: 'var(--text-low)',
                        marginBottom: '0.375rem',
                        textTransform: 'uppercase',
                      }}>Primary</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <input
                          type="color"
                          value={form.primary_color}
                          onChange={e => setForm(p => ({ ...p, primary_color: e.target.value }))}
                          style={{
                            width: '100%', height: 40,
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--r-md)',
                            background: 'var(--bg-input)',
                            cursor: 'pointer',
                            padding: 3,
                          }}
                        />
                        <input
                          className="input"
                          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', padding: '0.3rem 0.5rem' }}
                          value={form.primary_color}
                          onChange={e => setForm(p => ({ ...p, primary_color: e.target.value }))}
                          maxLength={7}
                        />
                      </div>
                    </div>
                    <div>
                      <label style={{
                        display: 'block',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.6rem',
                        fontWeight: 600,
                        letterSpacing: '0.10em',
                        color: 'var(--text-low)',
                        marginBottom: '0.375rem',
                        textTransform: 'uppercase',
                      }}>Accent</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <input
                          type="color"
                          value={form.accent_color}
                          onChange={e => setForm(p => ({ ...p, accent_color: e.target.value }))}
                          style={{
                            width: '100%', height: 40,
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--r-md)',
                            background: 'var(--bg-input)',
                            cursor: 'pointer',
                            padding: 3,
                          }}
                        />
                        <input
                          className="input"
                          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', padding: '0.3rem 0.5rem' }}
                          value={form.accent_color}
                          onChange={e => setForm(p => ({ ...p, accent_color: e.target.value }))}
                          maxLength={7}
                        />
                      </div>
                    </div>
                    <div>
                      <label style={{
                        display: 'block',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.6rem',
                        fontWeight: 600,
                        letterSpacing: '0.10em',
                        color: 'var(--text-low)',
                        marginBottom: '0.375rem',
                        textTransform: 'uppercase',
                      }}>Background</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <input
                          type="color"
                          value={form.background_color}
                          onChange={e => setForm(p => ({ ...p, background_color: e.target.value }))}
                          style={{
                            width: '100%', height: 40,
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--r-md)',
                            background: 'var(--bg-input)',
                            cursor: 'pointer',
                            padding: 3,
                          }}
                        />
                        <input
                          className="input"
                          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', padding: '0.3rem 0.5rem' }}
                          value={form.background_color}
                          onChange={e => setForm(p => ({ ...p, background_color: e.target.value }))}
                          maxLength={7}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Live Preview Strip */}
                <div style={{
                  height: 4,
                  borderRadius: 999,
                  background: `linear-gradient(90deg, ${form.primary_color}, ${form.accent_color})`,
                  marginTop: 8,
                  opacity: 0.7,
                }} />
              </div>
            </div>

            {/* Fixed Footer with Buttons */}
            <div style={{
              padding: '1rem 1.5rem 1.5rem 1.5rem',
              borderTop: '1px solid var(--border)',
              flexShrink: 0,
              background: 'var(--bg-card)',
            }}>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button 
                  className="btn btn-ghost" 
                  style={{ flex: 1 }} 
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  style={{ flex: 2, justifyContent: 'center' }}
                  onClick={handleSave}
                  disabled={saving || !form.name || !form.slug}
                >
                  {saving
                    ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving…</>
                    : editTarget ? 'Save Changes' : 'Create Company'
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: '1.5rem',
          right: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'var(--bg-card)',
          border: `1px solid ${toast.ok ? 'rgba(34,212,122,0.3)' : 'rgba(255,69,96,0.3)'}`,
          borderLeft: `3px solid ${toast.ok ? 'var(--success)' : 'var(--error)'}`,
          borderRadius: 'var(--r-md)',
          padding: '0.75rem 1.25rem',
          fontSize: '0.875rem',
          fontWeight: 500,
          zIndex: 2000,
          boxShadow: 'var(--shadow-lg)',
          animation: 'fadeUp 0.2s ease both',
          fontFamily: 'var(--font-body)',
          maxWidth: '90vw',
        }}>
          {toast.ok
            ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          }
          <span style={{ flex: 1 }}>{toast.msg}</span>
        </div>
      )}
    </div>
  )
}

// Config Input Component
const ConfigInput: React.FC<{
  label: string; type?: string; step?: string; value: string
  onBlur: (v: string) => void; hint?: string
}> = ({ label, type = 'text', step, value, onBlur, hint }) => {
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  return (
    <div>
      <label className="input-label">{label}</label>
      <input
        className="input"
        type={type}
        step={step}
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => onBlur(local)}
      />
      {hint && (
        <div style={{ fontSize: '0.68rem', color: 'var(--text-low)', fontFamily: 'var(--font-mono)', marginTop: 4, letterSpacing: '0.04em' }}>
          {hint}
        </div>
      )}
    </div>
  )
}

export default Admin