import http from 'node:http'
import { db } from './src/db/index.js'
import { createCompany } from './src/db/repo.js'
import { whatsapp } from './src/whatsapp/manager.js'
import { responder } from './src/ai/responder.js'

// ------- mock OpenAI-compatible LLM (echoes the system prompt so we can assert knowledge injection) -------
const captured: any[] = []
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    try {
      const payload = JSON.parse(body)
      captured.push(payload)
      const system = payload.messages.find((m: any) => m.role === 'system')?.content || ''
      const lastUser = [...payload.messages].reverse().find((m: any) => m.role === 'user')?.content || ''
      const reply = `MOCK-REPLY|${system}-|USERSAY:` + lastUser
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }))
    } catch (e) {
      res.writeHead(500)
      res.end(String(e))
    }
  })
})
const llmPort = await new Promise<number>((ok) => {
  server.listen(0, '127.0.0.1', () => ok((server.address() as any).port))
})
console.log('[audit] mock LLM on 127.0.0.1:' + llmPort)

// ------- a throwaway company so we don't pollute real workspaces -------
const ts = Date.now()
const { id: companyId } = createCompany(`Audit Corp ${ts}`)
db.prepare('UPDATE company_settings SET ai_provider=?, ai_base_url=?, ai_model=?, ai_api_key=?, ai_voice_enabled=?, auto_reply_delay=?, ai_active=? WHERE company_id=?')
  .run('openai', `http://127.0.0.1:${llmPort}/v1`, 'mock-model', 'x', 0, 0, 1, companyId)

// knowledge the AI should retrieve & quote
db.prepare('INSERT INTO knowledge (company_id, title, content) VALUES (?, ?, ?)').run(companyId, 'Pricing', 'PRO plan is 249 per month, Enterprise is custom.')

// a session row (no real WhatsApp — we inject a fake socket)
const sid = Number(db.prepare('INSERT INTO phone_sessions (company_id, name, status) VALUES (?, ?, ?)').run(companyId, 'untest', 'connected').lastInsertRowid)

// ------- fake socket -------
const sent: any[] = []
const presences: string[] = []
const fakeSock: any = {
  sendReceipt: async () => {},
  sendMessage: async (_jid: string, content: any) => {
    sent.push(content)
    return { key: { id: content._oid || 'fake-id' } }
  },
  presenceSubscribe: async () => {},
  sendPresenceUpdate: async (s: string) => {
    presences.push(s)
  },
}

// ------- wire responder (defaults already configured in index; we re-set to use manager) -------
responder.configure({
  send: (sessionId, jid, content) => whatsapp.sendMessage(sessionId, jid, content),
  presence: (sessionId, jid, state) => whatsapp.sendPresence(sessionId, jid, state),
})

function waitFor(cond: () => boolean, t = 15000): Promise<void> {
  return new Promise((res, rej) => {
    const start = Date.now()
    const iv = setInterval(() => {
      if (cond()) {
        clearInterval(iv)
        res()
      } else if (Date.now() - start > t) {
        clearInterval(iv)
        rej(new Error('timeout waiting for condition'))
      }
    }, 100)
  })
}

