import { WebSocketServer, WebSocket } from 'ws'
import * as http from 'node:http'
import { bus } from './bus.js'

export function startRealtime(httpServer: http.Server) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/', 'http://localhost')
    let client: { userId?: number; companyId?: number; role?: string } | null = null
    const token = url.searchParams.get('token')
    if (token) {
      try {
        const parts = token.split('.')
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
          if (payload.userId) {
            client = {
              userId: payload.userId,
              companyId: payload.companyId || undefined,
              role: payload.role || 'agent',
            }
          }
        }
      } catch {}
    }
    if (!client) {
      ws.close(4001, 'unauthorized')
      return
    }

    ws.send(JSON.stringify({ event: 'auth', payload: { ok: true, user: client } }))

    const unsub = bus.subscribe(({ event, payload }) => {
      if (ws.readyState !== WebSocket.OPEN) return
      const p = (payload || {}) as Record<string, unknown>
      const targetCompany = p.companyId ?? p.company_id ?? (p.session && (p.session as any).company_id)
      // superadmin sees whole-platform events; agents only see their own company
      if (client.companyId && targetCompany && Number(targetCompany) !== client.companyId) return
      ws.send(JSON.stringify({ event, payload }))
    })

    ws.on('close', () => unsub())
  })

  console.log('[ws] realtime listening on /ws')
}