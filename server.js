import express from "express";
import dotenv from "dotenv";
import { HonkaiStarRail, LanguageEnum } from "node-hoyolab";

dotenv.config();
const app = express();
const port = Number(process.env.PORT || 3000);
app.use(express.static("public"));

const configured = () => Boolean(process.env.HOYO_LTOKEN_V2 && process.env.HOYO_LTUID_V2 && process.env.HSR_UID);

function dailyProgress(note) {
  const current = note?.current_train_score ?? note?.current_training_score ?? note?.daily_training?.current ?? null;
  const max = note?.max_train_score ?? note?.max_training_score ?? note?.daily_training?.max ?? (current !== null ? 500 : null);
  return { current, max, completed: current !== null && max !== null ? current >= max : null };
}

function normalizeError(error) {
  const message = error?.message || "HoYoLAB API request failed";
  const code = error?.code ?? error?.retcode ?? null;
  const auth = /login|cookie|token|auth|expired|10001/i.test(message) || code === 10001 || code === -100;
  return {
    kind: auth ? "auth" : "api",
    message: auth ? "HoYoLABの認証情報が無効、または期限切れの可能性があります。" : message,
    detail: message
  };
}

async function makeHsr() {
  const uid = Number(process.env.HSR_UID);
  const ltuidV2 = Number(process.env.HOYO_LTUID_V2);
  if (!Number.isFinite(uid) || !Number.isFinite(ltuidV2)) throw new Error("HSR_UID / HOYO_LTUID_V2 を確認してください。");
  return new HonkaiStarRail({
    cookie: { ltokenV2: process.env.HOYO_LTOKEN_V2, ltuidV2 },
    uid,
    lang: LanguageEnum.JAPANESE
  });
}

app.get("/api/status", async (_req, res) => {
  if (!configured()) {
    return res.status(503).json({ok:false,configured:false,error:{kind:"config",message:".env に HOYO_LTOKEN_V2 / HOYO_LTUID_V2 / HSR_UID を設定してください。"}});
  }
  try {
    const hsr = await makeHsr();
    const [noteR, recordR, checkR] = await Promise.allSettled([
      hsr.record.note(),
      hsr.record.records(),
      hsr.daily.info()
    ]);
    if (noteR.status === "rejected") throw noteR.reason;

    const note = noteR.value;
    const daily = dailyProgress(note);
    const record = recordR.status === "fulfilled" ? recordR.value : null;
    const check = checkR.status === "fulfilled" ? checkR.value : null;
    const staminaCurrent = Number(note?.current_stamina ?? 0);
    const staminaMax = Number(note?.max_stamina ?? 300);
    const expeditions = (note?.expeditions || []).map(x => ({
      name:x.name || "派遣",
      status:x.status || "Unknown",
      remainingSeconds:Number(x.remaining_time || 0)
    }));

    return res.json({
      ok:true,
      fetchedAt:new Date().toISOString(),
      game:{
        id:"hsr",
        name:"崩壊：スターレイル",
        uid:String(process.env.HSR_UID),
        authenticated:true,
        daily,
        stamina:{current:staminaCurrent,max:staminaMax,recoverySeconds:Number(note?.stamina_recover_time || 0),capped:staminaCurrent >= staminaMax},
        expeditions,
        hoyolabCheckIn: check ? {
          signedToday: check?.is_sign ?? check?.is_signed ?? check?.signed ?? null,
          totalSignDays: check?.total_sign_day ?? check?.total_signed ?? null
        } : null,
        recordAvailable:Boolean(record)
      }
    });
  } catch (e) {
    const error = normalizeError(e);
    return res.status(error.kind === "auth" ? 401 : 502).json({ok:false,configured:true,error});
  }
});

app.get("/api/health", (_req,res) => res.json({ok:true,configured:configured()}));
app.listen(port, () => console.log("HoYo Daily Status: http://localhost:" + port));
