import makeWASocket, { DisconnectReason, useMultiFileAuthState, WASocket } from '@whiskeysockets/baileys'
import pino from 'pino'
import QRCode from 'qrcode'
import fs from 'node:fs'
import path from 'node:path'
import { sessionsDir } from '../config.js'
import { db } from '../db/index.js'
import { bus } from '../realtime/bus.js'
import { upsertContact, upsertChat, insertMessage, updateChatLastMessage, jidToPhone } from '../db/messaging.js'
import { responder } from '../ai/responder.js'

interface Session {
  id: number
  companyId: number
  name: string
  status: string
}

interface RuntimeSession {
  table: Session
  sock: WASocket | null
  folder: string
  qr: string | null
  connected: boolean
}

const logger = pino({ level: 'warn' })
fs.mkdirSync(sessionsDir, { recursive: true })

class WhatsAppManager {
  private sessions = new Map<number, RuntimeSession>()

  private getSessionRow(id: number): Session | undefined {
    const row = db.prepare('SELECT * FROM phone_sessions WHERE id = ?').get(id) as any
    if (!row) return undefined
    return { id: row.id, companyId: row.company_id, name: row.name, status: row.status }
  }

  setStatus(id: number, status: string) {
    db.prepare('UPDATE phone_sessions SET status = ? WHERE id = ?').run(status, id)
    const row = this.getSessionRow(id)
    if (row) {
      bus.emit(`session:${id}:status`, { companyId: row.companyId, sessionId: id, status, session: row })
    }
  }

