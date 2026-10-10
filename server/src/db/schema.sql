CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent', -- superadmin | admin | agent
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS phone_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | connecting | connected | disconnected | disabled
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  jid TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, jid),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  session_id INTEGER,
  contact_id INTEGER NOT NULL,
  assigned_to INTEGER,
  ai_enabled INTEGER NOT NULL DEFAULT 1,
  unread INTEGER NOT NULL DEFAULT 0,
  last_message TEXT,
  last_message_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES phone_sessions(id) ON DELETE SET NULL,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  session_id INTEGER,
  direction TEXT NOT NULL, -- in | out
  type TEXT NOT NULL DEFAULT 'text',
  body TEXT,
  media_url TEXT,
  sender TEXT,
  is_ai INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS company_settings (
  company_id INTEGER PRIMARY KEY,
  ai_provider TEXT NOT NULL DEFAULT 'ollama',
  ai_base_url TEXT NOT NULL DEFAULT 'http://localhost:11434/v1',
  ai_model TEXT NOT NULL DEFAULT 'llama3.2',
  ai_api_key TEXT NOT NULL DEFAULT '',
  ai_persona TEXT NOT NULL DEFAULT 'You are a friendly, professional sales assistant for {company}. Be warm, concise and helpful. Never claim to be a bot unless asked, and never invent facts.',
  ai_voice_enabled INTEGER NOT NULL DEFAULT 1,
  tts_voice TEXT NOT NULL DEFAULT 'en-US-JennyNeural',
  ai_active INTEGER NOT NULL DEFAULT 1,
  ai_auto_send_audio INTEGER NOT NULL DEFAULT 0,
  auto_reply_delay INTEGER NOT NULL DEFAULT 3,
  language TEXT NOT NULL DEFAULT 'en',
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  session_id INTEGER,
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  contact_ids TEXT NOT NULL DEFAULT '[]',
  personalize INTEGER NOT NULL DEFAULT 0,
  as_voice INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | running | done | failed
  total INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scheduled_followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  contact_jid TEXT NOT NULL,
  session_id INTEGER,
  message TEXT NOT NULL,
  run_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | cancelled
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_chats_company ON chats(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);