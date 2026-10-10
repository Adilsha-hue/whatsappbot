import { db } from '../db/index.js'
import { getSettings, getCompanyName, getChat } from '../db/messaging.js'
import { generateReply } from './llm.js'
import { textToSpeech } from './tts.js'
import { retrieveKnowledge } from './retrieval.js'
import { bus } from '../realtime/bus.js'

interface Incoming {
  companyId: number
  chatId: number
  sessionId: number
  jid: string
  body: string
  messageType: string
  contact?: any
}

type SendFn = (sessionId: number, jid: string, content: any) => Promise<unknown>
type PresenceFn = (sessionId: number, jid: string, state: 'composing' | 'paused' | 'recording') => Promise<void>

class AiResponder {
  private send: SendFn = async () => {}
  private presence: PresenceFn = async () => {}
  private inflight = new Map<number, Promise<void>>()

  configure(opts: { send: SendFn; presence: PresenceFn }) {
    this.send = opts.send
    this.presence = opts.presence
  }

  async onIncoming(msg: Incoming) {
    const { companyId, chatId, body, messageType } = msg

    // only auto-respond to text-ish messages
    if (messageType !== 'text' && messageType !== 'image' && messageType !== 'video') return

    const chat = getChat(chatId)
    if (!chat || !chat.aiEnabled) return

    const settings = getSettings(companyId) as any
    if (!settings.ai_active) return

    if (settings.ai_provider === 'none' || !settings.ai_model) return

    // queue sequentially per chat so replies don't overlap
    const prev = this.inflight.get(chatId) || Promise.resolve()
    const run = prev.then(() => this.handle(msg, settings))
    this.inflight.set(chatId, run)
    try {
      await run
    } catch (e) {
      console.error('[ai] responder error:', (e as Error).message)
    } finally {
      this.inflight.delete(chatId)
    }
  }

  private async handle(msg: Incoming, settings: any) {
    const { companyId, chatId, sessionId, jid, body } = msg

    // simulate natural human delay + typing indicator
    const delayMs = Math.max(1, Number(settings.auto_reply_delay || 3)) * 1000
    await sleep(delayMs)
    await this.presence(sessionId, jid, 'composing')

    const companyName = getCompanyName(companyId)
    const knowledge = retrieveKnowledge(companyId, body || '', 3)
    const persona = settings.ai_persona.replaceAll('{company}', companyName)

    const systemPrompt = [
      persona,
      '',
      'COMPANY KNOWLEDGE BASE (only use if relevant, never invent):',
      knowledge.length ? '"""\n' + knowledge.join('\n\n---\n') + '\n"""' : '(no knowledge loaded)',
      '',
      'Instructions:',
      '- Reply as a real human sales rep would. Be warm, natural, and brief (under ~40 words unless asked for detail).',
      '- Never say you are an AI or a bot.',
      '- Answer from the knowledge base when possible; otherwise offer to connect a human agent.',
      '- Spanish/Other: mirror the customer\'s language.',
    ].join('\n')

    const history = this.buildHistory(companyId, chatId, sessionId)

    const reply = await generateReply(
      {
        provider: settings.ai_provider,
        baseUrl: settings.ai_base_url,
        model: settings.ai_model,
        apiKey: settings.ai_api_key,
      },
      systemPrompt,
      history
    )

    if (!reply) {
      await this.presence(sessionId, jid, 'paused')
      return
    }

    // pleasant human touch: if it's a long reply, pause mid-way like typing a real message
    if (reply.length > 200) {
      await sleep(1800)
      await this.presence(sessionId, jid, 'paused')
      await sleep(600)
      await this.presence(sessionId, jid, 'composing')
    }

    let sentType = 'text'
    let sentBody = reply

    if (Number(settings.ai_voice_enabled)) {
      try {
        await this.presence(sessionId, jid, 'recording')
        const { audio } = await textToSpeech(reply, settings.tts_voice || 'en-US-JennyNeural')
        await this.send(sessionId, jid, { audio, mimetype: 'audio/mpeg', ptt: true })
        sentType = 'audio'
        sentBody = '🎤 ' + reply
      } catch (e) {
        console.error('[ai] TTS failed, falling back to text:', (e as Error).message)
        await this.send(sessionId, jid, { text: reply })
      }
    } else {
      await this.send(sessionId, jid, { text: reply })
    }

    await this.presence(sessionId, jid, 'paused')

    const msgId = db
      .prepare(
        `INSERT INTO messages (company_id, chat_id, session_id, direction, type, body, sender, is_ai)
         VALUES (?, ?, ?, 'out', ?, ?, ?, 1)`
      )
      .run(companyId, chatId, sessionId, sentType, sentBody, jid)

    const mrow = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(msgId.lastInsertRowid)) as any
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(getChat(chatId)!.contactId) as any
    bus.emit(`company:${companyId}:message`, {
      companyId,
      message: {
        ...mrow,
        chatId,
        isAi: 1,
        phone: contact?.phone,
        contactName: contact?.name || contact?.phone,
        at: mrow.created_at,
        id: mrow.id,
      },
    })
  }

  private buildHistory(companyId: number, chatId: number, sessionId: number) {
    const rows = db
      .prepare("SELECT body, direction FROM messages WHERE chat_id = ? AND direction IN ('in','out') ORDER BY id DESC LIMIT 10")
      .all(chatId) as unknown as { body: string | null; direction: string }[]
    const history: { role: 'user' | 'assistant'; content: string }[] = []
    for (const r of [...rows].reverse()) {
      if (!r.body) continue
      history.push({ role: r.direction === 'in' ? 'user' : 'assistant', content: r.body })
    }
    return history
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export const responder = new AiResponder()