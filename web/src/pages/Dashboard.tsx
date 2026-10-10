import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp, useApi } from '../store'
import { Building2, LogOut, Plus, Users, Smartphone, ChevronDown, ChevronUp, ArrowRight } from 'lucide-react'

export default function Dashboard() {
  const { user, logout, setSelectedCompany } = useApp()
  const { call } = useApi()
  const nav = useNavigate()
  const [companies, setCompanies] = useState<any[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [users, setUsers] = useState<{ users: any[]; sessions: any[] } | null>(null)

  const load = () => call('/api/companies').then(setCompanies)
  useEffect(() => {
    load().catch(() => {})
  }, [])

  const addCompany = async () => {
    if (!name) return
    await call('/api/companies', 'POST', { name, email, password })
    setName('')
    setEmail('')
    setPassword('')
    load()
  }

  const openCompany = async (id: number) => {
    setExpanded((cur) => (cur === id ? null : id))
    if (expanded !== id) setUsers(await call(`/api/companies/${id}/users`))
  }

  const openWorkspace = (c: any) =>
    nav(`/app/inbox?companyId=${c.id}`, { state: { companyId: c.id } })

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <h1>Companies</h1>
          <p className="muted">
            Hi {user?.name} — create a workspace for each customer, then enter it to manage their WhatsApp.
          </p>
        </div>
        <button className="btn" onClick={logout}>
          <LogOut size={15} /> Logout
        </button>
      </div>

      <div className="dash-cards">
        {companies.map((c) => (
          <div
            key={c.id}
            className="card card-hover"
            onClick={() => openWorkspace(c)}
          >
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <Building2 size={16} color="#4ADE80" />
              {c.name}
            </div>
            <div className="card-sub">
              created {c.created_at}
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <span className="pill">
                <ArrowRight size={12} /> Open workspace
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="card form-card">
        <h3>New company workspace</h3>
        <div className="row">
          <input className="inp" placeholder="Company name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="inp" placeholder="Owner email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="inp" placeholder="Owner password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="btn btn-primary" onClick={addCompany}>
            <Plus size={15} /> Create
          </button>
        </div>
      </div>

      {companies.map((c) => (
        <div key={c.id} className="card">
          <div className="company-row">
            <span>
              <strong>{c.name}</strong> <span className="muted">· {c.slug}</span>
            </span>
            <button className="btn btn-sm" onClick={() => openCompany(c.id)}>
              {expanded === c.id ? (
                <>
                  <ChevronUp size={14} /> Hide
                </>
              ) : (
                <>
                  <ChevronDown size={14} /> Users &amp; sessions
                </>
              )}
            </button>
          </div>
          {expanded === c.id && users && (
            <div>
              <h4>Users</h4>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                  </tr>
                </thead>
                <tbody>
                  {users.users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <Users size={13} color="#64748B" />
                          {u.name}
                        </span>
                      </td>
                      <td>{u.email}</td>
                      <td>
                        <span className="pill">{u.role}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h4 style={{ marginTop: 18 }}>
                WhatsApp sessions ({users.sessions.filter((s) => s.status === 'connected').length ?? 0} connected)
              </h4>
              <div className="row">
                {users.sessions.map((s) => (
                  <span key={s.id} className={'pill ' + (s.status === 'connected' ? 'pill-green' : 'pill-amber')}>
                    <Smartphone size={12} /> {s.name} · {s.status}
                  </span>
                ))}
                {users.sessions.length === 0 && <span className="muted tiny">No WhatsApp numbers linked.</span>}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
