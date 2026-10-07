import {
  authenticateUser,
  cleanupSessions,
  clearSessionCookie,
  createSession,
  deleteSession,
  getCurrentUser,
  registerUser,
  sessionCookie
} from "./auth.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { getAllGameStatuses } from "./hoyo.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers }
  });
}

function apiError(message, status = 400, kind = "request") {
  return json({ ok: false, error: { kind, message } }, status);
}

function assertSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw Object.assign(new Error("Cross-origin request rejected"), { status: 403 });
  }
}

async function readJson(request) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    throw Object.assign(new Error("JSON形式で送信してください。"), { status: 415 });
  }
  try {
    return await request.json();
  } catch {
    throw Object.assign(new Error("JSONを読み取れませんでした。"), { status: 400 });
  }
}

function cleanUid(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d{6,12}$/.test(text)) {
    throw Object.assign(new Error("UIDは6〜12桁の数字で入力してください。"), { status: 400 });
  }
  return text;
}

function validDiscordWebhook(value) {
  return /^https:\/\/(?:canary\.|ptb\.)?(?:discord(?:app)?\.com)\/api\/webhooks\//i.test(value);
}

async function requireUser(env, request) {
  const user = await getCurrentUser(env, request);
  if (!user) throw Object.assign(new Error("ログインしてください。"), { status: 401 });
  return user;
}

async function getSettingsRow(env, userId) {
  return env.DB.prepare("SELECT * FROM user_settings WHERE user_id = ?").bind(userId).first();
}

async function getCredentials(env, userId) {
  const row = await getSettingsRow(env, userId);
  if (!row?.hoyo_ltoken_enc || !row?.hoyo_ltuid_enc) {
    return {
      configured: false,
      cookie: null,
      hsrUid: row?.hsr_uid || null,
      genshinUid: row?.genshin_uid || null,
      zzzUid: row?.zzz_uid || null,
      discordEnabled: Boolean(row?.discord_enabled),
      discordWebhook: null
    };
  }
  const [ltoken, ltuid, webhook] = await Promise.all([
    decryptSecret(row.hoyo_ltoken_enc, env.MASTER_KEY),
    decryptSecret(row.hoyo_ltuid_enc, env.MASTER_KEY),
    row.discord_webhook_enc ? decryptSecret(row.discord_webhook_enc, env.MASTER_KEY) : Promise.resolve(null)
  ]);
  return {
    configured: true,
    cookie: { ltokenV2: ltoken, ltuidV2: Number(ltuid) },
    hsrUid: row.hsr_uid || null,
    genshinUid: row.genshin_uid || null,
    zzzUid: row.zzz_uid || null,
    discordEnabled: Boolean(row.discord_enabled),
    discordWebhook: webhook
  };
}

async function handleRegister(request, env) {
  assertSameOrigin(request);
  const body = await readJson(request);
  if (env.REGISTRATION_CODE && body.inviteCode !== env.REGISTRATION_CODE) {
    return apiError("招待コードが違います。", 403, "invite");
  }
  const user = await registerUser(env, body.email, body.password);
  const session = await createSession(env, user.id);
  return json(
    { ok: true, user },
    201,
    { "set-cookie": sessionCookie(session.id) }
  );
}

async function handleLogin(request, env) {
  assertSameOrigin(request);
  const body = await readJson(request);
  const user = await authenticateUser(env, body.email, body.password);
  if (!user) return apiError("メールアドレスまたはパスワードが違います。", 401, "auth");
  const session = await createSession(env, user.id);
  return json({ ok: true, user }, 200, { "set-cookie": sessionCookie(session.id) });
}

async function handleLogout(request, env) {
  assertSameOrigin(request);
  await deleteSession(env, request);
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
}

async function handleMe(request, env) {
  const user = await getCurrentUser(env, request);
  return json({
    ok: true,
    authenticated: Boolean(user),
    user,
    inviteRequired: Boolean(env.REGISTRATION_CODE)
  });
}

async function handleGetSettings(request, env) {
  const user = await requireUser(env, request);
  const row = await getSettingsRow(env, user.id);
  return json({
    ok: true,
    settings: {
      hoyoConfigured: Boolean(row?.hoyo_ltoken_enc && row?.hoyo_ltuid_enc),
      hsrUid: row?.hsr_uid || "",
      genshinUid: row?.genshin_uid || "",
      zzzUid: row?.zzz_uid || "",
      discordConfigured: Boolean(row?.discord_webhook_enc),
      discordEnabled: row ? Boolean(row.discord_enabled) : true,
      updatedAt: row?.updated_at || null
    }
  });
}

