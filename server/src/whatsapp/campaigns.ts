import { db } from '../db/index.js'
import { whatsapp } from './manager.js'
import { getSettings } from '../db/messaging.js'
import { bus } from '../realtime/bus.js'
import { generateReply } from '../ai/llm.js'
import { textToSpeech } from '../ai/tts.js'

export async function sendText(sessionId: number, jid: string, text: string) {
  return whatsapp.sendMessage(sessionId, jid, { text })
}

export async function sendAudio(sessionId: number, jid: string, buffer: Buffer) {
  return whatsapp.sendMessage(sessionId, jid, { audio: buffer, mimetype: 'audio/mpeg', ptt: true })
}

// Generic message sender that can personalize text with AI and optionally send as voice
export async function sendCampaignMessage(opts: {
  sessionId: number
  jid: string
  message: string
  companyId: number
  personalize?: boolean
  asVoice?: boolean
}): Promise<void> {
  let text = opts.message
  if (opts.personalize && opts.companyId) {
    const settings = getSettings(opts.companyId) as any
    const reply = await generateReply(
      { provider: settings.ai_provider, baseUrl: settings.ai_base_url, model: settings.ai_model, apiKey: settings.ai_api_key },
      'Rewrite this marketing message to sound warm and personal, keep it short (max 60 words), keep the key facts: ' + opts.message,
      []
    )
    if (reply) text = reply
  }

  if (opts.asVoice && opts.companyId) {
    const settings = getSettings(opts.companyId) as any
    const { audio } = await textToSpeech(text, settings.tts_voice || 'en-US-JennyNeural')
    await sendAudio(opts.sessionId, opts.jid, audio)
  } else {
    await sendText(opts.sessionId, opts.jid, text)
  }
}

// ------- scheduled follow-ups (lead nurturing) -------
export function startFollowupScheduler() {
  setInterval(async () => {
    const due = db
      .prepare("SELECT * FROM scheduled_followups WHERE status = 'pending' AND run_at <= datetime('now')")
      .all() as unknown as any[]

    for (const f of due) {
      try {
        const sessionId = f.session_id || getDefaultSession(f.company_id)
        if (!sessionId) continue
        const s = whatsapp.getRuntime(sessionId)
        if (!s?.sock) continue
        await sendText(sessionId, f.contact_jid, f.message)
        db.prepare("UPDATE scheduled_followups SET status = ?, sent_at = datetime('now') WHERE id = ?").run('sent', f.id)
        bus.emit(`company:${f.company_id}:admin`, { companyId: f.company_id, type: 'followup_sent', followupId: f.id })
      } catch (e) {
        console.error('[campaign] followup error', (e as Error).message)
      }
    }
  }, 20000)
  console.log('[campaign] follow-up scheduler started')
}

function getDefaultSession(companyId: number): number | null {
  const row = db
    .prepare("SELECT id FROM phone_sessions WHERE company_id = ? AND status = 'connected' LIMIT 1")
    .get(companyId) as { id: number } | undefined
  return row?.id ?? null
}

// ------- bulk campaign runner -------
const activeRuns = new Set<number>()

export async function runCampaign(campaignId: number) {
  if (activeRuns.has(campaignId)) return
  activeRuns.add(campaignId)
  const camp = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId) as any
  if (!camp) {
    activeRuns.delete(campaignId)
    return
  }
  db.prepare("UPDATE campaigns SET status = 'running' WHERE id = ?").run(campaignId)

  const contactRows = (() => {
    let ids: number[] = []
    try {
      ids = JSON.parse(camp.contact_ids || '[]')
    } catch {}
    if (!ids.length) return [] as any[]
    const placeholders = ids.map(() => '?').join(',')
    return db.prepare(`SELECT * FROM contacts WHERE id IN (${placeholders})`).all(...ids) as unknown as any[]
  })()
  const sessionId = camp.session_id || getDefaultSession(camp.company_id)
  if (!sessionId || contactRows.length === 0) {
    db.prepare("UPDATE campaigns SET status = 'failed' WHERE id = ?").run(campaignId)
    activeRuns.delete(campaignId)
    bus.emit(`company:${camp.company_id}:campaign`, { campaignId, status: 'failed', companyId: camp.company_id })
    return
  }

  let sent = 0
  let failed = 0
  for (const contact of contactRows) {
    try {
      await sendCampaignMessage({
        sessionId,
        jid: contact.jid,
        message: camp.message,
        companyId: camp.company_id,
        personalize: !!camp.personalize,
        asVoice: !!camp.as_voice,
      })
      sent++
    } catch (e) {
      failed++
      console.error('[campaign] send error', (e as Error).message)
    }
    db.prepare('UPDATE campaigns SET sent = ?, failed = ? WHERE id = ?').run(sent, failed, campaignId)
    bus.emit(`company:${camp.company_id}:campaign`, {
      campaignId,
      status: 'running',
      sent,
      failed,
      total: contactRows.length,
      companyId: camp.company_id,
    })
    // be gentle with WhatsApp to avoid bans
    await new Promise((r) => setTimeout(r, 2500))
  }

  db.prepare("UPDATE campaigns SET status = 'done' WHERE id = ?").run(campaignId)
  activeRuns.delete(campaignId)
  bus.emit(`company:${camp.company_id}:campaign`, {
    campaignId,
    status: 'done',
    sent,
    failed,
    total: contactRows.length,
    companyId: camp.company_id,
  })
}