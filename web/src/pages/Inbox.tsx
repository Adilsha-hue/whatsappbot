import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApi } from '../store'
import {
  Search,
  Sparkles,
  Bot,
  UserRound,
  MessageSquareText,
  Mic,
  Send,
  Clock,
  Phone,
  UserCheck,
  UserPlus,
  CalendarClock,
  CheckCircle2,
} from 'lucide-react'

export default function Inbox() {
  const { call, on } = useApi()
  const [chats, setChats] = useState<any[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [messages, setMessages] = useState<any[]>([])
  const [detail, setDetail] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [users, setUsers] = useState<any[]>([])
  const [filter, setFilter] = useState<'all' | 'ai' | 'human'>('all')

  const activeCtx = useRef<any>(null)

  useEffect(() => {
    call('/api/company/chats').then(setChats).catch(() => {})
    call('/api/company/users').then(setUsers).catch(() => {})
  }, [])

  // realtime events for this company
  useEffect(() => {
    const offChat = on('company:*:chat', (payload) => {
      if (!payload?.chat) return
      setChats((prev) => {
        const existing = prev.some((c) => c.id === payload.chat.id)
        if (existing) {
          return [
            { ...payload.chat },
            ...prev.filter((c) => c.id !== payload.chat.id),
          ]
        }
        return [{ ...payload.chat }, ...prev]
      })
    })

    const offMsg = on('company:*:message', (payload) => {
      const m = payload?.message
      if (!m) return
      setChats((prev) => {
        const chat = prev.find((c) => c.id === m.chatId)
        const unread = m.chatId === activeCtx.current?.chatId ? 0 : (chat?.unread || 0) + (m.direction === 'in' ? 1 : 0)
        return [
          { ...(chat || {}), id: m.chatId, unread, last_message: m.body ?? m.type, last_message_at: m.at ?? new Date().toISOString() },
          ...prev.filter((c) => c.id !== m.chatId),
        ]
      })
      if (m.chatId === activeCtx.current?.chatId) {
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
      }
    })

    return () => {
      offChat()
      offMsg()
    }
  }, [on])

  const filtered = useMemo(() => {
    let list = chats
    if (search) {
      const s = search.toLowerCase()
      list = list.filter((c) => (c.contact_name || '').toLowerCase().includes(s) || (c.contact_phone || '').includes(s) || (c.last_message || '').toLowerCase().includes(s))
    }
    list = [...list].sort((a, b) => (b.last_message_at || '').localeCompare(a.last_message_at || ''))
    return list
  }, [chats, search])

  const openChat = useCallback(async (chat: any) => {
    setActiveId(chat.id)
    activeCtx.current = { chatId: chat.id }
    const data = await call(`/api/company/chats/${chat.id}/messages`)
    setMessages(data.messages || [])
    setDetail({ chat: data.chat, contact: data.contact })
  }, [call])

  return (
    <div className="inbox">
      <ChatList
        chats={filtered}
        activeId={activeId}
        search={search}
        setSearch={setSearch}
        openChat={openChat}
        filter={filter}
        setFilter={setFilter}
      />
      <Thread chatId={activeId} messages={messages} detail={detail} key={activeId || 'none'} />
      <DetailsPanel
        detail={detail}
        users={users}
        onToggleAi={(enabled: boolean) => {
          if (!activeId) return
          call(`/api/company/chats/${activeId}/toggle-ai`, 'POST', { enabled }).then(() => {
            setDetail((d: any) => (d ? { ...d, chat: { ...d.chat, ai_enabled: enabled ? 1 : 0 } } : d))
          })
        }}
        onAssign={(userId: number | null) => {
          if (!activeId) return
          call(`/api/company/chats/${activeId}/assign`, 'POST', { userId }).then(() => {
            setDetail((d: any) => (d ? { ...d, chat: { ...d.chat, assigned_to: userId } } : d))
          })
        }}
      />
    </div>
  )
}

function time(iso?: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const FILTERS = [
  { key: 'all', label: 'All', Icon: MessageSquareText },
  { key: 'ai', label: 'AI', Icon: Bot },
  { key: 'human', label: 'Manual', Icon: UserRound },
]

function ChatList({ chats, activeId, search, setSearch, openChat, filter, setFilter }: any) {
  const shown = chats.filter((c: any) => {
    if (filter === 'ai') return c.ai_enabled === 1
    if (filter === 'human') return c.ai_enabled !== 1
    return true
  })
  return (
    <div className="inbox-list">
      <div className="list-head">
        <Search className="search-icon" />
        <input
          className="inp"
          placeholder="Search chats…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="filters">
        {FILTERS.map(({ key, label, Icon }) => (
          <button key={key} className={'chip' + (filter === key ? ' chip-on' : '')} onClick={() => setFilter(key as any)}>
            <Icon /> {label}
          </button>
        ))}
      </div>
      <div className="chat-items">
        {shown.map((c: any) => (
          <div key={c.id} className={'chat-item' + (c.id === activeId ? ' active' : '')} onClick={() => openChat(c)}>
            <div className="avatar">{(c.contact_name || c.contact_phone || '?')[0]?.toUpperCase() || '?'}</div>
            <div className="chat-item-main">
              <div className="chat-item-top">
                <span className="chat-name">{c.contact_name || c.contact_phone || 'Unknown'}</span>
                <span className="muted tiny">{time(c.last_message_at)}</span>
              </div>
              <div className="chat-item-bottom">
                <span className="chat-preview">{c.last_message || '—'}</span>
                {c.unread > 0 && <span className="badge">{c.unread}</span>}
              </div>
              {c.ai_enabled === 1 && (
                <div className="ai-tag">
                  <Sparkles /> AI replies on
                </div>
              )}
            </div>
          </div>
        ))}
        {shown.length === 0 && <div className="empty">No conversations yet</div>}
      </div>
    </div>
  )
}

function Thread({ chatId, messages, detail }: { chatId: number | null; messages: any[]; detail: any }) {
  const { call } = useApi()
  const [text, setText] = useState('')
  const [voice, setVoice] = useState(false)
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, chatId])

  const send = async () => {
    if (!text.trim() || !chatId) return
    setSending(true)
    try {
      await call(`/api/company/chats/${chatId}/send`, 'POST', { text: text.trim(), asVoice: voice })
      setText('')
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  if (!chatId) {
    return (
      <div className="inbox-thread empty-state">
        <div className="wa-logo">
          <MessageSquareText />
        </div>
        <h2>Select a conversation</h2>
        <p className="muted">AI answers your customers 24/7 — in text and voice. Jump in anytime to take over.</p>
      </div>
    )
  }

  return (
    <div className="inbox-thread">
      <div className="thread-head">
        <div className="thread-head-info">
          <strong>{detail?.contact?.name || detail?.contact?.phone || 'Contact'}</strong>
          {detail?.contact?.phone && <span className="muted"> · {detail?.contact?.phone}</span>}
        </div>
        {detail?.chat?.ai_enabled === 1 ? (
          <span className="pill pill-green">
            <Sparkles size={12} /> AI active
          </span>
        ) : (
          <span className="pill">
            <UserRound size={12} /> Manual
          </span>
        )}
      </div>
      <div className="thread-body">
        {messages.map((m: any) => (
          <div key={m.id} className={'bubble ' + (m.direction === 'out' ? 'out' : 'in')}>
            {m.type !== 'text' && <div className="media-tag">[{m.type}]</div>}
            {m.is_ai === 1 && m.direction === 'out' && (
              <div className="byline">
                <Sparkles /> AI
              </div>
            )}
            <div className="bubble-text">{m.body}</div>
            <div className="bubble-time">{time(m.created_at)}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="composer">
        <label className="voice-toggle" title="Send as voice note">
          <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} />
          <Mic /> Voice
        </label>
        <input
          className="inp"
          placeholder={voice ? 'Type the message to speak…' : 'Type a message…'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button className="btn btn-primary" onClick={send} disabled={sending || !text.trim()}>
          {sending ? 'Sending…' : <><Send size={15} /> Send</>}
        </button>
      </div>
    </div>
  )
}

function DetailsPanel({ detail, users, onToggleAi, onAssign }: any) {
  const { call } = useApi()
  const [followMsg, setFollowMsg] = useState('')
  const [followAt, setFollowAt] = useState('')
  const [saved, setSaved] = useState('')

  const openChat = detail ? detail.chat : null
  const contact = detail ? detail.contact : null

  const scheduleFollowup = async () => {
    if (!openChat || !followMsg || !followAt) return
    await call('/api/company/followups', 'POST', { chatId: openChat.id, message: followMsg, runAt: new Date(followAt).toISOString().slice(0, 19) })
    setFollowMsg('')
    setFollowAt('')
    setSaved('Follow-up scheduled')
    setTimeout(() => setSaved(''), 3000)
  }

  return (
    <div className="inbox-details">
      {!openChat ? (
        <div className="muted" style={{ textAlign: 'center', padding: 20 }}>
          Select a chat to see details
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="details-avatar">{(contact?.name || contact?.phone || '?')[0]?.toUpperCase() || '?'}</div>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ marginBottom: 2 }}>{contact?.name || contact?.phone}</h3>
              <div className="muted tiny row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                <Phone size={11} /> {contact?.phone}
              </div>
            </div>
          </div>

          <div className="details-sec">
            <h4>
              <span className="row" style={{ gap: 5 }}>
                <Sparkles size={12} /> AI auto-responder
              </span>
            </h4>
            <label className="switch">
              <input
                type="checkbox"
                checked={openChat.ai_enabled === 1}
                onChange={(e) => onToggleAi(e.target.checked)}
              />
              <span />
            </label>
            <p className="muted tiny" style={{ margin: 0 }}>
              {openChat.ai_enabled === 1
                ? 'AI replies to this customer like a human — text and voice.'
                : 'AI is paused for this chat. You drive replies.'}
            </p>
          </div>

          <div className="details-sec">
            <h4>
              <span className="row" style={{ gap: 5 }}>
                <UserCheck size={12} /> Assign agent
              </span>
            </h4>
            <select
              className="inp"
              value={openChat.assigned_to || ''}
              onChange={(e) => onAssign(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Unassigned</option>
              {users.map((u: any) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          <div className="details-sec">
            <h4>
              <span className="row" style={{ gap: 5 }}>
                <CalendarClock size={12} /> Schedule follow-up
              </span>
            </h4>
            <input className="inp" placeholder="Message…" value={followMsg} onChange={(e) => setFollowMsg(e.target.value)} />
            <input className="inp" type="datetime-local" value={followAt} onChange={(e) => setFollowAt(e.target.value)} />
            <button className="btn btn-sm btn-primary" onClick={scheduleFollowup}>
              <Clock size={13} /> Schedule
            </button>
            {saved && (
              <div className="saved">
                <CheckCircle2 /> {saved}
              </div>
            )}
          </div>

          <div className="details-sec" style={{ border: 'none', padding: 0 }}>
            <span className="muted tiny row" style={{ gap: 5 }}>
              <UserPlus size={12} /> {users.length} agents in this workspace
            </span>
          </div>
        </>
      )}
    </div>
  )
}
