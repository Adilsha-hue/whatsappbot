import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

export const config = {
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  dataDir: process.env.DATA_DIR || path.join(root, 'data'),
  adminEmail: process.env.ADMIN_EMAIL || 'admin@company.com',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  // default AI provider settings (per-company can override)
  defaultAiProvider: process.env.AI_PROVIDER || 'ollama', // ollama | groq | openai | none
  defaultAiBaseUrl: process.env.AI_BASE_URL || 'http://localhost:11434/v1',
  defaultAiModel: process.env.AI_MODEL || 'llama3.2',
  defaultAiApiKey: process.env.AI_API_KEY || '',
  defaultTtsVoice: process.env.TTS_VOICE || 'en-US-JennyNeural',
  ttsProvider: process.env.TTS_PROVIDER || 'edge', // edge | elevenlabs
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || '',
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID || '',
}

export const dbPath = path.join(config.dataDir, 'crm.sqlite')
export const sessionsDir = path.join(config.dataDir, 'sessions')
export const mediaDir = path.join(config.dataDir, 'media')
