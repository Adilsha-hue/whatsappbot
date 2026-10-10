import { useCallback, useEffect, useState } from 'react'
import { useApi } from '../store'
import { Save, Sparkles, Mic, Trash2, Plus, BookOpen, Bot, KeyRound, Server } from 'lucide-react'

const VOICES = [
  'en-US-JennyNeural',
  'en-US-GuyNeural',
  'en-GB-SoniaNeural',
  'en-GB-RyanNeural',
  'en-AU-NatashaNeural',
  'en-IN-NeerjaNeural',
  'en-IN-PrabhatNeural',
  'hi-IN-SwaraNeural',
  'hi-IN-MadhurNeural',
  'es-ES-ElviraNeural',
  'es-MX-DaliaNeural',
  'pt-BR-FranciscaNeural',
  'de-DE-KatjaNeural',
  'fr-FR-DeniseNeural',
  'ar-EG-SalmaNeural',
]

export default function Settings() {
  const { call, on } = useApi()
  const [company, setCompany] = useState<any>(null)
  const [s, setS] = useState<any>(null)
  const [saved, setSaved] = useState('')
  const [knowledge, setKnowledge] = useState<any[]>([])
  const [kTitle, setKTitle] = useState('')
  const [kContent, setKContent] = useState('')

  const load = useCallback(() => {
    call('/api/company/settings').then((d: any) => {
      setCompany(d.company)
      setS(d.settings)
    }).catch(() => {})
    call('/api/company/knowledge').then(setKnowledge).catch(() => {})
  }, [call])

  useEffect(() => {
    load()
    const off = on('company:*:admin', load)
    return off
  }, [load, on])

  const set = (k: string, v: any) => setS((prev: any) => ({ ...prev, [k]: v }))

  const save = async () => {
    if (!s) return
    await call('/api/company/settings', 'PUT', {
      ai_provider: s.ai_provider,
      ai_base_url: s.ai_base_url,
      ai_model: s.ai_model,
      ai_api_key: s.ai_api_key,
      ai_persona: s.ai_persona,
      ai_voice_enabled: s.ai_voice_enabled,
      tts_voice: s.tts_voice,
      ai_active: s.ai_active,
      auto_reply_delay: s.auto_reply_delay,
    })
    setSaved('Saved')
    setTimeout(() => setSaved(''), 2500)
  }

  const addKnowledge = async () => {
    if (!kTitle || !kContent) return
    await call('/api/company/knowledge', 'POST', { title: kTitle, content: kContent })
    setKTitle('')
    setKContent('')
    call('/api/company/knowledge').then(setKnowledge)
  }

  const delKnowledge = async (id: number) => {
    await call(`/api/company/knowledge/${id}`, 'DELETE')
    call('/api/company/knowledge').then(setKnowledge)
  }

  if (!s) return <div className="page">Loading…</div>

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>AI settings</h1>
          <p className="muted">Tune how the AI answers your customers — text and voice.</p>
        </div>
        <button className="btn btn-primary" onClick={save}>
          <Save size={15} /> {saved || 'Save'}
        </button>
      </div>

      <div className="settings-grid">
        <div className="card">
          <h3 className="row" style={{ gap: 8 }}>
            <Bot size={16} color="#4ADE80" /> AI engine
          </h3>
          <div className="col">
            <label className="lbl">Provider (free options: ollama local · groq API)</label>
            <select className="inp" value={s.ai_provider} onChange={(e) => set('ai_provider', e.target.value)}>
              <option value="ollama">Ollama — free, runs on your server</option>
              <option value="groq">Groq — free API key, fast</option>
              <option value="openai">OpenAI</option>
              <option value="none">None (disable AI)</option>
            </select>

            <label className="lbl">
              <span className="row" style={{ gap: 5 }}>
                <Server size={12} /> API base URL
              </span>
            </label>
            <input
              className="inp"
              value={s.ai_base_url}
              onChange={(e) => set('ai_base_url', e.target.value)}
              placeholder="http://localhost:11434/v1 or https://api.groq.com/openai/v1"
            />

            <label className="lbl">Model</label>
            <input className="inp" value={s.ai_model} onChange={(e) => set('ai_model', e.target.value)} placeholder="llama3.2 or llama-3.3-70b-versatile" />

            <label className="lbl">
              <span className="row" style={{ gap: 5 }}>
                <KeyRound size={12} /> API key (blank for Ollama)
              </span>
            </label>
            <input className="inp" value={s.ai_api_key} onChange={(e) => set('ai_api_key', e.target.value)} placeholder="gsk_…" />

            <p className="muted tiny" style={{ margin: 0 }}>
              <strong>Ollama:</strong> install ollama.com, then `ollama pull llama3.2` — 100% free, no key.
              <br />
              <strong>Groq:</strong> sign up at console.groq.com for a free API key.
            </p>
          </div>
        </div>

        <div className="card">
          <h3 className="row" style={{ gap: 8 }}>
            <Sparkles size={16} color="#4ADE80" /> AI behaviour — chat like a human
          </h3>
          <div className="col">
            <label className="switch">
              <span className="row" style={{ gap: 7 }}>
                <Bot size={14} /> AI auto-responder (global)
              </span>
              <input type="checkbox" checked={!!s.ai_active} onChange={(e) => set('ai_active', e.target.checked)} />
              <span />
            </label>

            <label className="switch">
              <span className="row" style={{ gap: 7 }}>
                <Mic size={14} /> Reply with voice notes
              </span>
              <input type="checkbox" checked={!!s.ai_voice_enabled} onChange={(e) => set('ai_voice_enabled', e.target.checked)} />
              <span />
            </label>

            <label className="lbl">Voice for voice notes</label>
            <select className="inp" value={s.tts_voice} onChange={(e) => set('tts_voice', e.target.value)}>
              {VOICES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>

            <label className="lbl">Reply delay (seconds) — simulates human typing</label>
            <input
              className="inp"
              type="number"
              min={0}
              max={30}
              value={s.auto_reply_delay}
              onChange={(e) => set('auto_reply_delay', Number(e.target.value))}
            />

            <label className="lbl">Personality / instructions</label>
            <textarea
              className="inp"
              rows={5}
              value={s.ai_persona}
              onChange={(e) => set('ai_persona', e.target.value)}
            />
          </div>
        </div>

        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h3 className="row" style={{ gap: 8 }}>
            <BookOpen size={16} color="#4ADE80" /> Company knowledge base
          </h3>
          <p className="muted tiny" style={{ marginTop: -6 }}>
            Lets AI answer real questions about {company?.name} — products, prices, shipping, FAQs.
          </p>
          <div className="col">
            <input className="inp" placeholder="Title e.g. Pricing, Products, Shipping" value={kTitle} onChange={(e) => setKTitle(e.target.value)} />
            <textarea
              className="inp"
              rows={4}
              placeholder="Everything the AI should know, e.g. 'Pro plan costs 199/month, includes 3 seats, annual gets 20% off. We ship within 24h…'"
              value={kContent}
              onChange={(e) => setKContent(e.target.value)}
            />
            <div>
              <button className="btn btn-primary" onClick={addKnowledge}>
                <Plus size={15} /> Add to knowledge base
              </button>
            </div>
            <div className="col">
              {knowledge.map((k) => (
                <div key={k.id} className="knowledge-row">
                  <div style={{ minWidth: 0 }}>
                    <strong>{k.title}</strong>
                    <div className="muted tiny">{k.content.slice(0, 140)}…</div>
                  </div>
                  <button className="btn btn-sm btn-icon btn-danger" title="Delete" onClick={() => delKnowledge(k.id)}>
                    <Trash2 />
                  </button>
                </div>
              ))}
              {knowledge.length === 0 && (
                <div className="muted tiny">
                  Empty. Add your products, prices, FAQs — the AI will use them when answering.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
