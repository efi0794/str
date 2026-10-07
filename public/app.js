const $ = (id) => document.getElementById(id);
const state = { me: null, settings: null };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: options.body
      ? { "content-type": "application/json", ...(options.headers || {}) }
      : options.headers
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data?.error?.message || "HTTP " + response.status);
    error.status = response.status;
    throw error;
  }
  return data;
}

function switchAuthTab(name) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  $("loginForm").classList.toggle("hidden", name !== "login");
  $("registerForm").classList.toggle("hidden", name !== "register");
  $("authMessage").textContent = "";
}

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => switchAuthTab(tab.dataset.tab)));

function setAuthedView(user) {
  $("authView").classList.add("hidden");
  $("appView").classList.remove("hidden");
  $("userMenu").classList.remove("hidden");
  $("userEmail").textContent = user.email;
}

function setLoggedOutView() {
  state.me = null;
  $("appView").classList.add("hidden");
  $("userMenu").classList.add("hidden");
  $("authView").classList.remove("hidden");
}

function percent(current, max) {
  const a = Number(current), b = Number(max);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return 0;
  return Math.max(0, Math.min(100, a / b * 100));
}

function verdict(game) {
  if (!game.configured) return ["unknown", "未設定", "設定画面からUIDを登録してください"];
  if (game.error) return ["unknown", "取得エラー", game.error.message];
  if (game.daily.completed === true) return ["done", "完了！", game.daily.detail];
  if (game.daily.completed === false) return ["todo", "まだ残ってる", game.daily.detail];
  return ["unknown", "判定不能", game.daily.detail];
}

function gameCard(game) {
  const [verdictClass, verdictTitle, verdictDetail] = verdict(game);
  const badge = !game.configured
    ? '<span class="badge off">未設定</span>'
    : game.error
      ? '<span class="badge bad">取得失敗</span>'
      : '<span class="badge ok">● 認証OK</span>';
  const dailyValue = game.daily.current != null && game.daily.max != null
    ? escapeHtml(game.daily.current) + " / " + escapeHtml(game.daily.max)
    : "--";
  const resourceValue = game.resource.current != null && game.resource.max != null
    ? escapeHtml(game.resource.current) + " / " + escapeHtml(game.resource.max)
    : "--";
  const checkIn = game.checkIn?.signedToday === true
    ? "受取済み"
    : game.checkIn?.signedToday === false
      ? "未受取"
      : "--";
  const extras = (game.extras || []).map((item) =>
    '<div class="mini"><span>' + escapeHtml(item.label) + '</span><b>' + escapeHtml(item.value) + '</b></div>'
  ).join("");

  return '<article class="game-card ' + escapeHtml(game.accent) + '">' +
    '<div class="game-head"><div><div class="game-code">' + escapeHtml(game.id.toUpperCase()) + '</div><h2>' + escapeHtml(game.name) + '</h2><div class="muted">UID: ' + escapeHtml(game.uid || "未設定") + '</div></div>' + badge + '</div>' +
    '<div class="verdict ' + verdictClass + '"><small>TODAY</small><strong>' + escapeHtml(verdictTitle) + '</strong><div class="detail">' + escapeHtml(verdictDetail) + '</div></div>' +
    '<div class="stat"><div class="stat-row"><span>' + escapeHtml(game.daily.label) + '</span><b>' + dailyValue + '</b></div><div class="bar"><i style="width:' + percent(game.daily.current, game.daily.max) + '%"></i></div></div>' +
    '<div class="stat"><div class="stat-row"><span>' + escapeHtml(game.resource.label) + '</span><b>' + resourceValue + '</b></div><div class="bar"><i style="width:' + percent(game.resource.current, game.resource.max) + '%"></i></div></div>' +
    '<div class="stat"><div class="stat-row"><span>HoYoLABログボ</span><b>' + checkIn + '</b></div></div>' +
    (extras ? '<div class="extras">' + extras + '</div>' : '') +
    '</article>';
}

