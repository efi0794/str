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

const GAME_NAMES = {
  hsr: "スターレイル",
  genshin: "原神",
  zzz: "ゼンゼロ"
};

function formatJst(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  }).format(date);
}

function jstInputNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

function sourceLabel(source) {
  return source === "MANUAL" ? "手動" : "推定";
}

function sourceClass(source) {
  return source === "MANUAL" ? "manual" : "estimated";
}

async function loadStaminaAnalytics() {
  if (!state.me) return;
  const game = $("staminaGameFilter").value || "all";
  const days = $("staminaDaysFilter").value || "30";
  $("staminaMessage").textContent = "履歴を読み込み中…";
  try {
    const data = await api("/api/stamina/analytics?game=" + encodeURIComponent(game) + "&days=" + encodeURIComponent(days));

    const totals = { MANUAL: { count: 0, amount: 0 }, ESTIMATED: { count: 0, amount: 0 } };
    for (const row of data.summary || []) {
      if (!totals[row.source]) continue;
      totals[row.source] = { count: Number(row.event_count) || 0, amount: Number(row.total_amount) || 0 };
    }
    $("staminaSummary").innerHTML =
      '<div class="analytics-kpi"><span>手動記録</span><b>' + totals.MANUAL.count + '回</b><small>合計 ' + totals.MANUAL.amount + '</small></div>' +
      '<div class="analytics-kpi"><span>自動推定</span><b>' + totals.ESTIMATED.count + '回</b><small>合計 ' + totals.ESTIMATED.amount + '</small></div>' +
      '<div class="analytics-kpi"><span>期間</span><b>' + escapeHtml(days) + '日</b><small>' + (game === "all" ? "全ゲーム" : escapeHtml(GAME_NAMES[game] || game)) + '</small></div>';

    const hourMap = Array.from({ length: 24 }, (_, hour) => ({ hour, MANUAL: 0, ESTIMATED: 0 }));
    for (const row of data.hours || []) {
      const hour = Number(row.hour_jst);
      if (hour >= 0 && hour < 24 && hourMap[hour] && hourMap[hour][row.source] != null) {
        hourMap[hour][row.source] += Number(row.total_amount) || 0;
      }
    }
    const hourMax = Math.max(1, ...hourMap.map((x) => x.MANUAL + x.ESTIMATED));
    $("staminaHours").innerHTML = hourMap.map((item) => {
      const manualHeight = Math.round(item.MANUAL / hourMax * 100);
      const estimatedHeight = Math.round(item.ESTIMATED / hourMax * 100);
      const title = item.hour + "時: 手動 " + item.MANUAL + " / 推定 " + item.ESTIMATED;
      return '<div class="hour-col" title="' + escapeHtml(title) + '">' +
        '<div class="hour-bars"><i class="manual" style="height:' + manualHeight + '%"></i><i class="estimated" style="height:' + estimatedHeight + '%"></i></div>' +
        '<small>' + item.hour + '</small></div>';
    }).join("");

    const dayMap = new Map();
    for (const row of data.daily || []) {
      if (!dayMap.has(row.day_jst)) dayMap.set(row.day_jst, { MANUAL: 0, ESTIMATED: 0 });
      const item = dayMap.get(row.day_jst);
      if (item[row.source] != null) item[row.source] += Number(row.total_amount) || 0;
    }
    const dayRows = [...dayMap.entries()].slice(0, Number(days) === 7 ? 7 : 14);
    const dayMax = Math.max(1, ...dayRows.map(([, item]) => item.MANUAL + item.ESTIMATED));
    $("staminaDaily").innerHTML = dayRows.length
      ? dayRows.map(([day, item]) => {
          const total = item.MANUAL + item.ESTIMATED;
          return '<div class="daily-row"><span>' + escapeHtml(day.slice(5)) + '</span>' +
            '<div class="daily-track"><i class="manual" style="width:' + (item.MANUAL / dayMax * 100) + '%"></i>' +
            '<i class="estimated" style="width:' + (item.ESTIMATED / dayMax * 100) + '%"></i></div>' +
            '<b>' + total + '</b></div>';
        }).join("")
      : '<p class="empty-history">まだ履歴がありません。</p>';

    $("staminaHistory").innerHTML = (data.history || []).length
      ? data.history.map((row) =>
          '<tr><td>' + escapeHtml(formatJst(row.used_at)) + '</td>' +
          '<td>' + escapeHtml(row.gameName || GAME_NAMES[row.game_code] || row.game_code) + '</td>' +
          '<td>' + escapeHtml(row.amount) + '</td>' +
          '<td><span class="source-badge ' + sourceClass(row.source) + '">' + sourceLabel(row.source) + '</span></td>' +
          '<td>' + escapeHtml(row.note || "") + '</td>' +
          '<td><button type="button" class="delete-history" data-id="' + escapeHtml(row.id) + '">削除</button></td></tr>'
        ).join("")
      : '<tr><td colspan="6" class="empty-history">使用履歴はまだありません。</td></tr>';

    $("staminaResourceHistory").innerHTML = (data.resourceHistory || []).length
      ? data.resourceHistory.map((row) =>
          '<tr><td>' + escapeHtml(formatJst(row.observed_at)) + '</td>' +
          '<td>' + escapeHtml(row.gameName || GAME_NAMES[row.game_code] || row.game_code) + '</td>' +
          '<td>' + escapeHtml(row.current_amount) + ' / ' + escapeHtml(row.max_amount) + '</td></tr>'
        ).join("")
      : '<tr><td colspan="3" class="empty-history">観測履歴はまだありません。</td></tr>';

    $("staminaMessage").textContent = "表示中: " + (game === "all" ? "全ゲーム" : (GAME_NAMES[game] || game)) + " / 直近" + days + "日";
  } catch (error) {
    if (error.status === 401) return setLoggedOutView();
    $("staminaMessage").textContent = "統計を読み込めません: " + error.message;
  }
}

