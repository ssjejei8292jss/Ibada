-- Ибада — база бота (Cloudflare D1)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,          -- Telegram ID пользователя
  chat INTEGER,                    -- чат с ботом
  name TEXT,
  created INTEGER,
  tz TEXT,                         -- часовой пояс города
  remind TEXT,                     -- настройки напоминаний из приложения (JSON)
  sched TEXT,                      -- расписание намазов на ближайшие дни (JSON)
  blocked INTEGER DEFAULT 0        -- пользователь остановил бота
);
CREATE TABLE IF NOT EXISTS days (uid INTEGER, k TEXT, f TEXT, am INTEGER, ae INTEGER, sl INTEGER, u INTEGER, PRIMARY KEY (uid, k));
CREATE TABLE IF NOT EXISTS cards (uid INTEGER, k TEXT, p TEXT, msg INTEGER, state TEXT, PRIMARY KEY (uid, k, p));
CREATE TABLE IF NOT EXISTS sent (uid INTEGER, key TEXT, t INTEGER, PRIMARY KEY (uid, key));
CREATE INDEX IF NOT EXISTS users_active ON users (blocked);
