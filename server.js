import express from "express";
import dotenv from "dotenv";
import cron from "node-cron";
import { GenshinImpact, HonkaiStarRail, ZenlessZoneZero, LanguageEnum } from "node-hoyolab";

dotenv.config();
const app = express();
const port = Number(process.env.PORT || 3000);
app.use(express.static("public"));

const cookie = () => ({
  ltokenV2: process.env.HOYO_LTOKEN_V2 || "",
  ltuidV2: Number(process.env.HOYO_LTUID_V2 || 0)
});
const hasAuth = () => Boolean(process.env.HOYO_LTOKEN_V2 && process.env.HOYO_LTUID_V2);
const toNumber = (v, fallback = null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const normalizeError = (error) => {
  const message = error?.message || "HoYoLAB API request failed";
  const code = error?.code ?? error?.retcode ?? null;
  const auth = /login|cookie|token|auth|expired|10001/i.test(message) || code === 10001 || code === -100;
  return {
    kind: auth ? "auth" : "api",
    message: auth ? "HoYoLABの認証情報が無効、または期限切れの可能性があります。" : message,
    detail: message
  };
};
async function safeCheckIn(client) {
  try {
    const info = await client.daily.info();
    return {
      available: true,
      signedToday: info?.is_sign ?? info?.is_signed ?? info?.signed ?? null,
      totalSignDays: info?.total_sign_day ?? info?.total_signed ?? null
    };
  } catch {
    return { available: false, signedToday: null, totalSignDays: null };
  }
}
function commonResult({ id, name, uid, configured, accent }) {
  return {
    id,name,uid:uid || null,configured,accent,authenticated:false,
    daily:{label:"デイリー",current:null,max:null,completed:null,detail:"判定できません"},
    resource:{label:"リソース",current:null,max:null,recoverySeconds:null},
    extras:[],checkIn:null,error:null
  };
}
async function getHsrStatus() {
  const uid = process.env.HSR_UID;
  const out = commonResult({id:"hsr",name:"崩壊：スターレイル",uid,configured:Boolean(uid),accent:"blue"});
  if (!uid) return out;
  try {
    const client = new HonkaiStarRail({cookie:cookie(),uid:Number(uid),lang:LanguageEnum.JAPANESE});
    const [note,checkIn] = await Promise.all([client.record.note(),safeCheckIn(client)]);
    out.authenticated = true; out.checkIn = checkIn;
    const current = note?.current_train_score ?? note?.current_training_score ?? note?.daily_training?.current ?? note?.training?.current ?? null;
    const max = note?.max_train_score ?? note?.max_training_score ?? note?.daily_training?.max ?? note?.training?.max ?? (current !== null ? 500 : null);
    out.daily = {
      label:"デイリー訓練",
      current:toNumber(current),
      max:toNumber(max),
      completed:current !== null && max !== null ? Number(current) >= Number(max) : null,
      detail:current !== null && max !== null ? "訓練スコア" : "HoYoLABの現在の応答では訓練スコアを取得できません"
    };
    out.resource = {label:"開拓力",current:toNumber(note?.current_stamina,0),max:toNumber(note?.max_stamina,300),recoverySeconds:toNumber(note?.stamina_recover_time,0)};
    const expeditions = Array.isArray(note?.expeditions) ? note.expeditions : [];
    const finished = expeditions.filter(x=>/finish|complete/i.test(String(x?.status))).length;
    out.extras = [{label:"派遣",value:expeditions.length ? finished+" / "+expeditions.length+" 完了" : "0件"}];
  } catch (error) { out.error = normalizeError(error); }
  return out;
}
async function getGenshinStatus() {
  const uid = process.env.GENSHIN_UID;
  const out = commonResult({id:"genshin",name:"原神",uid,configured:Boolean(uid),accent:"gold"});
  if (!uid) return out;
  try {
    const client = new GenshinImpact({cookie:cookie(),uid:Number(uid),lang:LanguageEnum.JAPANESE});
    const [note,checkIn] = await Promise.all([client.record.dailyNote(),safeCheckIn(client)]);
    out.authenticated = true; out.checkIn = checkIn;
    const current = toNumber(note?.finished_task_num,0);
    const max = toNumber(note?.total_task_num,4);
    const tasksDone = current >= max;
    const rewardReceived = Boolean(note?.is_extra_task_reward_received);
    out.daily = {
      label:"デイリー依頼",current,max,completed:tasksDone && rewardReceived,
      detail:tasksDone ? (rewardReceived ? "4件完了・追加報酬受取済み" : "依頼完了、追加報酬が未受取") : current+" / "+max+" 件完了"
    };
    out.resource = {label:"天然樹脂",current:toNumber(note?.current_resin,0),max:toNumber(note?.max_resin,200),recoverySeconds:toNumber(note?.resin_recovery_time,0)};
    const expeditions = Array.isArray(note?.expeditions) ? note.expeditions : [];
    const finished = expeditions.filter(x=>/finish|complete/i.test(String(x?.status))).length;
    out.extras = [
      {label:"探索派遣",value:expeditions.length ? finished+" / "+expeditions.length+" 完了" : "0件"},
      {label:"洞天宝銭",value:note?.current_home_coin != null ? note.current_home_coin+" / "+note.max_home_coin : "取得不可"}
    ];
  } catch (error) { out.error = normalizeError(error); }
  return out;
}
async function getZzzStatus() {
  const uid = process.env.ZZZ_UID;
  const out = commonResult({id:"zzz",name:"ゼンレスゾーンゼロ",uid,configured:Boolean(uid),accent:"lime"});
  if (!uid) return out;
  try {
    const client = new ZenlessZoneZero({cookie:cookie(),uid:Number(uid),lang:LanguageEnum.JAPANESE});
    const [note,checkIn] = await Promise.all([client.record.note(),safeCheckIn(client)]);
    out.authenticated = true; out.checkIn = checkIn;
    const vitalityCurrent = toNumber(note?.vitality?.current);
    const vitalityMax = toNumber(note?.vitality?.max);
    out.daily = {
      label:"活躍度",current:vitalityCurrent,max:vitalityMax,
      completed:vitalityCurrent !== null && vitalityMax !== null ? vitalityCurrent >= vitalityMax : null,
      detail:vitalityCurrent !== null && vitalityMax !== null ? "HoYoLAB活躍度" : "現在の応答では活躍度を取得できません"
    };
    out.resource = {label:"バッテリー",current:toNumber(note?.energy?.progress?.current,0),max:toNumber(note?.energy?.progress?.max,240),recoverySeconds:toNumber(note?.energy?.restore,0)};
    out.extras = [
      {label:"スクラッチ",value:note?.card_sign ? String(note.card_sign) : "取得不可"},
      {label:"ビデオ屋",value:note?.vhs_sale?.sale_state ? String(note.vhs_sale.sale_state) : "取得不可"}
    ];
  } catch (error) { out.error = normalizeError(error); }
  return out;
}
async function getAllStatuses() {
  if (!hasAuth()) return {
    ok:false,configured:false,fetchedAt:new Date().toISOString(),games:[],
    error:{kind:"config",message:".env に HOYO_LTOKEN_V2 / HOYO_LTUID_V2 を設定してください。"}
  };
  const games = await Promise.all([getHsrStatus(),getGenshinStatus(),getZzzStatus()]);
  const configuredGames = games.filter(g=>g.configured);
  return {
    ok:true,configured:true,fetchedAt:new Date().toISOString(),games,
    summary:{
      configured:configuredGames.length,
      completed:configuredGames.filter(g=>g.daily.completed===true).length,
      incomplete:configuredGames.filter(g=>g.daily.completed===false).length,
      unknown:configuredGames.filter(g=>!g.error && g.daily.completed===null).length,
      errors:configuredGames.filter(g=>Boolean(g.error)).length
    },
    notification:{enabled:Boolean(process.env.DISCORD_WEBHOOK_URL),schedule:"毎日 21:00",timezone:"Asia/Tokyo"}
  };
}
function gameLine(game) {
  if (game.error) return "⚠️ **"+game.name+"**: 取得失敗";
  if (game.daily.completed === true) return "✅ **"+game.name+"**: "+game.daily.label+" 完了";
  if (game.daily.completed === false) {
    const progress = game.daily.current != null && game.daily.max != null ? " ("+game.daily.current+"/"+game.daily.max+")" : "";
    return "❌ **"+game.name+"**: "+game.daily.label+" 未完了"+progress;
  }
  return "❔ **"+game.name+"**: デイリー判定不可";
}
async function sendDiscordReminder() {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) { console.log("[Discord] webhook未設定のため通知をスキップ"); return; }
  const status = await getAllStatuses();
  if (!status.ok) { console.warn("[Discord] HoYoLAB設定不足のため通知をスキップ"); return; }
  const configured = status.games.filter(g=>g.configured);
  const incomplete = configured.filter(g=>g.daily.completed===false);
  if (incomplete.length === 0) { console.log("[Discord] 明確な未完了デイリーなし。通知しません"); return; }
  const content = "🌙 **21時のHoYoデイリーチェック**\nまだ終わっていないデイリーがあります。\n\n"+configured.map(gameLine).join("\n")+"\n\n忘れる前に回収しておこう。";
  const response = await fetch(webhook,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({username:"HoYo Daily Checker",content,allowed_mentions:{parse:[]}})
  });
  if (!response.ok) throw new Error("Discord webhook failed: "+response.status);
  console.log("[Discord] 21時の未完了通知を送信しました");
}
cron.schedule("0 21 * * *",()=>{sendDiscordReminder().catch(error=>console.error("[Discord]",error.message));},{timezone:"Asia/Tokyo"});

app.get("/api/status",async(_req,res)=>{const status=await getAllStatuses();res.status(status.ok?200:503).json(status);});
app.get("/api/health",(_req,res)=>res.json({
  ok:true,authConfigured:hasAuth(),
  games:{hsr:Boolean(process.env.HSR_UID),genshin:Boolean(process.env.GENSHIN_UID),zzz:Boolean(process.env.ZZZ_UID)},
  discord:Boolean(process.env.DISCORD_WEBHOOK_URL),discordSchedule:"21:00 Asia/Tokyo"
}));
app.listen(port,()=>{console.log("HoYo Daily Status: http://localhost:"+port);console.log("Discord reminder: "+(process.env.DISCORD_WEBHOOK_URL?"ON":"OFF")+" / 21:00 Asia/Tokyo");});