async function handleSaveSettings(request, env) {
  assertSameOrigin(request);
  const user = await requireUser(env, request);
  const body = await readJson(request);
  const current = await getSettingsRow(env, user.id);

  let ltokenEnc = current?.hoyo_ltoken_enc || null;
  let ltuidEnc = current?.hoyo_ltuid_enc || null;
  let webhookEnc = current?.discord_webhook_enc || null;

  if (body.clearHoyo === true) {
    ltokenEnc = null;
    ltuidEnc = null;
  } else {
    const hasToken = String(body.hoyoLtokenV2 || "").trim() !== "";
    const hasUid = String(body.hoyoLtuidV2 || "").trim() !== "";
    if (hasToken !== hasUid) {
      throw Object.assign(new Error("ltoken_v2 と ltuid_v2 は両方入力してください。"), { status: 400 });
    }
    if (hasToken && hasUid) {
      if (!/^\d+$/.test(String(body.hoyoLtuidV2).trim())) {
        throw Object.assign(new Error("ltuid_v2 は数字で入力してください。"), { status: 400 });
      }
      [ltokenEnc, ltuidEnc] = await Promise.all([
        encryptSecret(String(body.hoyoLtokenV2).trim(), env.MASTER_KEY),
        encryptSecret(String(body.hoyoLtuidV2).trim(), env.MASTER_KEY)
      ]);
    }
  }

  if (body.clearDiscord === true) {
    webhookEnc = null;
  } else if (String(body.discordWebhookUrl || "").trim()) {
    const webhook = String(body.discordWebhookUrl).trim();
    if (!validDiscordWebhook(webhook)) {
      throw Object.assign(new Error("Discord Webhook URLを確認してください。"), { status: 400 });
    }
    webhookEnc = await encryptSecret(webhook, env.MASTER_KEY);
  }

  const hsrUid = cleanUid(body.hsrUid);
  const genshinUid = cleanUid(body.genshinUid);
  const zzzUid = cleanUid(body.zzzUid);
  const discordEnabled = body.discordEnabled === false ? 0 : 1;
  const updatedAt = new Date().toISOString();

  await env.DB.prepare(
    "INSERT INTO user_settings (user_id, hoyo_ltoken_enc, hoyo_ltuid_enc, hsr_uid, genshin_uid, zzz_uid, discord_webhook_enc, discord_enabled, updated_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(user_id) DO UPDATE SET " +
    "hoyo_ltoken_enc = excluded.hoyo_ltoken_enc, hoyo_ltuid_enc = excluded.hoyo_ltuid_enc, " +
    "hsr_uid = excluded.hsr_uid, genshin_uid = excluded.genshin_uid, zzz_uid = excluded.zzz_uid, " +
    "discord_webhook_enc = excluded.discord_webhook_enc, discord_enabled = excluded.discord_enabled, updated_at = excluded.updated_at"
  )
    .bind(
      user.id,
      ltokenEnc,
      ltuidEnc,
      hsrUid,
      genshinUid,
      zzzUid,
      webhookEnc,
      discordEnabled,
      updatedAt
    )
    .run();

  return json({ ok: true });
}

async function handleStatus(request, env) {
  const user = await requireUser(env, request);
  const credentials = await getCredentials(env, user.id);
  if (!credentials.configured) {
    const fallback = await getAllGameStatuses({
      cookie: { ltokenV2: "", ltuidV2: 0 },
      hsrUid: null,
      genshinUid: null,
      zzzUid: null
    });
    fallback.games = fallback.games.map((game) => ({
      ...game,
      uid:
        game.id === "hsr"
          ? credentials.hsrUid
          : game.id === "genshin"
            ? credentials.genshinUid
            : credentials.zzzUid,
      configured: Boolean(
        game.id === "hsr"
          ? credentials.hsrUid
          : game.id === "genshin"
            ? credentials.genshinUid
            : credentials.zzzUid
      ),
      error: credentials.hsrUid || credentials.genshinUid || credentials.zzzUid
        ? { kind: "config", message: "HoYoLAB認証を設定してください。" }
        : null
    }));
    return json({
      ok: true,
      hoyoConfigured: false,
      fetchedAt: new Date().toISOString(),
      ...fallback
    });
  }
  const result = await getAllGameStatuses(credentials);
  return json({ ok: true, hoyoConfigured: true, fetchedAt: new Date().toISOString(), ...result });
}

async function sendDiscord(webhook, content) {
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "HoYo Daily Checker",
      content,
      allowed_mentions: { parse: [] }
    })
  });
  if (!response.ok) throw new Error("Discord Webhook error: " + response.status);
}

