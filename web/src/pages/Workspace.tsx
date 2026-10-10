import { useEffect, useMemo, useState } from 'react'
import { NavLink, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { useApp, useApi } from '../store'
import { MessageSquareText, Users, Smartphone, Megaphone, Sparkles, LogOut } from 'lucide-react'
import Inbox from './Inbox'
import Contacts from './Contacts'
import Sessions from './Sessions'
import Campaigns from './Campaigns'
import Settings from './Settings'

const NAV = [
  { to: '/app/inbox', label: 'Inbox', Icon: MessageSquareText, end: true },
  { to: '/app/contacts', label: 'Contacts', Icon: Users },
  { to: '/app/sessions', label: 'WhatsApp', Icon: Smartphone },
  { to: '/app/campaigns', label: 'Campaigns', Icon: Megaphone },
  { to: '/app/settings', label: 'AI Settings', Icon: Sparkles },
]

export default function Workspace() {
  const { user, selectedCompany, setSelectedCompany, logout } = useApp()
  const { call, wsConnected } = useApi()
  const nav = useNavigate()
  const loc = useLocation()
  const [company, setCompany] = useState<any>(null)
  const [unreadTotal, setUnreadTotal] = useState(0)

  const companyId = useMemo(() => {
    if (loc.state && (loc.state as any).companyId) return (loc.state as any).companyId
    const params = new URLSearchParams(loc.search)
    const qc = params.get('companyId')
    return qc ? Number(qc) : selectedCompany
  }, [loc, selectedCompany])

  useEffect(() => {
    if (companyId) setSelectedCompany(companyId)
  }, [companyId])

  useEffect(() => {
    if (!companyId) {
      nav(user?.role === 'superadmin' ? '/' : '/')
      return
    }
    call('/api/company/settings')
      .then((d) => setCompany(d.company))
      .catch(() => {})
    call('/api/company/chats')
      .then((chats: any[]) => setUnreadTotal(chats.reduce((n, c) => n + (c.unread || 0), 0)))
      .catch(() => {})
  }, [companyId])

  if (!companyId) return null

  return (
    <div className="app">
      <aside className="side">
        <div className="side-brand" onClick={() => nav('/')}>
          <span className="brand-logo">
            <MessageSquareText />
          </span>
          <span>DealDeploy</span>
        </div>
        <nav className="nav">
          {NAV.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={`${to}?companyId=${companyId}`}
              end={end}
              className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
            >
              <span className="nav-label">
                <Icon />
                <span>{label}</span>
              </span>
              {label === 'Inbox' && unreadTotal > 0 && <span className="badge">{unreadTotal}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className="live-status" title={wsConnected ? 'Live' : 'Reconnecting…'}>
            <span className={'dot ' + (wsConnected ? 'dot-green' : 'dot-red')} />
            <span>{wsConnected ? 'Live' : 'Offline'}</span>
          </div>
          <div className="side-user">
            <div>
              <strong>{user?.name}</strong>
              <span className="muted tiny">{company?.name}</span>
            </div>
            <button
              className="btn btn-sm"
              title="Sign out"
              onClick={() => {
                setSelectedCompany(null)
                logout()
                nav('/')
              }}
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <Routes>
          <Route path="inbox" element={<Inbox />} />
          <Route path="contacts" element={<Contacts />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="campaigns" element={<Campaigns />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Inbox />} />
        </Routes>
      </main>
    </div>
  )
}
