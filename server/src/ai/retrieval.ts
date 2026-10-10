import { db } from '../db/index.js'

export interface KnowledgeEntry {
  id: number
  title: string
  content: string
}

function tokenize(text: string): string[] {
  return (text || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2)
}

// Lightweight, dependency-free retrieval over the company knowledge base.
// Scores every entry by how many query tokens appear in it and returns the best matches.
export function retrieveKnowledge(companyId: number, query: string, topN = 3): string[] {
  const entries = db
    .prepare('SELECT id, title, content FROM knowledge WHERE company_id = ?')
    .all(companyId) as unknown as KnowledgeEntry[]

  if (!entries.length) return []

  const queryTokens = tokenize(query)
  if (!queryTokens.length) return []

  const scored = entries.map((e) => {
    const haystack = `${e.title}\n${e.content}`.toLowerCase()
    let score = 0
    for (const t of queryTokens) {
      if (haystack.includes(t)) score += 1
    }
    return { entry: e, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored
    .filter((s) => s.score > 0)
    .slice(0, topN)
    .map((s) => `${s.entry.title}\n${s.entry.content}`)
}