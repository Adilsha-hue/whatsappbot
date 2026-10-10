const TOKEN_KEY = 'wcrm_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers as Record<string, string> | undefined) }
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(path, { ...options, headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}

export const q = (obj: Record<string, any>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v))
  const str = s.toString()
  return str ? `?${str}` : ''
}

export async function login(email: string, password: string) {
  const res = await api<{ token: string; user: any }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  setToken(res.token)
  return res.user
}