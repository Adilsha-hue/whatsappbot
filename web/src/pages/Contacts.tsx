import { useEffect, useMemo, useState } from 'react'
import { useApi } from '../store'
import { Search, Plus, Trash2, Users } from 'lucide-react'

export default function Contacts() {
  const { call, on } = useApi()
  const [contacts, setContacts] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [adding, setAdding] = useState(false)

  const load = () => call('/api/company/contacts').then(setContacts).catch(() => {})
  useEffect(() => {
    load()
    const off = on('company:*:contact', () => load())
    return off
  }, [])

  const filtered = useMemo(
    () =>
      contacts.filter((c) => {
        if (!search) return true
        const s = search.toLowerCase()
        return (c.name || '').toLowerCase().includes(s) || (c.phone || '').includes(s)
      }),
    [contacts, search]
  )

  const add = async () => {
    if (!phone) return
    await call('/api/company/contacts', 'POST', { name, phone })
    setName('')
    setPhone('')
    setAdding(false)
    load()
  }

  const rename = async (id: number, newName: string) => {
    await call(`/api/company/contacts/${id}`, 'PATCH', { name: newName })
    load()
  }

  const remove = async (id: number) => {
    if (!confirm('Delete this contact?')) return
    await call(`/api/company/contacts/${id}`, 'DELETE')
    load()
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Contacts</h1>
          <p className="muted">Your customers — they also appear automatically when people message you.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding((a) => !a)}>
          <Plus size={15} /> Add contact
        </button>
      </div>

      {adding && (
        <div className="card form-card">
          <div className="row">
            <input className="inp" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="inp" placeholder="Phone (e.g. 919876543210)" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <button className="btn btn-primary" onClick={add}>
              Save
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 16 }}>
        <input
          className="inp"
          placeholder="Search contacts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 12 }}
        />
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone / JID</th>
              <th>Added</th>
              <th style={{ width: 50 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                    <span className="avatar" style={{ width: 30, height: 30, fontSize: 12 }}>
                      {(c.name || c.phone || '?')[0]?.toUpperCase() || '?'}
                    </span>
                    <EditableText value={c.name || ''} onSave={(v) => rename(c.id, v)} />
                  </span>
                </td>
                <td className="muted tiny">{c.phone || c.jid}</td>
                <td className="muted tiny">{c.created_at}</td>
                <td>
                  <button className="btn btn-sm btn-icon btn-danger" title="Delete" onClick={() => remove(c.id)}>
                    <Trash2 />
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <div className="empty">
                    <Users size={22} style={{ margin: '0 auto 8px', display: 'block', opacity: 0.5 }} />
                    No contacts. They also appear automatically when customers message you.
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EditableText({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  if (!editing) {
    return (
      <span
        onClick={() => {
          setDraft(value)
          setEditing(true)
        }}
        title="Click to rename"
        style={{ cursor: 'pointer' }}
      >
        {value || '—'}
      </span>
    )
  }
  return (
    <input
      autoFocus
      className="inp inp-sm"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false)
        if (draft !== value) onSave(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}