async function loadDashboard() {
  $("refreshBtn").disabled = true;
  $("games").innerHTML = '<div class="notice">HoYoLABから取得中…</div>';
  try {
    const data = await api("/api/status");
    $("games").innerHTML = data.games.map(gameCard).join("");
    $("summary").innerHTML = [
      ["設定", data.summary.configured], ["完了", data.summary.completed], ["未完了", data.summary.incomplete], ["判定不能", data.summary.unknown], ["取得エラー", data.summary.errors]
    ].map(([label, value]) => '<span class="pill">' + label + '<b>' + value + '</b></span>').join("");
    $("updatedAt").textContent = "最終更新: " + new Date(data.fetchedAt).toLocaleString("ja-JP");
    $("statusMessage").classList.toggle("hidden", data.hoyoConfigured);
    if (!data.hoyoConfigured) {
      $("statusMessage").className = "notice warning";
      $("statusMessage").textContent = "HoYoLAB認証がまだ設定されていません。右上の「設定」から ltoken_v2 / ltuid_v2 を登録してください。";
    }
  } catch (error) {
    if (error.status === 401) return setLoggedOutView();
    $("games").innerHTML = '<div class="notice warning">' + escapeHtml(error.message) + '</div>';
  } finally {
    $("refreshBtn").disabled = false;
  }
}

async function loadSettings() {
  const data = await api("/api/settings");
  state.settings = data.settings;
  $("hsrUid").value = data.settings.hsrUid || "";
  $("genshinUid").value = data.settings.genshinUid || "";
  $("zzzUid").value = data.settings.zzzUid || "";
  $("discordEnabled").checked = data.settings.discordEnabled;
  $("hoyoState").textContent = data.settings.hoyoConfigured ? "✓ HoYoLAB認証は設定済みです" : "未設定です";
  $("discordState").textContent = data.settings.discordConfigured ? "✓ Discord Webhookは設定済みです" : "未設定です";
  $("hoyoLtokenV2").value = "";
  $("hoyoLtuidV2").value = "";
  $("discordWebhookUrl").value = "";
  $("clearHoyo").checked = false;
  $("clearDiscord").checked = false;
}

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  $("authMessage").textContent = "";
  try {
    const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
    state.me = data.user;
    setAuthedView(data.user);
    await Promise.all([loadSettings(), loadDashboard()]);
  } catch (error) { $("authMessage").textContent = error.message; }
});

$("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  $("authMessage").textContent = "";
  try {
    const data = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email: form.get("email"), password: form.get("password"), inviteCode: form.get("inviteCode") }) });
    state.me = data.user;
    setAuthedView(data.user);
    await Promise.all([loadSettings(), loadDashboard()]);
  } catch (error) { $("authMessage").textContent = error.message; }
});

$("logoutBtn").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => null);
  setLoggedOutView();
});

$("refreshBtn").addEventListener("click", loadDashboard);
$("settingsBtn").addEventListener("click", async () => { await loadSettings(); $("settingsDialog").showModal(); });
$("closeSettings").addEventListener("click", () => $("settingsDialog").close());

$("settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("settingsMessage").textContent = "保存中…";
  try {
    await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        hoyoLtokenV2: $("hoyoLtokenV2").value,
        hoyoLtuidV2: $("hoyoLtuidV2").value,
        clearHoyo: $("clearHoyo").checked,
        hsrUid: $("hsrUid").value,
        genshinUid: $("genshinUid").value,
        zzzUid: $("zzzUid").value,
        discordWebhookUrl: $("discordWebhookUrl").value,
        clearDiscord: $("clearDiscord").checked,
        discordEnabled: $("discordEnabled").checked
      })
    });
    $("settingsMessage").textContent = "保存しました。";
    await loadSettings();
    await loadDashboard();
    setTimeout(() => $("settingsDialog").close(), 450);
  } catch (error) { $("settingsMessage").textContent = error.message; }
});

$("testDiscordBtn").addEventListener("click", async () => {
  $("settingsMessage").textContent = "テスト送信中…";
  try {
    await api("/api/discord/test", { method: "POST", body: "{}" });
    $("settingsMessage").textContent = "Discordへテスト通知を送りました。";
  } catch (error) { $("settingsMessage").textContent = error.message; }
});

async function boot() {
  try {
    const data = await api("/api/me");
    if (!data.authenticated) return setLoggedOutView();
    state.me = data.user;
    setAuthedView(data.user);
    await Promise.all([loadSettings(), loadDashboard()]);
  } catch (error) {
    $("authView").classList.remove("hidden");
    $("authMessage").textContent = error.message;
  }
}

boot();
