import Fastify, { FastifyRequest, FastifyReply } from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import fastifyStatic from '@fastify/static'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { db } from '../db/index.js'
import { createCompany, createUser, verifyPassword } from '../db/repo.js'
import { getSettings, upsertContact, phoneToJid, insertMessage, updateChatLastMessage, getChat, jidToPhone } from '../db/messaging.js'
import { whatsapp } from '../whatsapp/manager.js'
import { sendCampaignMessage, runCampaign } from '../whatsapp/campaigns.js'
import { bus } from '../realtime/bus.js'
import { Row } from '../db/index.js'

interface AuthPayload {
  userId: number
  companyId: number | null
  role: string
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

export async function buildServer() {
  const app = Fastify({ logger: false })

  app.register(cors, { origin: true, credentials: true })
  app.register(jwt, { secret: config.jwtSecret })

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify()
    } catch {
      return reply.code(401).send({ error: 'unauthorized' })
    }
  })

  const auth = app.authenticate! // defined below via decorator

  // ---- auth ----
  app.post('/api/auth/login', async (req, reply) => {
    const { email, password } = req.body as { email?: string; password?: string }
    if (!email || !password) return reply.code(400).send({ error: 'email and password required' })
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any
    if (!user || !verifyPassword(password, user.password_hash)) {
      return reply.code(401).send({ error: 'invalid credentials' })
    }
    const token = app.jwt.sign({ userId: user.id, companyId: user.company_id, role: user.role }, { expiresIn: '30d' })
    return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role, companyId: user.company_id } }
  })

  app.get('/api/me', { preHandler: [auth] }, async (req, reply) => {
    const payload = req.user as AuthPayload
    const user = db.prepare('SELECT id, name, email, role, company_id FROM users WHERE id = ?').get(payload.userId)
    return { user }
  })

  function companyIdFor(req: FastifyRequest): number {
    const payload = req.user as AuthPayload
    const q = Number((req.query as any)?.companyId)
    if (payload.role === 'superadmin' && q) return q
    if (!payload.companyId) throw new Error('no company')
    return payload.companyId
  }

  // ---- superadmin: companies ----
  app.get('/api/companies', { preHandler: [auth] }, async (req, reply) => {
    const payload = req.user as AuthPayload
    if (payload.role !== 'superadmin') return reply.code(401).send({ error: 'forbidden' })
    return db.prepare('SELECT * FROM companies ORDER BY created_at DESC').all()
  })

  app.post('/api/companies', { preHandler: [auth] }, async (req, reply) => {
    const payload = req.user as AuthPayload
    if (payload.role !== 'superadmin') return reply.code(401).send({ error: 'forbidden' })
    const { name, email, password } = req.body as { name: string; email?: string; password?: string }
    if (!name) return reply.code(400).send({ error: 'name required' })
    const { id } = createCompany(name)
    if (email && password) createUser({ companyId: id, name: 'Admin', email, password, role: 'admin' })
    const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(id)
    bus.emit(`company:${id}:admin`, { companyId: id, type: 'company_created' })
    return company
  })

  app.get('/api/companies/:id/users', { preHandler: [auth] }, async (req, reply) => {
    const payload = req.user as AuthPayload
    const cid = Number((req.params as any).id)
    if (payload.role !== 'superadmin' && payload.companyId !== cid) return reply.code(401).send({ error: 'forbidden' })
    const users = db.prepare('SELECT id, name, email, role FROM users WHERE company_id = ?').all(cid)
    const sessions = db.prepare('SELECT * FROM phone_sessions WHERE company_id = ?').all(cid)
    return { users, sessions }
  })

  app.post('/api/companies/:id/users', { preHandler: [auth] }, async (req, reply) => {
    const payload = req.user as AuthPayload
    const cid = Number((req.params as any).id)
    if (payload.role !== 'superadmin' && payload.companyId !== cid) return reply.code(401).send({ error: 'forbidden' })
    const { name, email, password, role } = req.body as { name: string; email: string; password: string; role: string }
    if (!name || !email || !password) return reply.code(400).send({ error: 'name, email, password required' })
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return reply.code(400).send({ error: 'email already exists' })
    return createUser({ companyId: cid, name, email, password, role: role || 'agent' })
  })

  // ---- WhatsApp sessions ----
  app.get('/api/company/sessions', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    return db
      .prepare('SELECT * FROM phone_sessions WHERE company_id = ? ORDER BY created_at DESC')
      .all(cid)
      .map((s: any) => ({ ...s, live_status: whatsapp.getStatus(s.id) }))
  })

  app.post('/api/company/sessions', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    const { name } = req.body as { name?: string }
    if (!name) return reply.code(400).send({ error: 'name required' })
    const r = db.prepare('INSERT INTO phone_sessions (company_id, name, status) VALUES (?, ?, ?)').run(cid, name, 'pending')
    const id = Number(r.lastInsertRowid)
    await whatsapp.start(id)
    return { id }
  })

  app.get('/api/company/sessions/:id/qr', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    const id = Number((req.params as any).id)
    const row = db.prepare('SELECT * FROM phone_sessions WHERE id = ? AND company_id = ?').get(id, cid) as any
    if (!row) return reply.code(404).send({ error: 'not found' })
    const status = whatsapp.getStatus(id)
    if (status === 'connected') return { status, connected: true }
    if (status === 'pending') await whatsapp.start(id).catch(() => {})
    const rt = whatsapp.getRuntime(id)
    return { status: whatsapp.getStatus(id), qr: rt?.qr ? await import('qrcode').then((m) => m.toDataURL(rt!.qr!)) : null }
  })

  app.post('/api/company/sessions/:id/reconnect', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    const id = Number((req.params as any).id)
    const row = db.prepare('SELECT * FROM phone_sessions WHERE id = ? AND company_id = ?').get(id, cid) as any
    if (!row) return reply.code(404).send({ error: 'not found' })
    await whatsapp.start(id).catch((e) => reply.code(500).send({ error: e.message }))
    return { ok: true }
  })

  app.post('/api/company/sessions/:id/disconnect', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    const id = Number((req.params as any).id)
    const row = db.prepare('SELECT * FROM phone_sessions WHERE id = ? AND company_id = ?').get(id, cid) as any
    if (!row) return reply.code(404).send({ error: 'not found' })
    await whatsapp.stop(id)
    return { ok: true }
  })

  app.delete('/api/company/sessions/:id', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    const id = Number((req.params as any).id)
    const row = db.prepare('SELECT * FROM phone_sessions WHERE id = ? AND company_id = ?').get(id, cid) as any
    if (!row) return reply.code(404).send({ error: 'not found' })
    await whatsapp.stop(id).catch(() => {})
    db.prepare('DELETE FROM phone_sessions WHERE id = ?').run(id)
    return { ok: true }
  })

  // ---- contacts ----
  app.get('/api/company/contacts', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    const search = String((req.query as any)?.search || '')
    const rows = search
      ? db
          .prepare(
            'SELECT * FROM contacts WHERE company_id = ? AND (name LIKE ? OR phone LIKE ?) ORDER BY updated_at DESC'
          )
          .all(cid, `%${search}%`, `%${search}%`)
      : db.prepare('SELECT * FROM contacts WHERE company_id = ? ORDER BY updated_at DESC').all(cid)
    return rows
  })

  app.post('/api/company/contacts', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    const { name, phone, jid, custom_fields } = req.body as { name?: string; phone?: string; jid?: string; custom_fields?: any }
    const finalJid = jid || (phone ? phoneToJid(phone) : null)
    if (!finalJid) return reply.code(400).send({ error: 'phone or jid required' })
    const id = upsertContact(cid, finalJid, name || null)
    if (custom_fields) db.prepare('UPDATE contacts SET custom_fields = ? WHERE id = ?').run(JSON.stringify(custom_fields), id)
    return db.prepare('SELECT * FROM contacts WHERE id = ?').get(id)
  })

  app.patch('/api/company/contacts/:id', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    const id = Number((req.params as any).id)
    const row = db.prepare('SELECT * FROM contacts WHERE id = ? AND company_id = ?').get(id, cid) as any
    if (!row) return reply.code(404).send({ error: 'not found' })
    const { name, custom_fields } = req.body as { name?: string; custom_fields?: any }
    if (name !== undefined) db.prepare("UPDATE contacts SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, id)
    if (custom_fields !== undefined) db.prepare("UPDATE contacts SET custom_fields = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(custom_fields), id)
    return db.prepare('SELECT * FROM contacts WHERE id = ?').get(id)
  })

  app.delete('/api/company/contacts/:id', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    const id = Number((req.params as any).id)
    db.prepare('DELETE FROM contacts WHERE id = ? AND company_id = ?').run(id, cid)
    return { ok: true }
  })

  // ---- chats + messages ----
  app.get('/api/company/chats', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    const chats = db
      .prepare(
        `SELECT c.*, ct.name AS contact_name, ct.phone AS contact_phone, ct.jid,
                u.name AS assigned_name
         FROM chats c
         LEFT JOIN contacts ct ON ct.id = c.contact_id
         LEFT JOIN users u ON u.id = c.assigned_to
         WHERE c.company_id = ?
         ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC`
      )
      .all(cid) as unknown as Row[]
    return chats.map((c: any) => ({ ...c, unread: c.unread || 0 }))
  })

  app.get('/api/company/chats/:id/messages', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    const chatId = Number((req.params as any).id)
    const chat = db.prepare('SELECT * FROM chats WHERE id = ? AND company_id = ?').get(chatId, cid) as any
    if (!chat) return reply.code(404).send({ error: 'not found' })
    const msgs = db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY id ASC').all(chatId)
    db.prepare('UPDATE chats SET unread = 0 WHERE id = ?').run(chatId)
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(chat.contact_id)
    return { chat, contact, messages: msgs }
  })

  async function sendHumanReply(req: FastifyRequest, reply: FastifyReply) {
    const cid = companyIdFor(req)
    const chatId = Number((req.params as any).chatId)
    const { text, asVoice } = req.body as { text?: string; asVoice?: boolean }
    if (!text && !asVoice) return reply.code(400).send({ error: 'text required' })
    const chat = db.prepare('SELECT * FROM chats WHERE id = ? AND company_id = ?').get(chatId, cid) as any
    if (!chat) return reply.code(404).send({ error: 'not found' })
    const sessionId = chat.session_id || defaultSession(cid)
    if (!sessionId) return reply.code(400).send({ error: 'no connected WhatsApp session' })
    const payload = req.user as AuthPayload
    const senderName = db.prepare('SELECT name FROM users WHERE id = ?').get(payload.userId) as any

    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(chat.contact_id) as any
    if (asVoice) {
      try {
        const { textToSpeech } = await import('../ai/tts.js')
        const settings = getSettings(cid) as any
        const { audio } = await textToSpeech(text || '', settings.tts_voice || 'en-US-JennyNeural')
        await whatsapp.sendMessage(sessionId, contact.jid, { audio, mimetype: 'audio/mpeg', ptt: true })
      } catch (e) {
        return reply.code(500).send({ error: 'TTS failed: ' + (e as Error).message })
      }
    } else {
      await whatsapp.sendMessage(sessionId, contact.jid, { text })
    }

    const msgId = insertMessage({ companyId: cid, chatId, sessionId, direction: 'out', type: asVoice ? 'audio' : 'text', body: text ?? null, sender: contact.jid, isAi: 0 })
    updateChatLastMessage(chatId, asVoice ? '🎤 ' + (text ?? '') : (text ?? ''), 0)
    const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId) as any
    bus.emit(`company:${cid}:message`, { companyId: cid, message: { ...m, chatId, isAi: 0, phone: contact.phone, contactName: contact.name || contact.phone, at: m.created_at, id: m.id } })
    if (senderName) bus.emit(`company:${cid}:admin`, { companyId: cid, type: 'human_reply', by: senderName.name })
    return { ok: true, message: m }
  }

  app.post('/api/company/chats/:chatId/send', { preHandler: [auth] }, sendHumanReply)

  app.post('/api/company/chats/:id/toggle-ai', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    const id = Number((req.params as any).id)
    const { enabled } = req.body as { enabled: boolean }
    const chat = db.prepare('SELECT * FROM chats WHERE id = ? AND company_id = ?').get(id, cid) as any
    if (!chat) return reply.code(404).send({ error: 'not found' })
    db.prepare('UPDATE chats SET ai_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
    return { ok: true, aiEnabled: !!enabled }
  })

  app.post('/api/company/chats/:id/assign', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    const id = Number((req.params as any).id)
    const { userId } = req.body as { userId: number | null }
    const chat = db.prepare('SELECT * FROM chats WHERE id = ? AND company_id = ?').get(id, cid) as any
    if (!chat) return reply.code(404).send({ error: 'not found' })
    db.prepare('UPDATE chats SET assigned_to = ? WHERE id = ?').run(userId, id)
    return { ok: true }
  })

  // ---- company settings + knowledge ----
  app.get('/api/company/settings', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(cid)
    return { company, settings: getSettings(cid) }
  })

  app.put('/api/company/settings', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    const body = req.body as Record<string, any>
    const allowed = ['ai_provider', 'ai_base_url', 'ai_model', 'ai_api_key', 'ai_persona', 'ai_voice_enabled', 'tts_voice', 'ai_active', 'ai_auto_send_audio', 'auto_reply_delay', 'language']
    const sets: string[] = []
    const vals: any[] = []
    for (const k of allowed) {
      if (k in body) {
        sets.push(`${k} = ?`)
        vals.push(typeof body[k] === 'boolean' || typeof body[k] === 'number' ? Number(body[k]) : body[k])
      }
    }
    if (sets.length) db.prepare(`UPDATE company_settings SET ${sets.join(', ')} WHERE company_id = ?`).run(...vals, cid)
    return { settings: getSettings(cid) }
  })

  app.get('/api/company/knowledge', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    return db.prepare('SELECT * FROM knowledge WHERE company_id = ? ORDER BY created_at DESC').all(cid)
  })

  app.post('/api/company/knowledge', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    const { title, content } = req.body as { title?: string; content?: string }
    if (!title || !content) return reply.code(400).send({ error: 'title and content required' })
    const r = db.prepare('INSERT INTO knowledge (company_id, title, content) VALUES (?, ?, ?)').run(cid, title, content)
    return db.prepare('SELECT * FROM knowledge WHERE id = ?').get(Number(r.lastInsertRowid))
  })

  app.delete('/api/company/knowledge/:id', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    const id = Number((req.params as any).id)
    db.prepare('DELETE FROM knowledge WHERE id = ? AND company_id = ?').run(id, cid)
    return { ok: true }
  })

  // ---- users (per company) ----
  app.get('/api/company/users', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    return db.prepare('SELECT id, name, email, role FROM users WHERE company_id = ?').all(cid)
  })

  app.post('/api/company/users', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    const payload = req.user as AuthPayload
    if (payload.role !== 'admin' && payload.role !== 'superadmin') return reply.code(401).send({ error: 'forbidden' })
    const { name, email, password, role } = req.body as { name: string; email: string; password: string; role: string }
    if (!name || !email || !password) return reply.code(400).send({ error: 'name, email, password required' })
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return reply.code(400).send({ error: 'email already exists' })
    return createUser({ companyId: cid, name, email, password, role: role || 'agent' })
  })

  // ---- campaigns ----
  app.get('/api/company/campaigns', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    return db.prepare('SELECT * FROM campaigns WHERE company_id = ? ORDER BY created_at DESC').all(cid)
  })

  app.post('/api/company/campaigns', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    const body = req.body as any
    if (!body.name || !body.message || !body.contactIds?.length) return reply.code(400).send({ error: 'name, message, contactIds required' })
    const r = db
      .prepare(
        `INSERT INTO campaigns (company_id, session_id, name, message, contact_ids, personalize, as_voice, total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(cid, body.sessionId || null, body.name, body.message, JSON.stringify(body.contactIds), body.personalize ? 1 : 0, body.asVoice ? 1 : 0, body.contactIds.length)
    return db.prepare('SELECT * FROM campaigns WHERE id = ?').get(Number(r.lastInsertRowid))
  })

  app.post('/api/company/campaigns/:id/run', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    const id = Number((req.params as any).id)
    const camp = db.prepare('SELECT * FROM campaigns WHERE id = ? AND company_id = ?').get(id, cid) as any
    if (!camp) return reply.code(404).send({ error: 'not found' })
    runCampaign(id).catch((e) => console.error('[campaign] run error', (e as Error).message))
    return { ok: true }
  })

  app.delete('/api/company/campaigns/:id', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    const id = Number((req.params as any).id)
    db.prepare('DELETE FROM campaigns WHERE id = ? AND company_id = ?').run(id, cid)
    return { ok: true }
  })

  // ---- follow-ups ----
  app.post('/api/company/followups', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    const { chatId, message, runAt } = req.body as { chatId: number; message: string; runAt: string }
    if (!chatId || !message || !runAt) return reply.code(400).send({ error: 'chatId, message, runAt required' })
    const chat = db.prepare('SELECT * FROM chats WHERE id = ? AND company_id = ?').get(chatId, cid) as any
    if (!chat) return reply.code(404).send({ error: 'not found' })
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(chat.contact_id) as any
    const r = db
      .prepare(
        'INSERT INTO scheduled_followups (company_id, chat_id, contact_jid, session_id, message, run_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(cid, chatId, contact.jid, chat.session_id || null, message, runAt)
    return db.prepare('SELECT * FROM scheduled_followups WHERE id = ?').get(Number(r.lastInsertRowid))
  })

  app.get('/api/company/followups', { preHandler: [auth] }, async (req, reply) => {
    const cid = companyIdFor(req)
    return db
      .prepare(
        `SELECT f.*, ct.name AS contact_name FROM scheduled_followups f
         LEFT JOIN chats c ON c.id = f.chat_id
         LEFT JOIN contacts ct ON ct.id = c.contact_id
         WHERE f.company_id = ? ORDER BY f.created_at DESC`
      )
      .all(cid)
  })

  // ---- serve the built frontend (so one URL runs everything) ----
  const webDist = path.resolve(import.meta.dirname, '../../../web/dist')
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' })
    app.get('/', async (_req, reply) => reply.sendFile('index.html'))
    // SPA fallback — but never swallow API / WS calls
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws')) {
        return reply.sendFile('index.html')
      }
      return reply.code(404).send({ error: 'not found' })
    })
  } else {
    app.get('/', async () => ({
      ok: true,
      api: 'running on :' + config.port,
      web: "frontend not built — run 'cd web && npm run dev' (http://localhost:5173) or 'npm run build' to serve here",
    }))
  }

  return app
}

function defaultSession(companyId: number): number | null {
  const row = db.prepare("SELECT id FROM phone_sessions WHERE company_id = ? AND status = 'connected' LIMIT 1").get(companyId) as { id: number } | undefined
  return row?.id ?? null
}