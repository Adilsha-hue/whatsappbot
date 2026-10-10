import { useState } from 'react'
import { useApp } from '../store'
import { Mail, Lock, MessageSquareText, Loader2, ArrowRight, ShieldCheck, Zap, Mic } from 'lucide-react'

export default function Login() {
  const { login } = useApp()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <span className="brand-logo">
            <MessageSquareText />
          </span>
          <div>
            <div className="login-logo">DealDeploy</div>
            <p className="login-sub">WhatsApp CRM that sells while you sleep</p>
          </div>
        </div>
        <form onSubmit={submit}>
          <div className="login-input">
            <Mail />
            <input
              className="inp"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              autoComplete="email"
            />
          </div>
          <div className="login-input">
            <Lock />
            <input
              className="inp"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          {error && <div className="err">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={loading}>
            {loading ? (
              <>
                <Loader2 size={16} className="spin" /> Signing in…
              </>
            ) : (
              <>
                Sign in <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>
        <div className="login-hint">
          <div className="row" style={{ gap: 14 }}>
            <span className="row" style={{ gap: 5 }}>
              <Zap size={13} /> AI replies 24/7
            </span>
            <span className="row" style={{ gap: 5 }}>
              <Mic size={13} /> Voice notes
            </span>
            <span className="row" style={{ gap: 5 }}>
              <ShieldCheck size={13} /> Free &amp; private
            </span>
          </div>
          <div style={{ marginTop: 8 }}>
            Demo: <code>admin@company.com</code> / <code>admin123</code>
          </div>
        </div>
      </div>
    </div>
  )
}
