import { db } from './src/db/index.js'
import { getSettings } from './src/db/messaging.js'

const token = process.argv[2]
const cid = Number(process.argv[3] || 1)

// create a chat referencing contact 1 so chat-based endpoints work
const contact = db.prepare('SELECT id, jid FROM contacts WHERE company_id = ? LIMIT 1').get(cid) as any
let chatId: number
if (contact) {
  const existing = db.prepare('SELECT id FROM chats WHERE company_id=? AND contact_id=?').get(cid, contact.id) as any
  chatId = existing ? existing.id : Number(db.prepare('INSERT INTO chats (company_id, session_id, contact_id) VALUES (?, NULL, ?)').run(cid, contact.id).lastInsertRowid)
} else {
  chatId = Number(db.prepare('INSERT INTO chats (company_id, session_id, contact_id) VALUES (?, NULL, NULL)').run(cid).lastInsertRowid)
}
console.log('chatId =', chatId)

const base = 'http://localhost:4000'
const api = async (p: string, m = 'GET', body?: any) => {
  const res = await fetch(base + p, { method: m, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const d = await res.json()
  if (!res.ok) throw new Error(d.error || res.status + ' ' + p)
  return d
}

// follow-ups
const f = await api('/api/company/followups', 'POST', { chatId, message: 'Are you still interested?', runAt: '2026-08-12 23:00:00' })
console.log('followup scheduled:', f.id, f.status)
const list = await api('/api/company/followups')
console.log('followup list count:', list.length)

// human send with no number connected -> expect 400 gracefully
try {
  await api(`/api/company/chats/${chatId}/send`, 'POST', { text: 'Can I help?' })
  console.log('send: OK (unexpected)')
} catch (e) {
  console.log('send without number (expected):', (e as Error).message)
}

// toggle AI
console.log('toggle AI:', JSON.stringify(await api(`/api/company/chats/${chatId}/toggle-ai`, 'POST', { enabled: false })))

// knowledge
const k = await api('/api/company/knowledge', 'POST', { title: 'Pricing', content: 'PRO costs 199/month' })
console.log('knowledge added:', k.id)

// settings update
const s = await api('/api/company/settings', 'PUT', { auto_reply_delay: 2, ai_voice_enabled: 1 })
console.log('settings delay:', s.settings.auto_reply_delay)

console.log('\nALL API FLOW TESTS PASSED')
process.exit(0)