async function handleDiscordTest(request, env) {
  assertSameOrigin(request);
  const user = await requireUser(env, request);
  const credentials = await getCredentials(env, user.id);
  if (!credentials.discordWebhook) return apiError("Discord Webhookが設定されていません。", 400, "discord");
  await sendDiscord(
    credentials.discordWebhook,
    "✅ **HoYo Daily Status**\nDiscord通知のテストに成功しました。"
  );
  return json({ ok: true });
}

function gameLine(game) {
  if (game.error) return "⚠️ **" + game.name + "**: 取得失敗";
  if (game.daily.completed === true) return "✅ **" + game.name + "**: " + game.daily.label + " 完了";
  if (game.daily.completed === false) {
    const progress =
      game.daily.current != null && game.daily.max != null
        ? " (" + game.daily.current + "/" + game.daily.max + ")"
        : "";
    return "❌ **" + game.name + "**: " + game.daily.label + " 未完了" + progress;
  }
  return "❔ **" + game.name + "**: デイリー判定不可";
}

function jstDateString(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function notifyOneUser(env, row) {
  let credentials;
  try {
    const [ltoken, ltuid, webhook] = await Promise.all([
      decryptSecret(row.hoyo_ltoken_enc, env.MASTER_KEY),
      decryptSecret(row.hoyo_ltuid_enc, env.MASTER_KEY),
      decryptSecret(row.discord_webhook_enc, env.MASTER_KEY)
    ]);
    credentials = {
      configured: true,
      cookie: { ltokenV2: ltoken, ltuidV2: Number(ltuid) },
      hsrUid: row.hsr_uid || null,
      genshinUid: row.genshin_uid || null,
      zzzUid: row.zzz_uid || null,
      discordWebhook: webhook
    };
  } catch (error) {
    console.error("Failed to decrypt settings for user", row.user_id, error);
    return;
  }

  const { games } = await getAllGameStatuses(credentials);
  const configuredGames = games.filter((game) => game.configured);
  const incomplete = configuredGames.filter((game) => game.daily.completed === false);
  if (incomplete.length === 0) return;

  const dateJst = jstDateString();
  const alreadySent = await env.DB.prepare(
    "SELECT id FROM notification_logs WHERE user_id = ? AND date_jst = ?"
  )
    .bind(row.user_id, dateJst)
    .first();
  if (alreadySent) return;

  const content =
    "🌙 **21時のHoYoデイリーチェック**\n" +
    "まだ終わっていないデイリーがあります。\n\n" +
    configuredGames.map(gameLine).join("\n") +
    "\n\n忘れる前に回収しておこう。";

  await sendDiscord(credentials.discordWebhook, content);
  await env.DB.prepare(
    "INSERT INTO notification_logs (user_id, date_jst, sent_at, summary) VALUES (?, ?, ?, ?)"
  )
    .bind(row.user_id, dateJst, new Date().toISOString(), incomplete.map((game) => game.id).join(","))
    .run();
}

async function runDailyNotifications(env) {
  const rows = await env.DB.prepare(
    "SELECT user_id, hoyo_ltoken_enc, hoyo_ltuid_enc, hsr_uid, genshin_uid, zzz_uid, discord_webhook_enc " +
    "FROM user_settings WHERE discord_enabled = 1 AND discord_webhook_enc IS NOT NULL " +
    "AND hoyo_ltoken_enc IS NOT NULL AND hoyo_ltuid_enc IS NOT NULL"
  ).all();

  const users = rows.results || [];
  const batchSize = 5;
  for (let index = 0; index < users.length; index += batchSize) {
    const batch = users.slice(index, index + batchSize);
    await Promise.allSettled(batch.map((row) => notifyOneUser(env, row)));
  }
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === "GET" && path === "/api/me") return handleMe(request, env);
  if (method === "POST" && path === "/api/auth/register") return handleRegister(request, env);
  if (method === "POST" && path === "/api/auth/login") return handleLogin(request, env);
  if (method === "POST" && path === "/api/auth/logout") return handleLogout(request, env);
  if (method === "GET" && path === "/api/settings") return handleGetSettings(request, env);
  if (method === "PUT" && path === "/api/settings") return handleSaveSettings(request, env);
  if (method === "GET" && path === "/api/status") return handleStatus(request, env);
  if (method === "POST" && path === "/api/discord/test") return handleDiscordTest(request, env);
  if (method === "GET" && path === "/api/health") {
    return json({ ok: true, service: "hoyo-daily-status", time: new Date().toISOString() });
  }
  return apiError("APIが見つかりません。", 404, "not_found");
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return apiError(error?.message || "サーバーエラーが発生しました。", error?.status || 500, "server");
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      Promise.allSettled([cleanupSessions(env), runDailyNotifications(env)])
    );
  }
};