  async start(id: number) {
    const table = this.getSessionRow(id)
    if (!table) throw new Error('Session not found')

    const existing = this.sessions.get(id)
    // already running and confirmed connected -> return the live one
    if (existing?.sock && existing.connected) return existing

    // stale/dead socket from a previous attempt: close it before rebuilding
    if (existing?.sock) {
      try {
        existing.sock.ev.removeAllListeners('connection.update')
        existing.sock.ev.removeAllListeners('contacts.upsert')
        existing.sock.ev.removeAllListeners('messages.upsert')
        existing.sock.ev.removeAllListeners('creds.update')
        existing.sock.end(new Error('restarting session'))
      } catch {}
    }

    const folder = path.join(sessionsDir, String(id))
    fs.mkdirSync(folder, { recursive: true })
    const rt: RuntimeSession = { table, sock: null, folder, qr: null, connected: false }
    this.sessions.set(id, rt)
    this.setStatus(id, 'connecting')

    const { state, saveCreds } = await useMultiFileAuthState(folder)

    const sock = makeWASocket({
      auth: state,
      logger,
      printQRInTerminal: false,
      markOnlineOnConnect: true,
    })

    rt.sock = sock

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
      const { qr, connection, lastDisconnect } = update
      if (qr) {
        rt.qr = qr
        const dataUrl = await QRCode.toDataURL(qr)
        bus.emit(`session:${id}:qr`, { companyId: table.companyId, sessionId: id, qr: dataUrl })
      }
      if (connection === 'connecting') this.setStatus(id, 'connecting')
      if (connection === 'close') {
        // only treat this instance as gone if it is still the current one
        if (this.sessions.get(id) !== rt) return
        if (rt.sock !== sock) return
        const reason = (lastDisconnect?.error as any)?.output?.statusCode
        rt.connected = false
        if (reason === DisconnectReason.loggedOut) {
          this.setStatus(id, 'disconnected')
          rt.qr = null
          this.sessions.delete(id)
        } else if (reason === DisconnectReason.badSession) {
          // remove corrupt session files so a fresh QR gets issued
          try {
            fs.rmSync(folder, { recursive: true, force: true })
          } catch {}
          rt.qr = null
          this.sessions.delete(id)
          this.setStatus(id, 'pending')
        } else {
          // transient (lost network / app closed) — Baileys auto-reconnects.
          // Keep the runtime; when it re-opens we flip back to connected.
          this.setStatus(id, 'disconnected')
        }
      }
      if (connection === 'open') {
        rt.connected = true
        this.setStatus(id, 'connected')
        rt.qr = null
      }
    })

    sock.ev.on('contacts.upsert', (contacts) => {
      for (const c of contacts) {
        if (!c.id?.endsWith('@s.whatsapp.net')) continue
        const cid = upsertContact(table.companyId, c.id, c.name || null)
        bus.emit(`company:${table.companyId}:contact`, { companyId: table.companyId, contactId: cid, jid: c.id, name: c.name })
      }
    })

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return
      for (const msg of messages) {
        if (!msg.message || msg.key?.fromMe) continue
        const jid = msg.key?.remoteJid
        if (!jid || !jid.endsWith('@s.whatsapp.net')) continue
        await this.processIncomingMessage(id, sock, msg as any)
      }
    })

    return rt
  }

  // Extracted so it can be unit-tested without a real WhatsApp connection.
  async processIncomingMessage(id: number, sock: WASocket | null, msg: any) {
    const table = this.getSessionRow(id)
    if (!table) return

    const jid = msg.key?.remoteJid
    if (!jid || !jid.endsWith('@s.whatsapp.net')) return

    sock?.sendReceipt(jid, undefined, [msg.key.id ?? ''], 'read').catch(() => {})

    const { type: mtype, body } = extractContent(msg.message)
    const contactId = upsertContact(table.companyId, jid, msg.pushName || null)
    const chatId = upsertChat({ companyId: table.companyId, sessionId: id, contactId })
    const companyId = table.companyId

    insertMessage({ companyId, chatId, sessionId: id, direction: 'in', type: mtype, body, sender: jid, isAi: 0 })
    updateChatLastMessage(chatId, mtype === 'text' ? body : `[${mtype}]`, 1)

    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId) as any
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId) as any

    bus.emit(`company:${companyId}:chat`, { companyId, chat })
    bus.emit(`company:${companyId}:message`, {
      companyId,
      message: {
        id: msg.key.id,
        chatId,
        contactId,
        sessionId: id,
        direction: 'in',
        type: mtype,
        body,
        sender: jid,
        isAi: 0,
        phone: jidToPhone(jid),
        contactName: contact?.name || msg.pushName || jidToPhone(jid),
        at: new Date().toISOString(),
      },
    })

    // trigger AI auto-responder (async, non-blocking)
    responder.onIncoming({
      companyId,
      chatId,
      sessionId: id,
      jid,
      body,
      messageType: mtype,
      contact,
    })
  }

  async stop(id: number) {
    const rt = this.sessions.get(id)
    if (rt?.sock) {
      try {
        rt.sock.ev?.removeAllListeners('connection.update')
        rt.sock.ev?.removeAllListeners('contacts.upsert')
        rt.sock.ev?.removeAllListeners('messages.upsert')
        rt.sock.ev?.removeAllListeners('creds.update')
        await rt.sock.logout?.().catch?.(() => {})
      } finally {
        rt.sock = null
      }
    }
    this.sessions.delete(id)
    this.setStatus(id, 'disconnected')
  }

  getRuntime(id: number): RuntimeSession | undefined {
    return this.sessions.get(id)
  }

  getStatus(id: number): string {
    const row = this.getSessionRow(id)
    return row?.status || 'pending'
  }

  isValid(id: number): boolean {
    const rt = this.sessions.get(id)
    return !!rt?.sock && rt.connected
  }

  getSessionByCompany(companyId: number): Session[] {
    const rows = db.prepare('SELECT * FROM phone_sessions WHERE company_id = ?').all(companyId) as any[]
    return rows.map((r) => ({ id: r.id, companyId: r.company_id, name: r.name, status: r.status }))
  }

  async sendMessage(id: number, jid: string, content: any) {
    const rt = this.sessions.get(id)
    if (!rt?.sock || !rt.connected) throw new Error('Session not connected')
    return rt.sock.sendMessage(jid, content)
  }

  async sendPresence(id: number, jid: string, state: 'composing' | 'paused' | 'recording') {
    const rt = this.sessions.get(id)
    if (!rt?.sock || !rt.connected) return
    await rt.sock.presenceSubscribe(jid).catch(() => {})
    await rt.sock.sendPresenceUpdate(state, jid).catch(() => {})
  }

  async markRead(id: number, jid: string, messageId: string) {
    const rt = this.sessions.get(id)
    if (!rt?.sock || !rt.connected) return
    await rt.sock.sendReceipt(jid, undefined, [messageId], 'read').catch(() => {})
  }

  async startAll() {
    const rows = db.prepare(`SELECT * FROM phone_sessions WHERE status != 'disabled'`).all() as unknown as Session[]
    for (const row of rows) {
      // only reconnect sessions that were live before a restart
      if (row.status === 'connected' || row.status === 'connecting' || row.status === 'disconnected') {
        this.start(row.id).catch((e) => console.error(`[whatsapp] failed to start session ${row.id}:`, e.message))
      }
    }
  }
}

function extractContent(message: any): { type: string; body: string } {
  const m = message
  if (m.imageMessage) return { type: 'image', body: m.imageMessage.caption || '' }
  if (m.videoMessage) return { type: 'video', body: m.videoMessage.caption || '' }
  if (m.audioMessage) return { type: 'audio', body: m.audioMessage.ptt ? '🎤 Voice note' : '🎵 Audio' }
  if (m.documentMessage) return { type: 'document', body: m.documentMessage.fileName || 'Document' }
  if (m.stickerMessage) return { type: 'sticker', body: '' }
  if (m.contactMessage) return { type: 'contact', body: m.contactMessage.displayName || 'Contact' }
  if (m.locationMessage) return { type: 'location', body: '📍 Location' }
  if (m.buttonsResponseMessage) return { type: 'text', body: m.buttonsResponseMessage.selectedButtonText || '' }
  if (m.listResponseMessage) return { type: 'text', body: m.listResponseMessage.singleSelectReply?.selectedRowId || '' }
  if (m.extendedTextMessage) return { type: 'text', body: m.extendedTextMessage.text || '' }
  if (m.conversation) return { type: 'text', body: m.conversation }
  return { type: 'other', body: '' }
}

export const whatsapp = new WhatsAppManager()
export { extractContent }