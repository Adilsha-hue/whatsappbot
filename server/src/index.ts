import { config } from './config.js'
import { seedSuperAdmin } from './db/repo.js'
import './db/index.js'
import { buildServer } from './api/server.js'
import { startRealtime } from './realtime/ws.js'
import { whatsapp } from './whatsapp/manager.js'
import { responder } from './ai/responder.js'
import { startFollowupScheduler } from './whatsapp/campaigns.js'

async function main() {
  seedSuperAdmin()

  responder.configure({
    send: (sessionId, jid, content) => whatsapp.sendMessage(sessionId, jid, content),
    presence: (sessionId, jid, state) => whatsapp.sendPresence(sessionId, jid, state),
  })

  const app = await buildServer()
  await app.listen({ port: config.port, host: config.host })
  startRealtime(app.server)

  await whatsapp.startAll()
  startFollowupScheduler()

  console.log(`\n[server] WhatsApp CRM running on http://localhost:${config.port}`)
  console.log(`[server] login: ${config.adminEmail} / ${config.adminPassword}`)
  console.log(`[server] AI provider default: ${config.defaultAiProvider} -> ${config.defaultAiModel} (${config.defaultAiBaseUrl})`)
  if (config.defaultAiProvider === 'ollama') {
    console.log('[server] tip: install Ollama + `ollama pull llama3.2` for free local AI, or set AI_PROVIDER=groq + a free API key in .env')
  }
}

main().catch((e) => {
  console.error('[server] fatal:', e)
  process.exit(1)
})