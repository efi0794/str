const GAME_CODES = new Set(["hsr", "genshin", "zzz"]);
const GAME_NAMES = {
  hsr: "崩壊：スターレイル",
  genshin: "原神",
  zzz: "ゼンレスゾーンゼロ"
};

function validResource(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 999999;
}

export function cleanGameCode(value, allowAll = false) {
  const code = String(value ?? "").trim().toLowerCase();
  if (allowAll && (code === "" || code === "all")) return "all";
  if (!GAME_CODES.has(code)) {
    throw Object.assign(new Error("ゲーム指定が不正です。"), { status: 400 });
  }
  return code;
}

export function cleanDays(value) {
  const days = Number(value ?? 30);
  if (![7, 30, 90, 365].includes(days)) {
    throw Object.assign(new Error("集計期間は7・30・90・365日から選んでください。"), { status: 400 });
  }
  return days;
}

export function cleanManualUse(body) {
  const gameCode = cleanGameCode(body?.gameCode);
  const amount = Number(body?.amount);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 999999) {
    throw Object.assign(new Error("消費量は1〜999999の整数で入力してください。"), { status: 400 });
  }

  const note = String(body?.note ?? "").trim();
  if (note.length > 200) {
    throw Object.assign(new Error("メモは200文字以内にしてください。"), { status: 400 });
  }

  const usedMs = Date.parse(String(body?.usedAt ?? ""));
  const now = Date.now();
  if (!Number.isFinite(usedMs)) {
    throw Object.assign(new Error("使用日時を正しく入力してください。"), { status: 400 });
  }
  if (usedMs > now + 5 * 60 * 1000) {
    throw Object.assign(new Error("未来の時刻は指定できません。"), { status: 400 });
  }
  if (usedMs < now - 5 * 365 * 24 * 60 * 60 * 1000) {
    throw Object.assign(new Error("5年以上前の時刻は指定できません。"), { status: 400 });
  }

  return {
    gameCode,
    amount,
    note: note || null,
    usedAt: new Date(usedMs).toISOString()
  };
}

export async function saveResourceObservations(env, userId, games, fetchedAt = new Date().toISOString()) {
  const observedMs = Date.parse(fetchedAt);
  if (!Number.isFinite(observedMs)) return { snapshots: 0, estimated: 0, skipped: 0 };

  const observedAt = new Date(observedMs).toISOString();
  const observedBucket = observedAt.slice(0, 16);
  let snapshots = 0;
  let estimated = 0;
  let skipped = 0;

  for (const game of Array.isArray(games) ? games : []) {
    if (!GAME_CODES.has(game?.id) || !game?.configured || !game?.authenticated || game?.error) {
      continue;
    }

    const current = Number(game?.resource?.current);
    const maximum = Number(game?.resource?.max);
    if (!validResource(current) || !validResource(maximum) || maximum < 1 || current > maximum) {
      skipped++;
      continue;
    }

    const previous = await env.DB.prepare(
      "SELECT id, current_amount, max_amount, observed_at " +
      "FROM stamina_snapshots WHERE user_id = ? AND game_code = ? " +
      "ORDER BY observed_at DESC, id DESC LIMIT 1"
    ).bind(userId, game.id).first();

    if (previous && Date.parse(previous.observed_at) >= observedMs) {
      skipped++;
      continue;
    }

    const inserted = await env.DB.prepare(
      "INSERT OR IGNORE INTO stamina_snapshots " +
      "(user_id, game_code, current_amount, max_amount, observed_at, observed_bucket) " +
      "VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(userId, game.id, current, maximum, observedAt, observedBucket).run();

    if (!inserted?.meta?.changes) {
      skipped++;
      continue;
    }
    snapshots++;

    const snapshot = await env.DB.prepare(
      "SELECT id FROM stamina_snapshots WHERE user_id = ? AND game_code = ? AND observed_bucket = ?"
    ).bind(userId, game.id, observedBucket).first();

    if (
      previous &&
      Number(previous.max_amount) === maximum &&
      Number(previous.current_amount) > current
    ) {
      const amount = Number(previous.current_amount) - current;
      await env.DB.prepare(
        "INSERT INTO stamina_use_logs " +
        "(user_id, game_code, amount, used_at, source, note, snapshot_id, created_at) " +
        "VALUES (?, ?, ?, ?, 'ESTIMATED', ?, ?, ?)"
      ).bind(
        userId,
        game.id,
        amount,
        observedAt,
        "HoYoLAB残量の減少を検知（実際の使用時刻・消費量とは限りません）",
        snapshot?.id ?? null,
        new Date().toISOString()
      ).run();
      estimated++;
    }
  }

  return { snapshots, estimated, skipped };
}

export async function getStaminaAnalytics(env, userId, gameCode, days) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const gameWhere = gameCode === "all" ? "" : " AND game_code = ?";
  const commonBinds = gameCode === "all" ? [userId, since] : [userId, since, gameCode];

  const [summary, hours, daily, history, resources] = await Promise.all([
    env.DB.prepare(
      "SELECT source, COUNT(*) AS event_count, COALESCE(SUM(amount), 0) AS total_amount " +
      "FROM stamina_use_logs WHERE user_id = ? AND used_at >= ?" + gameWhere +
      " GROUP BY source ORDER BY source"
    ).bind(...commonBinds).all(),
    env.DB.prepare(
      "SELECT CAST(strftime('%H', datetime(used_at, '+9 hours')) AS INTEGER) AS hour_jst, " +
      "source, COUNT(*) AS event_count, SUM(amount) AS total_amount " +
      "FROM stamina_use_logs WHERE user_id = ? AND used_at >= ?" + gameWhere +
      " GROUP BY hour_jst, source ORDER BY hour_jst, source"
    ).bind(...commonBinds).all(),
    env.DB.prepare(
      "SELECT date(datetime(used_at, '+9 hours')) AS day_jst, source, " +
      "COUNT(*) AS event_count, SUM(amount) AS total_amount " +
      "FROM stamina_use_logs WHERE user_id = ? AND used_at >= ?" + gameWhere +
      " GROUP BY day_jst, source ORDER BY day_jst DESC, source"
    ).bind(...commonBinds).all(),
    env.DB.prepare(
      "SELECT id, game_code, amount, source, note, used_at " +
      "FROM stamina_use_logs WHERE user_id = ? AND used_at >= ?" + gameWhere +
      " ORDER BY used_at DESC, id DESC LIMIT 100"
    ).bind(...commonBinds).all(),
    env.DB.prepare(
      "SELECT id, game_code, current_amount, max_amount, observed_at " +
      "FROM stamina_snapshots WHERE user_id = ? AND observed_at >= ?" + gameWhere +
      " ORDER BY observed_at DESC, id DESC LIMIT 100"
    ).bind(...commonBinds).all()
  ]);

  const mapGame = (row) => ({ ...row, gameName: GAME_NAMES[row.game_code] || row.game_code });
  return {
    filters: { gameCode, days },
    summary: summary.results || [],
    hours: hours.results || [],
    daily: daily.results || [],
    history: (history.results || []).map(mapGame),
    resourceHistory: (resources.results || []).map(mapGame)
  };
}