let pass = 0
let fail = 0
function check(name: string, ok: boolean, extra = '') {
  if (ok) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name} ${extra}`)
  }
}

// ------- TEST: text incoming message → AI replies (text mode) -------
console.log('\n[TEST] human-like AI text reply')
await whatsapp.start(sid)
const rt = whatsapp.getRuntime(sid)!
rt.sock = fakeSock
rt.connected = true

const incoming = {
  key: { id: 'in-1', fromMe: false, remoteJid: '919000000001@s.whatsapp.net' },
  pushName: 'Priya',
  message: { conversation: 'hi, how much is the pro plan?' },
}

await whatsapp.processIncomingMessage(sid, fakeSock, incoming)
await waitFor(() => sent.length > 0)

const aiMsg = db.prepare(`SELECT * FROM messages WHERE company_id=? AND is_ai=1 ORDER BY id DESC LIMIT 1`).get(companyId) as any
const contact = db.prepare('SELECT * FROM contacts WHERE company_id=? AND jid=?').get(companyId, incoming.key.remoteJid) as any
const chat = db.prepare('SELECT * FROM chats WHERE company_id=?').get(companyId) as any

check('contact auto-created', !!contact)
check('chat auto-created', !!chat)
check('incoming message stored', !!db.prepare(`SELECT id FROM messages WHERE company_id=? AND direction='in'`).get(companyId))
check('AI outbound reply stored', !!aiMsg)
check('reply sent as text', sent[0]?.text && sent[0].text.startsWith('MOCK-REPLY'), JSON.stringify(sent[0])?.slice(0, 60))
check('AI used company knowledge (pricing in prompt)', (aiMsg?.body || '').includes('PRO plan is 249 per month'), (aiMsg?.body || '').slice(0, 80))
check('typing presence was simulated', presences.includes('composing') && presences.includes('paused'), JSON.stringify(presences))
check('customer message passed to LLM', captured.some((c) => JSON.stringify(c).includes('how much is the pro plan')))

// ------- TEST: voice mode reply -------
console.log('\n[TEST] AI voice-note reply')
db.prepare('UPDATE company_settings SET ai_voice_enabled=1 WHERE company_id=?').run(companyId)
sent.length = 0
presences.length = 0
await whatsapp.processIncomingMessage(sid, fakeSock, {
  key: { id: 'in-2', fromMe: false, remoteJid: '919000000001@s.whatsapp.net' },
  pushName: 'Priya',
  message: { conversation: 'and what about enterprise?' },
})
await waitFor(() => sent.length > 0)

const v = sent[0] || {}
check('sent audio buffer (voice note)', Buffer.isBuffer(v.audio) && v.audio.length > 0, String(v.audio?.length))
check('marked as push-to-talk (ptt)', v.ptt === true, JSON.stringify({ ...v, audio: undefined }))
check('mime is audio/mpeg', v.mimetype === 'audio/mpeg', v.mimetype)
check('recording presence shown during voice reply', presences.includes('recording'), JSON.stringify(presences))

// ------- TEST: AI off per-chat toggle -------
console.log('\n[TEST] chat-level AI toggle respected')
db.prepare('UPDATE chats SET ai_enabled=0 WHERE id=?').run(chat.id)
const beforeA = db.prepare('SELECT COUNT(*) c FROM messages WHERE company_id=? AND is_ai=1').get(companyId).c
await whatsapp.processIncomingMessage(sid, fakeSock, {
  key: { id: 'in-3', fromMe: false, remoteJid: '919000000001@s.whatsapp.net' },
  pushName: 'Priya',
  message: { conversation: 'hello??' },
})
await new Promise((r) => setTimeout(r, 600))
const afterA = db.prepare('SELECT COUNT(*) c FROM messages WHERE company_id=? AND is_ai=1').get(companyId).c
check('no new AI reply when chat AI is off', afterA === beforeA)

// ------- TEST: image caption (media) message still logged, AI skips -------
console.log('\n[TEST] media message handling')
db.prepare('UPDATE chats SET ai_enabled=1 WHERE id=?').run(chat.id)
await whatsapp.processIncomingMessage(sid, fakeSock, {
  key: { id: 'in-4', fromMe: false, remoteJid: '919000000001@s.whatsapp.net' },
  pushName: 'Priya',
  message: { imageMessage: { caption: 'here is the product' } },
})
const media = db.prepare(`SELECT type, body FROM messages WHERE company_id=? AND direction='in' AND type='image'`).get(companyId) as any
check('picture recorded with caption', !!media && media.body === 'here is the product')

// ------- TEST: retrieval relevance -------
console.log('\n[TEST] knowledge retrieval picks right entry')
{
  const { retrieveKnowledge } = await import('./src/ai/retrieval.js')
  const hits = retrieveKnowledge(companyId, 'what does the pro plan cost?')
  check('retrieval returns pricing entry', hits.some((h) => h.includes('PRO plan')), JSON.stringify(hits))
}

// ------- TEST: TTS raw (voice bytes) -------
console.log('\n[TEST] free voice synthesis (Edge TTS)')
try {
  const { textToSpeech } = await import('./src/ai/tts.js')
  const { audio } = await textToSpeech('Thank you for asking!', 'en-US-JennyNeural')
  check('TTS produces playable audio', audio.length > 1000, `bytes=${audio.length}`)
} catch (e) {
  check('TTS produces playable audio', false, (e as Error).message)
}

// ------- cleanup -------
server.close()
await whatsapp.stop(sid)
db.prepare('DELETE FROM companies WHERE id=?').run(companyId)

console.log(`\n===== AUDIT RESULT: ${pass} passed, ${fail} failed =====`)
process.exit(fail ? 1 : 0)