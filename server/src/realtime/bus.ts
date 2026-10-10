import { EventEmitter } from 'node:events'

// A per-process pub/sub used by WhatsApp manager, AI responder and API.
// The WS server subscribes and forwards events to connected clients.
type Listener = (msg: { event: string; payload: unknown }) => void

class RealtimeBus {
  private bus = new EventEmitter()
  private listeners = new Set<Listener>()

  constructor() {
    this.bus.setMaxListeners(0)
  }

  subscribe(l: Listener) {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  emit(event: string, payload: unknown) {
    this.bus.emit(event, payload)
    for (const l of this.listeners) l({ event, payload })
  }

  // server-side handlers (e.g. session open triggers AI)
  on(event: string, fn: (payload: any) => void) {
    this.bus.on(event, fn)
    return () => this.bus.off(event, fn)
  }
}

export const bus = new RealtimeBus()