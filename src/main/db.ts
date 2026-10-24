import { DatabaseSync } from 'node:sqlite'

export type Db = DatabaseSync

/**
 * Миграции схемы профиля. Индекс в массиве + 1 = версия (PRAGMA user_version).
 * Новые миграции только дописываются в конец.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE profile (
    id                 INTEGER PRIMARY KEY CHECK (id = 1),
    name               TEXT NOT NULL,
    pilot_name         TEXT NOT NULL,
    mode               TEXT NOT NULL CHECK (mode IN ('pilot', 'owner')),
    owner_start        TEXT CHECK (owner_start IN ('new', 'existing')),
    world_start_utc    TEXT NOT NULL,
    last_simulated_utc TEXT NOT NULL,
    created_at         TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE flights (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    source         TEXT NOT NULL,
    status         TEXT NOT NULL,
    departure      TEXT,
    arrival        TEXT,
    aircraft_title TEXT NOT NULL,
    aircraft_type  TEXT,
    block_off_at   INTEGER,
    takeoff_at     INTEGER,
    landing_at     INTEGER,
    block_on_at    INTEGER,
    distance_km    REAL NOT NULL,
    fuel_used_kg   REAL NOT NULL,
    max_alt_ft     REAL NOT NULL,
    landing_json   TEXT,
    score          INTEGER NOT NULL,
    events_json    TEXT NOT NULL,
    track_json     TEXT NOT NULL,
    delay_code     TEXT,
    created_at     TEXT NOT NULL
  );
  CREATE INDEX flights_created ON flights (created_at);
  `,
  `
  CREATE TABLE pilot (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    rank          TEXT NOT NULL,
    employer_kind TEXT,
    employer_id   TEXT,
    base          TEXT,
    location      TEXT,
    cash          REAL NOT NULL,
    reputation    REAL NOT NULL,
    hired_at      TEXT
  );
  CREATE TABLE ratings (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    obtained_at TEXT NOT NULL
  );
  CREATE TABLE bookings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    kind         TEXT NOT NULL,
    flight_no    TEXT NOT NULL,
    callsign     TEXT NOT NULL,
    operator     TEXT NOT NULL,
    dep          TEXT NOT NULL,
    arr          TEXT NOT NULL,
    dep_at       INTEGER NOT NULL,
    arr_at       INTEGER NOT NULL,
    type_id      TEXT NOT NULL,
    pax          INTEGER NOT NULL,
    cargo_kg     INTEGER NOT NULL,
    distance_km  INTEGER NOT NULL,
    block_min    INTEGER NOT NULL,
    status       TEXT NOT NULL,
    flight_id    INTEGER REFERENCES flights (id),
    delay_min    INTEGER,
    delay_code   TEXT,
    pay          REAL,
    charter_json TEXT,
    created_at   TEXT NOT NULL
  );
  CREATE TABLE transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    t           INTEGER NOT NULL,
    amount      REAL NOT NULL,
    description TEXT NOT NULL
  );
  CREATE TABLE people (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    kind         TEXT NOT NULL,
    name         TEXT NOT NULL,
    title        TEXT NOT NULL,
    country      TEXT NOT NULL,
    position_key TEXT,
    relationship INTEGER NOT NULL DEFAULT 0,
    flights      INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX people_position ON people (country, position_key) WHERE position_key IS NOT NULL;
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  ALTER TABLE flights ADD COLUMN booking_id INTEGER REFERENCES bookings (id);
  `,
  `
  CREATE TABLE world (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE macro_daily (
    day       INTEGER PRIMARY KEY,
    brent     REAL NOT NULL,
    jet_usd_kg REAL NOT NULL,
    cpi       REAL NOT NULL,
    cycle     TEXT NOT NULL,
    demand    REAL NOT NULL
  );
  CREATE TABLE news (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    t        INTEGER NOT NULL,
    category TEXT NOT NULL,
    title    TEXT NOT NULL,
    body     TEXT NOT NULL
  );
  CREATE INDEX news_t ON news (t);
  `,
  `
  ALTER TABLE profile ADD COLUMN partner INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE profile ADD COLUMN children INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE pilot ADD COLUMN fatigue REAL NOT NULL DEFAULT 0;
  ALTER TABLE pilot ADD COLUMN health REAL NOT NULL DEFAULT 90;
  ALTER TABLE pilot ADD COLUMN satisfaction REAL NOT NULL DEFAULT 55;
  ALTER TABLE pilot ADD COLUMN medical_until INTEGER;
  CREATE TABLE assets (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    kind           TEXT NOT NULL,
    item_id        TEXT NOT NULL,
    name           TEXT NOT NULL,
    ownership      TEXT NOT NULL,
    country        TEXT NOT NULL,
    airport        TEXT,
    value          REAL NOT NULL,
    purchase_price REAL NOT NULL,
    residence      INTEGER NOT NULL DEFAULT 0,
    rented_out     INTEGER NOT NULL DEFAULT 0,
    bought_at      INTEGER NOT NULL
  );
  CREATE TABLE loans (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL,
    asset_id    INTEGER REFERENCES assets (id),
    principal   REAL NOT NULL,
    balance     REAL NOT NULL,
    rate        REAL NOT NULL,
    payment     REAL NOT NULL,
    months_left INTEGER NOT NULL,
    overdue     INTEGER NOT NULL DEFAULT 0,
    opened_at   INTEGER NOT NULL
  );
  CREATE TABLE investments (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    kind      TEXT NOT NULL,
    principal REAL NOT NULL,
    value     REAL NOT NULL,
    rate      REAL NOT NULL,
    opened_at INTEGER NOT NULL
  );
  CREATE TABLE subscriptions (
    id         TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL
  );
  CREATE TABLE education (
    id          TEXT PRIMARY KEY,
    obtained_at INTEGER NOT NULL
  );
  `,
  `
  CREATE TABLE airline_state (
    icao TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE airline_monthly (
    icao        TEXT NOT NULL,
    month       INTEGER NOT NULL,
    revenue     REAL NOT NULL,
    profit      REAL NOT NULL,
    lf          REAL NOT NULL,
    share_price REAL NOT NULL,
    cash        REAL NOT NULL,
    PRIMARY KEY (icao, month)
  );
  ALTER TABLE investments ADD COLUMN icao TEXT;
  ALTER TABLE investments ADD COLUMN quantity REAL;
  `,
  `ALTER TABLE bookings ADD COLUMN avg_fare REAL;`,
  // Налёт, добавленный в режиме читера.
  `ALTER TABLE pilot ADD COLUMN bonus_hours REAL NOT NULL DEFAULT 0;`,
  // Режим владельца: доли игрока в авиакомпаниях (своя компания — доля с founded = 1).
  `
  CREATE TABLE stakes (
    icao        TEXT PRIMARY KEY,
    pct         REAL NOT NULL,
    cost        REAL NOT NULL,
    dividends   REAL NOT NULL DEFAULT 0,
    founded     INTEGER NOT NULL DEFAULT 0,
    guaranteed  INTEGER NOT NULL DEFAULT 0,
    acquired_at INTEGER NOT NULL
  );
  `,
  // Авиакомпании, основанные игроком: статичная часть (живое состояние — в airline_state).
  `
  CREATE TABLE player_airline (
    icao       TEXT PRIMARY KEY,
    iata       TEXT NOT NULL,
    name       TEXT NOT NULL,
    callsign   TEXT NOT NULL,
    country    TEXT NOT NULL,
    archetype  TEXT NOT NULL,
    hub        TEXT NOT NULL,
    logo       TEXT,
    founded_at INTEGER NOT NULL
  );
  `,
  // Фото пилота для личного кабинета (data URL).
  `ALTER TABLE profile ADD COLUMN photo TEXT;`,
  // Перемотка времени: часы мира = реальное время + сдвиг (src/main/worldTime.ts).
  `ALTER TABLE profile ADD COLUMN clock_offset_ms INTEGER NOT NULL DEFAULT 0;`
]

export function openDatabase(file: string): Db {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  migrate(db)
  return db
}

/** Транзакция; вложенный вызов выполняется внутри уже открытой (атомарность — у внешней). */
export function transaction<T>(db: Db, fn: () => T): T {
  // isTransaction есть в node:sqlite начиная с Node 22.16 (в Electron — Node 24), но не в @types/node 22.10.
  if ((db as Db & { isTransaction: boolean }).isTransaction) return fn()
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

function migrate(db: Db): void {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let v = current; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v])
      db.exec(`PRAGMA user_version = ${v + 1}`)
    })
  }
}
