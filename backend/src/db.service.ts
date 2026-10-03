import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/*
  SQLite through Node's built-in driver so the API runs with no database server.
  Same tables as the PostgreSQL design; swap this service for pg / TypeORM in production.
*/
@Injectable()
export class DbService implements OnModuleDestroy {
  readonly db: DatabaseSync;

  constructor() {
    const file = process.env.DB_FILE ?? "data/reliefhub.db";
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS raw_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        external_id TEXT NOT NULL,
        url TEXT,
        payload TEXT NOT NULL,          -- original JSON / text, kept for audit
        fetched_at TEXT NOT NULL,
        UNIQUE (source, external_id)
      );
      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        hazard TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        districts TEXT NOT NULL,        -- JSON array
        issued_at TEXT NOT NULL,        -- ISO
        people_affected INTEGER,
        url TEXT,
        status TEXT NOT NULL DEFAULT 'New',
        status_by TEXT,
        status_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS alert_sources (
        alert_id TEXT NOT NULL REFERENCES alerts(id),
        raw_item_id INTEGER NOT NULL REFERENCES raw_items(id),
        source TEXT NOT NULL,
        PRIMARY KEY (alert_id, raw_item_id)
      );
    `);
  }

  onModuleDestroy() {
    this.db.close();
  }
}
