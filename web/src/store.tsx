import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import { api, getToken, login as apiLogin, clearToken } from './api'

export interface User {
  id: number
  name: string
  email: string
  role: string
  companyId: number | null
}

interface AppState {
  user: User | null
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  selectedCompany: number | null
  setSelectedCompany: (id: number | null) => void
}

const AppContext = createContext<AppState>(null as any)

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [selectedCompany, setSelectedCompany] = useState<number | null>(null)

  useEffect(() => {
    if (!getToken()) {
      setReady(true)
      return
    }
    api('/api/me')
      .then((d: any) => {
        const u = d.user
        setUser({ id: u.id, name: u.name, email: u.email, role: u.role, companyId: u.company_id })
        setSelectedCompany(u.company_id)
      })
      .catch(() => clearToken())
      .finally(() => setReady(true))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const u = await apiLogin(email, password)
    setUser({ id: u.id, name: u.name, email: u.email, role: u.role, companyId: u.companyId })
    setSelectedCompany(u.companyId)
  }, [])

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
  }, [])

  const companyId = selectedCompany ?? user?.companyId ?? null

  return (
    <AppContext.Provider value={{ user, ready, login, logout, selectedCompany: companyId, setSelectedCompany }}>
      <RealtimeProvider companyId={companyId}>{children}</RealtimeProvider>
    </AppContext.Provider>
  )
}

export function useApp() {
  return useContext(AppContext)
}

// ---------------- realtime ----------------

interface RealtimeCtx {
  call: (path: string, method?: string, body?: any) => Promise<any>
  on: (event: string, fn: (payload: any) => void) => () => void
  wsConnected: boolean
}

const RealtimeContext = createContext<RealtimeCtx>(null as any)

function matchPattern(pattern: string, event: string): boolean {
  if (pattern === event) return true
  if (!pattern.includes('*')) return false
  const re = new RegExp(
    pattern
      .split('*')
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^:]*')
  )
  return re.test(event)
}

function RealtimeProvider({ companyId, children }: { companyId: number | null; children: ReactNode }) {
  const [wsConnected, setWsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const handlersRef = useRef(new Map<string, Set<(payload: any) => void>>())
  const reconnect = useRef(0)

  useEffect(() => {
    const token = getToken()
    if (!token) return
    let ws: WebSocket | null = null
    let closed = false

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      // relative host: works both in dev (5173, proxied to API) and prod (served from API)
      ws = new WebSocket(`${proto}://${location.host}/ws?token=${token}`)
      ws.onopen = () => {
        setWsConnected(true)
        reconnect.current = 0
      }
      ws.onmessage = (ev) => {
        let msg: { event: string; payload: any }
        try {
          msg = JSON.parse(ev.data)
        } catch {
          return
        }
        for (const [pattern, set] of handlersRef.current) {
          if (matchPattern(pattern, msg.event)) for (const fn of set) fn(msg.payload)
        }
      }
      ws.onclose = () => {
        setWsConnected(false)
        if (!closed) {
          const delay = Math.min(1000 * 2 ** reconnect.current, 15000)
          reconnect.current += 1
          setTimeout(() => {
            if (!closed) connect()
          }, delay)
        }
      }
      ws.onerror = () => ws?.close()
    }
    connect()
    return () => {
      closed = true
      ws?.close()
    }
  }, [])

  const on = useCallback((event: string, fn: (payload: any) => void) => {
    let set = handlersRef.current.get(event)
    if (!set) {
      set = new Set()
      handlersRef.current.set(event, set)
    }
    set.add(fn)
    return () => set!.delete(fn)
  }, [])

  const call = useCallback(
    async (path: string, method = 'GET', body?: any) => {
      // always attach the active company scope so superadmins and agents both work
      const cq = companyId ? (path.includes('?') ? '&companyId=' + companyId : '?companyId=' + companyId) : ''
      return api(path + cq, { method, body: body ? JSON.stringify(body) : undefined })
    },
    [companyId]
  )

  return (
    <RealtimeContext.Provider value={{ call, on, wsConnected }}>{children}</RealtimeContext.Provider>
  )
}

export function useApi() {
  return useContext(RealtimeContext)
}