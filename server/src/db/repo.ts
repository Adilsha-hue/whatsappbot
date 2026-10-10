import { db } from './index.js'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = createHash('sha256').update(salt + password).digest('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = createHash('sha256').update(salt + password).digest('hex')
  const a = Buffer.from(candidate)
  const b = Buffer.from(hash)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function seedSuperAdmin() {
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(config.adminEmail)
  if (!exists) {
    db.prepare(
      `INSERT INTO users (company_id, name, email, password_hash, role) VALUES (NULL, ?, ?, ?, 'superadmin')`
    ).run('Super Admin', config.adminEmail, hashPassword(config.adminPassword))
    console.log(`[db] seeded super admin: ${config.adminEmail} / ${config.adminPassword}`)
  }
}

export function createCompany(name: string): { id: number } {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `c${Date.now()}`
  const result = db.prepare('INSERT INTO companies (name, slug) VALUES (?, ?)').run(name, slug)
  const id = Number(result.lastInsertRowid)
  db.prepare('INSERT INTO company_settings (company_id) VALUES (?)').run(id)
  return { id }
}

export function createUser(opts: { companyId: number | null; name: string; email: string; password: string; role: string }) {
  const result = db.prepare(
    'INSERT INTO users (company_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)'
  ).run(opts.companyId, opts.name, opts.email, hashPassword(opts.password), opts.role)
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(result.lastInsertRowid))
}