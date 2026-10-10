import { EdgeTTS } from 'node-edge-tts'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { config } from '../config.js'

// voice example: en-US-JennyNeural, hi-IN-SwaraNeural, etc.
export async function textToSpeech(text: string, voice: string): Promise<{ audio: Buffer; format: string }> {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (config.ttsProvider === 'elevenlabs') {
    return elevenLabsSpeech(trimmed, voice)
  }

  const tmp = path.join(os.tmpdir(), `wcrm_tts_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`)
  const tts = new EdgeTTS({ voice, lang: 'en-US', outputFormat: 'audio-24khz-48kbitrate-mono-mp3' })
  try {
    await tts.ttsPromise(trimmed, tmp)
    const audio = await fs.promises.readFile(tmp)
    return { audio, format: 'audio/mpeg' }
  } finally {
    fs.promises.unlink(tmp).catch(() => {})
  }
}

async function elevenLabsSpeech(text: string, voice: string): Promise<{ audio: Buffer; format: string }> {
  if (!config.elevenLabsApiKey) {
    throw new Error('ELEVENLABS_API_KEY is required when TTS_PROVIDER=elevenlabs')
  }

  const voiceId = config.elevenLabsVoiceId || voice
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: {
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': config.elevenLabsApiKey,
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`ElevenLabs TTS failed (${response.status})${detail ? `: ${detail}` : ''}`)
  }

  return { audio: Buffer.from(await response.arrayBuffer()), format: 'audio/mpeg' }
}
