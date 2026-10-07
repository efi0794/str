import { hashPassword, randomToken, verifyPassword } from "./crypto.js";

const SESSION_COOKIE = "hoyo_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const result = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}

export function sessionCookie(value, maxAge = SESSION_SECONDS) {
  return [
    SESSION_COOKIE + "=" + encodeURIComponent(value),
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=" + maxAge
  ].join("; ");
}

export function clearSessionCookie() {
  return sessionCookie("", 0);
}

export async function registerUser(env, email, password) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw Object.assign(new Error("メールアドレスを確認してください。"), { status: 400 });
  }
  if (String(password || "").length < 10) {
    throw Object.assign(new Error("パスワードは10文字以上にしてください。"), { status: 400 });
  }

  const id = crypto.randomUUID();
  const { hash, salt } = await hashPassword(password);
  try {
    await env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(id, normalizedEmail, hash, salt, new Date().toISOString())
      .run();
  } catch (error) {
    if (/unique/i.test(String(error?.message))) {
      throw Object.assign(new Error("このメールアドレスはすでに登録されています。"), { status: 409 });
    }
    throw error;
  }
  return { id, email: normalizedEmail };
}

export async function authenticateUser(env, email, password) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const user = await env.DB.prepare(
    "SELECT id, email, password_hash, password_salt FROM users WHERE email = ?"
  )
    .bind(normalizedEmail)
    .first();
  if (!user) return null;
  const ok = await verifyPassword(password, user.password_salt, user.password_hash);
  return ok ? { id: user.id, email: user.email } : null;
}

export async function createSession(env, userId) {
  const id = randomToken(32);
  const expiresAt = nowSeconds() + SESSION_SECONDS;
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
  )
    .bind(id, userId, expiresAt, new Date().toISOString())
    .run();
  return { id, expiresAt };
}

export async function deleteSession(env, request) {
  const id = parseCookies(request)[SESSION_COOKIE];
  if (id) await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
}

export async function getCurrentUser(env, request) {
  const id = parseCookies(request)[SESSION_COOKIE];
  if (!id) return null;
  const row = await env.DB.prepare(
    "SELECT users.id, users.email, sessions.expires_at " +
    "FROM sessions JOIN users ON users.id = sessions.user_id " +
    "WHERE sessions.id = ?"
  )
    .bind(id)
    .first();
  if (!row) return null;
  if (Number(row.expires_at) <= nowSeconds()) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
    return null;
  }
  return { id: row.id, email: row.email };
}

export async function cleanupSessions(env) {
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(nowSeconds()).run();
}
