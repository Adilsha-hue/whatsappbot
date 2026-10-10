import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { config, dbPath } from '../config.js'

fs.mkdirSync(path.dirname(dbPath), { recursive: true })

export const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

import { readFileSync } from 'node:fs'
const schema = readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf-8')
db.exec(schema)

export type Row = Record<string, unknown>