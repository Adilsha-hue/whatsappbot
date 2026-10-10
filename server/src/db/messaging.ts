import { db } from './index.js'
import { Row } from './index.js'

export interface ChatNode {
  id: number
  companyId: number
  sessionId: number | null
  contactId: number
  assignedTo: number | null
  aiEnabled: number
  unread: number
  lastMessage: string | null
  lastMessageAt: string | null
}

// phone number helper: jid like "919876543210@s.whatsapp.net"
export function jidToPhone(jid: string): string {
  return jid.split('@')[0]?.replace(/[^0-9]/g, '') || ''
}

export function phoneToJid(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '')
  return `${digits}@s.whatsapp.net`
}

export function upsertContact(companyId: number, jid: string, name?: string | null): number {
  const phone = jidToPhone(jid)
  const existing = db.prepare('SELECT id FROM contacts WHERE company_id = ? AND jid = ?').get(companyId, jid) as { id: number } | undefined
  if (existing) {
    if (name) {
      db.prepare("UPDATE contacts SET name = COALESCE(name, ?), updated_at = datetime('now') WHERE id = ?").run(
        name || null,
        existing.id
      )
    }
    return existing.id
  }
  const r = db.prepare(
    `INSERT INTO contacts (company_id, jid, name, phone) VALUES (?, ?, ?, ?)`
  ).run(companyId, jid, name ?? null, phone)
  return Number(r.lastInsertRowid)
}

export function upsertChat(opts: { companyId: number; sessionId: number | null; contactId: number }): number {
  const existing = db
    .prepare('SELECT id FROM chats WHERE company_id = ? AND contact_id = ?')
    .get(opts.companyId, opts.contactId) as { id: number } | undefined
  if (existing) return existing.id
  const r = db
    .prepare('INSERT INTO chats (company_id, session_id, contact_id) VALUES (?, ?, ?)')
    .run(opts.companyId, opts.sessionId, opts.contactId)
  return Number(r.lastInsertRowid)
}

export function insertMessage(opts: {
  companyId: number
  chatId: number
  sessionId: number | null
  direction: 'in' | 'out'
  type: string
  body?: string | null
  mediaUrl?: string | null
  sender?: string | null
  isAi?: number
}): number {
  const r = db
    .prepare(
      `INSERT INTO messages (company_id, chat_id, session_id, direction, type, body, media_url, sender, is_ai)
       VALUES (@companyId, @chatId, @sessionId, @direction, @type, @body, @mediaUrl, @sender, @isAi)`
    )
    .run({
      companyId: opts.companyId,
      chatId: opts.chatId,
      sessionId: opts.sessionId,
      direction: opts.direction,
      type: opts.type,
      body: opts.body ?? null,
      mediaUrl: opts.mediaUrl ?? null,
      sender: opts.sender ?? null,
      isAi: opts.isAi ?? 0,
    })
  return Number(r.lastInsertRowid)
}

export function updateChatLastMessage(chatId: number, body: string | null, unread: number) {
  db.prepare(
    `UPDATE chats SET last_message = ?, unread = unread + ?, last_message_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
  ).run(body ?? null, unread, chatId)
}

export function getChat(chatId: number): ChatNode | undefined {
  const r = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId) as any
  if (!r) return undefined
  return {
    id: r.id,
    companyId: r.company_id,
    sessionId: r.session_id,
    contactId: r.contact_id,
    assignedTo: r.assigned_to,
    aiEnabled: r.ai_enabled,
    unread: r.unread,
    lastMessage: r.last_message,
    lastMessageAt: r.last_message_at,
  }
}

export function getSettings(companyId: number) {
  const s = db.prepare('SELECT * FROM company_settings WHERE company_id = ?').get(companyId) as Row | undefined
  if (!s) {
    db.prepare('INSERT INTO company_settings (company_id) VALUES (?)').run(companyId)
    return db.prepare('SELECT * FROM company_settings WHERE company_id = ?').get(companyId) as Row
  }
  return s
}

export function getCompanyName(companyId: number): string {
  const c = db.prepare('SELECT name FROM companies WHERE id = ?').get(companyId) as { name: string } | undefined
  return c?.name || 'Company'
}