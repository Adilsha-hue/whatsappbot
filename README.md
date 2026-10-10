# DealDeploy — Multi-tenant WhatsApp CRM (free)

A sellable WhatsApp CRM you can resell to many companies. Every customer company gets its own isolated workspace, its own WhatsApp number(s), and an **AI that answers customers 24/7 like a human — including voice notes** built on your company knowledge.

## Features

| Feature | What it does |
|---|---|
| **Multi-tenant** | Super admin creates a workspace per customer company. Each has its own users, WhatsApp numbers, contacts, campaigns and AI brain. |
| **AI auto-responder** | Replies instantly to every incoming WhatsApp message like a human sales rep: typing indicator, natural delay, answers from the company knowledge base, mirrors the customer's language. |
| **Voice replies** | AI answers can be sent as **voice notes** (free Microsoft Edge TTS). Agents can also reply with voice. |
| **Unified inbox** | All conversations in one realtime inbox. Agents see unread counts, take over a chat (toggles AI off), assign to each other, schedule follow-ups. |
| **Bulk campaigns** | Broadcast offers to thousands at once, optional AI personalization and voice mode, gentle send pacing to avoid bans. |
| **Lead nurturing** | Schedule follow-up messages per conversation, sent automatically at the right time. |
| **Company knowledge base** | Paste your products, prices, FAQs, shipping info — the AI retrieves and answers with your real details. |

## How it's free

- **WhatsApp** — connects any normal WhatsApp account via QR (Baileys). No WhatsApp Business API fees.
- **AI** — default is **Ollama** (free, runs locally). Or use Groq's free API tier. Both work with zero cost.
- **Voice** — Microsoft Edge TTS, free, no key.
- **Stack** — Node + TypeScript, SQLite, React. No paid services needed.

> Semi-automated ("simulated human") messaging is against WhatsApp's terms on personal accounts; better suited to a business number & for compliant demo/MVP use. For a full commercial rollout, consider the official Cloud API adapter.

## Quick start

```bash
./dev.sh                # dev mode: API on :4000, Vite web on :5173

# OR production (single URL — web app + API + realtime all on :4000)
cd web && npm run build
cd server && npx tsx src/index.ts     # then open http://localhost:4000
```

Open http://localhost:5173 (dev) or http://localhost:4000 (prod build) → login `admin@company.com` / `admin123`
- Create a company workspace → go to **WhatsApp** tab → add a number → scan QR from a phone
- Configure AI in **AI Settings** (provider/model/key + voice + knowledge base)

### AI options (pick one, all free to start)

```bash
# Option A — Ollama (local, 100% free, no key)
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2        # ~2GB, runs offline

# Option B — Groq (cloud, free API key)
# sign up at console.groq.com -> copy a key -> set AI_PROVIDER=groq, base https://api.groq.com/openai/v1,
# model llama-3.3-70b-versatile, key gsk_...
```

Set these once in `server/.env` as the default for new companies, or per company in AI Settings.

## Architecture

```
server/   Fastify API + Baileys WhatsApp sessions + AI responder + SQLite
  src/whatsapp/manager.ts    multi-session WhatsApp (QR pairing, message ingest)
  src/ai/responder.ts        human-like reply pipeline (delay, typing, text/voice)
  src/ai/llm.ts              OpenAI-compatible adapter (Ollama/Groq/OpenAI)
  src/ai/tts.ts              free voice synthesis via Edge TTS
  src/ai/retrieval.ts        lightweight retrieval from company knowledge base
  src/db/                    SQLite schema + data access
  src/api/server.ts          REST API (auth, companies, sessions, chats, campaigns…)
  src/realtime/ws.ts         WebSocket realtime feed
web/      React + Vite admin app (inbox, contacts, sessions, campaigns, AI settings)
```

## API surface (JSON, Bearer JWT)

- `POST /api/auth/login`, `GET /api/me`
- Superadmin: `GET/POST /api/companies`, `GET/POST /api/companies/:id/users`
- Company: sessions (CRUD + QR/reconnect), contacts, chats + messages + send + toggle-ai + assign, settings (get/put), knowledge (CRUD), campaigns (create/run), follow-ups, users
- Realtime: `ws://localhost:4000/ws?token=<jwt>` (or `/ws` on the dev port 5173) → events scoped by company

## Smoke test

```bash
cd server
TOKEN=$(curl -s -X POST localhost:4000/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"owner@acme.com","password":"acme123"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
npx tsx test-flows.ts "$TOKEN" 1
```

## Caveats / roadmap

- Sandbox limitation: this environment can't reach WhatsApp servers, so QR pairing must be done from your own network/phone.
- Media (images/PDFs sent by customers) is recorded but not yet downloaded into the knowledge base — add document ingestion for full RAG.
- Campaign + follow-up sending is gentle-paced to avoid bans; fine for hundreds, batch-throttle for thousands.