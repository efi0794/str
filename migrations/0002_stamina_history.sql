PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS stamina_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  game_code TEXT NOT NULL CHECK (game_code IN ('hsr', 'genshin', 'zzz')),
  current_amount INTEGER NOT NULL CHECK (current_amount >= 0),
  max_amount INTEGER NOT NULL CHECK (max_amount > 0),
  observed_at TEXT NOT NULL,
  observed_bucket TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_id, game_code, observed_bucket)
);

CREATE INDEX IF NOT EXISTS idx_stamina_snapshots_user_game_time
  ON stamina_snapshots(user_id, game_code, observed_at DESC);

CREATE TABLE IF NOT EXISTS stamina_use_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  game_code TEXT NOT NULL CHECK (game_code IN ('hsr', 'genshin', 'zzz')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  used_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('MANUAL', 'ESTIMATED')),
  note TEXT,
  snapshot_id INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (snapshot_id) REFERENCES stamina_snapshots(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_stamina_use_logs_user_time
  ON stamina_use_logs(user_id, used_at DESC);

CREATE INDEX IF NOT EXISTS idx_stamina_use_logs_user_game_time
  ON stamina_use_logs(user_id, game_code, used_at DESC);
