import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApi } from '../store'
import { Megaphone, Plus, Trash2, Play, AlertTriangle, Activity, CheckCircle2, Sparkles, Mic, CheckSquare, Square } from 'lucide-react'

export default function Campaigns() {
  const { call, on } = useApi()
  const [camps, setCamps] = useState<any[]>([])
  const [contacts, setContacts] = useState<any[]>([])
  const [sessions, setSessions] = useState<any[]>([])
  const [showNew, setShowNew] = useState(false)
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [sessionId, setSessionId] = useState<number | ''>('')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [personalize, setPersonalize] = useState(false)
  const [asVoice, setAsVoice] = useState(false)

  const load = useCallback(() => {
    call('/api/company/campaigns').then(setCamps).catch(() => {})
  }, [call])

  useEffect(() => {
    load()
    call('/api/company/contacts').then(setContacts).catch(() => {})
    call('/api/company/sessions').then((rows: any[]) => setSessions(rows.filter((s) => s.status === 'connected'))).catch(() => {})
    const off = on('company:*:campaign', load)
    return off
  }, [load, on])

  useEffect(() => {
    setPicked(new Set())
  }, [showNew])

  const connectedCount = sessions.length

  const create = async () => {
    if (!name || !message || picked.size === 0) return
    await call('/api/company/campaigns', 'POST', {
      name,
      message,
      contactIds: [...picked],
      sessionId: sessionId || null,
      personalize,
      asVoice,
    })
    setShowNew(false)
    setName('')
    setMessage('')
    setPicked(new Set())
    load()
  }

  const run = async (id: number) => {
    await call(`/api/company/campaigns/${id}/run`, 'POST')
  }

  const remove = async (id: number) => {
    if (!confirm('Delete campaign?')) return
    await call(`/api/company/campaigns/${id}`, 'DELETE')
    load()
  }

  const stats = useMemo(
    () =>
      (camps as any[]).find((c) => c.status === 'running') ||
      (camps as any[]).find((c) => c.status === 'done'),
    [camps]
  )

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Bulk campaigns</h1>
          <p className="muted">Broadcast to many customers at once — personalized by AI if you like.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew((v) => !v)}>
          <Plus size={15} /> New campaign
        </button>
      </div>

      {stats && (
        <div className="banner">
          {stats.status === 'running' ? (
            <>
              <Activity />
              <span>
                Campaign <strong>{stats.name}</strong> sending… {stats.sent}/{stats.total}
              </span>
            </>
          ) : (
            <>
              <CheckCircle2 />
              <span>
                Campaign <strong>{stats.name}</strong> finished — {stats.sent} sent, {stats.failed} failed
              </span>
            </>
          )}
        </div>
      )}

      {connectedCount === 0 && (
        <div className="card" style={{ borderColor: 'rgba(217,119,6,0.4)', background: 'rgba(217,119,6,0.06)' }}>
          <div className="row" style={{ gap: 10 }}>
            <AlertTriangle size={18} color="#FBBF24" />
            <span className="tiny" style={{ color: '#FBBF24' }}>
              No WhatsApp number is connected yet. Pair one in the <strong>WhatsApp</strong> tab first.
            </span>
          </div>
        </div>
      )}

      {showNew && (
        <div className="card">
          <h3>New broadcast</h3>
          <div className="col">
            <input className="inp" placeholder="Campaign name" value={name} onChange={(e) => setName(e.target.value)} />
            <textarea
              className="inp"
              rows={3}
              placeholder="Message to send. Use {name} to personalize if enabled."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <div className="row">
              <select className="inp" value={sessionId} onChange={(e) => setSessionId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">Auto pick a connected number</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <label className="switch">
                <span className="muted">AI personalize</span>
                <input type="checkbox" checked={personalize} onChange={(e) => setPersonalize(e.target.checked)} />
                <span />
              </label>
              <label className="switch">
                <span className="muted row" style={{ gap: 5 }}>
                  <Mic size={13} /> Send as voice
                </span>
                <input type="checkbox" checked={asVoice} onChange={(e) => setAsVoice(e.target.checked)} />
                <span />
              </label>
            </div>
            <div className="row">
              <span className="muted">Receivers ({picked.size})</span>
              <button className="btn btn-sm" onClick={() => setPicked(new Set(contacts.map((c) => c.id)))}>
                <CheckSquare size={13} /> Select all
              </button>
              <button className="btn btn-sm" onClick={() => setPicked(new Set())}>
                <Square size={13} /> Clear
              </button>
            </div>
            <div className="contact-grid">
              {contacts.map((c) => (
                <label key={c.id} className="contact-check">
                  <input
                    type="checkbox"
                    checked={picked.has(c.id)}
                    onChange={(e) => {
                      const next = new Set(picked)
                      if (e.target.checked) next.add(c.id)
                      else next.delete(c.id)
                      setPicked(next)
                    }}
                  />
                  {c.name || c.phone}
                </label>
              ))}
              {contacts.length === 0 && <span className="muted tiny">No contacts yet — add them in the Contacts tab.</span>}
            </div>
            <div>
              <button className="btn btn-primary" onClick={create} disabled={!name || !message || picked.size === 0}>
                <Plus size={15} /> Create campaign
              </button>
            </div>
          </div>
        </div>
      )}

      {camps.map((c) => (
        <div key={c.id} className="card">
          <div className="company-row">
            <div>
              <strong className="row" style={{ gap: 8 }}>
                <Megaphone size={15} color="#4ADE80" /> {c.name}
              </strong>
              <div className="muted tiny" style={{ marginTop: 4 }}>{new Date(c.created_at).toLocaleString()}</div>
            </div>
            <div className="row">
              <span className={'pill ' + (c.status === 'done' ? 'pill-green' : c.status === 'running' ? 'pill-red' : 'pill-amber')}>{c.status}</span>
              {c.status !== 'running' && (
                <button className="btn btn-sm btn-primary" onClick={() => run(c.id)}>
                  <Play size={13} /> Run
                </button>
              )}
              <button className="btn btn-sm btn-icon btn-danger" title="Delete" onClick={() => remove(c.id)}>
                <Trash2 />
              </button>
            </div>
          </div>
          <div className="muted tiny">→ {c.message}</div>
          {(c.status === 'running' || c.status === 'done') && (
            <div className="progress">
              <div className="progress-bar" style={{ width: `${(c.total ? (c.sent + c.failed) / c.total : 0) * 100}%` }} />
            </div>
          )}
          <div className="muted tiny">
            {c.sent} sent · {c.failed} failed · {c.total} total {c.personalize ? (
              <span className="pill" style={{ marginLeft: 4 }}>
                <Sparkles size={11} /> AI personalized
              </span>
            ) : null}{' '}
            {c.as_voice ? (
              <span className="pill" style={{ marginLeft: 4 }}>
                <Mic size={11} /> voice
              </span>
            ) : null}
          </div>
        </div>
      ))}
      {camps.length === 0 && !showNew && (
        <div className="card empty">
          <Megaphone size={24} style={{ margin: '0 auto 10px', display: 'block', opacity: 0.5 }} />
          No campaigns yet.
        </div>
      )}
    </div>
  )
}