async function submitStaminaUse(event) {
  event.preventDefault();
  const localValue = $("staminaUsedAt").value;
  if (!localValue) return;
  $("staminaMessage").textContent = "履歴を保存中…";
  try {
    const usedAt = new Date(localValue + ":00+09:00").toISOString();
    await api("/api/stamina/use", {
      method: "POST",
      body: JSON.stringify({
        gameCode: $("staminaUseGame").value,
        usedAt,
        amount: Number($("staminaAmount").value),
        note: $("staminaNote").value
      })
    });
    $("staminaAmount").value = "";
    $("staminaNote").value = "";
    $("staminaMessage").textContent = "使用履歴を保存しました。";
    await loadStaminaAnalytics();
  } catch (error) {
    $("staminaMessage").textContent = error.message;
  }
}

async function deleteStaminaUse(id) {
  if (!confirm("この使用履歴を削除しますか？")) return;
  try {
    await api("/api/stamina/use/" + encodeURIComponent(id), { method: "DELETE" });
    await loadStaminaAnalytics();
  } catch (error) {
    $("staminaMessage").textContent = error.message;
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
    await loadStaminaAnalytics();
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
    await loadStaminaAnalytics();
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
    await loadStaminaAnalytics();
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

$("staminaRefreshBtn").addEventListener("click", loadStaminaAnalytics);
$("staminaGameFilter").addEventListener("change", loadStaminaAnalytics);
$("staminaDaysFilter").addEventListener("change", loadStaminaAnalytics);
$("staminaUseForm").addEventListener("submit", submitStaminaUse);
$("staminaHistory").addEventListener("click", (event) => {
  const button = event.target.closest(".delete-history");
  if (button) deleteStaminaUse(button.dataset.id);
});
$("staminaUsedAt").value = jstInputNow();

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
