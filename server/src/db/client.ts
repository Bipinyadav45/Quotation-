import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { migrate } from './migrate.js'

let db: Database.Database | null = null

/**
 * Opens the SQLite file (creating the directory if needed), applies any pending
 * migrations, and returns the connection. Safe to call repeatedly.
 *
 * WAL mode lets readers run while a write is in flight, which is what makes a
 * single file fine for the whole purchase desk.
 *
 * `foreign_keys` is set explicitly even though better-sqlite3 already turns it
 * on — SQLite's own default is OFF, so the line is what keeps ON DELETE CASCADE
 * working if the driver is ever swapped, and it states the dependency out loud.
 * See db/cascade.test.ts.
 */
export function getDb(): Database.Database {
  if (db) return db

  mkdirSync(path.dirname(config.dbPath), { recursive: true })

  db = new Database(config.dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  // Wait rather than immediately throwing SQLITE_BUSY if another write is in flight.
  db.pragma('busy_timeout = 5000')

  const applied = migrate(db)
  if (applied.length > 0) {
    console.log(`[db] applied ${applied.length} migration(s): ${applied.join(', ')}`)
  }

  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}
