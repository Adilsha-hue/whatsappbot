import { useCallback, useEffect, useState } from 'react'
import { useApi } from '../store'
import { Smartphone, Plus, RefreshCw, Unplug, QrCode, CheckCircle2, HelpCircle } from 'lucide-react'

export default function Sessions() {
  const { call, on } = useApi()
  const [sessions, setSessions] = useState<any[]>([])
  const [qr, setQr] = useState<Record<number, string>>({})
  const [name, setName] = useState('')

  const load = useCallback(() => {
    call('/api/company/sessions').then((rows: any[]) => {
      setSessions(rows)
      rows.forEach((s) => {
        if ((s.status === 'pending' || s.status === 'connecting') && s.status !== 'connected') pollQr(s.id)
      })
    }).catch(() => {})
  }, [call])

  useEffect(() => {
    load()
    const offs = [
      on('session:*:qr', (p: any) => {
        if (p?.qr) setQr((q) => ({ ...q, [p.sessionId]: p.qr }))
      }),
      on('session:*:status', () => load()),
    ]
    return () => offs.forEach((f) => f())
  }, [load, on])

  const pollQr = useCallback(async (id: number) => {
    const d = await call(`/api/company/sessions/${id}/qr`).catch(() => null)
    if (d) {
      setQr((q) => ({ ...q, [id]: d.qr || q[id] || '' }))
      if (d.qr) setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'connecting' } : s)))
    }
  }, [call])

  const add = async () => {
    if (!name) return
    const { id } = await call('/api/company/sessions', 'POST', { name })
    setName('')
    load()
    setTimeout(() => pollQr(id), 500)
  }

  const statusLabel = (s: any) => (s.status === 'connected' ? 'Connected' : s.status === 'connecting' ? 'Waiting to scan…' : s.status)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>WhatsApp numbers</h1>
          <p className="muted">Pair a private WhatsApp number — no API fees, AI answers 24/7.</p>
        </div>
        <div className="row">
          <input
            className="inp"
            placeholder="Label e.g. Sales hotline"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button className="btn btn-primary" onClick={add}>
            <Plus size={15} /> Connect a number
          </button>
        </div>
      </div>

      <div className="dash-cards">
        {sessions.map((s) => (
          <div key={s.id} className="card">
            <div className="company-row">
              <strong className="row" style={{ gap: 8 }}>
                <Smartphone size={16} color="#4ADE80" /> {s.name}
              </strong>
              <span className={'pill ' + (s.status === 'connected' ? 'pill-green' : 'pill-amber')}>{statusLabel(s)}</span>
            </div>

            {s.status === 'connected' ? (
              <div className="qr-connected">
                <CheckCircle2 /> Number is live — AI auto-responder active 24/7.
              </div>
            ) : qr[s.id] ? (
              <div className="qr-wrap">
                <img src={qr[s.id]} alt="Scan with WhatsApp" style={{ width: 200, height: 200 }} />
                <p className="muted tiny" style={{ margin: 0 }}>
                  Open WhatsApp on the phone → Settings → Linked devices → Link a device, and scan this code.
                </p>
              </div>
            ) : (
              <div className="qr-empty">
                <p>
                  <QrCode size={18} style={{ display: 'block', margin: '0 auto 8px', opacity: 0.6 }} />
                  No QR yet.
                </p>
                <button className="btn btn-sm" onClick={() => pollQr(s.id)}>
                  Get QR code
                </button>
              </div>
            )}

            <div className="row" style={{ marginTop: 10 }}>
              {s.status !== 'connected' && (
                <button className="btn btn-sm" onClick={() => pollQr(s.id)}>
                  <RefreshCw size={13} /> Refresh QR
                </button>
              )}
              <button
                className="btn btn-sm"
                onClick={async () => {
                  await call(`/api/company/sessions/${s.id}/reconnect`, 'POST')
                  load()
                }}
              >
                Reconnect
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={async () => {
                  if (!confirm('Disconnect this number?')) return
                  await call(`/api/company/sessions/${s.id}/disconnect`, 'POST')
                  load()
                }}
              >
                <Unplug size={13} /> Disconnect
              </button>
            </div>
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="card empty">
            <Smartphone size={24} style={{ margin: '0 auto 10px', display: 'block', opacity: 0.5 }} />
            No WhatsApp numbers linked yet.
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="row" style={{ gap: 8 }}>
          <HelpCircle size={16} color="#4ADE80" /> How to pair
        </h3>
        <ol className="muted" style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <li>This runs on a <strong>free, private WhatsApp account</strong> (your own or a spare number — no API fees).</li>
          <li>Add a number above, then scan the QR from WhatsApp → Linked devices.</li>
          <li>Once connected, every incoming message is answered by AI within seconds — text and voice notes.</li>
        </ol>
      </div>
    </div>
  )
}
