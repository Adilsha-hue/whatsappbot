import OpenAI from 'openai'

export interface LlmSettings {
  provider: string // ollama | groq | openai | none
  baseUrl: string
  model: string
  apiKey: string
}

export async function generateReply(
  settings: LlmSettings,
  systemPrompt: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  temperature = 0.7
): Promise<string | null> {
  if (!settings.provider || settings.provider === 'none' || !settings.model) return null

  let client: OpenAI
  try {
    client = new OpenAI({
      baseURL: settings.baseUrl || undefined,
      apiKey: settings.apiKey || 'ollama',
    })
  } catch {
    return null
  }

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...history.map((m) => ({ role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const), content: m.content })),
  ]

  try {
    const res = await client.chat.completions.create({
      model: settings.model,
      messages,
      temperature,
      max_tokens: 300,
    })
    const text = res.choices?.[0]?.message?.content?.trim() ?? ''
    return text || null
  } catch (err) {
    console.error('[ai] LLM error:', (err as Error).message)
    return null
  }
}