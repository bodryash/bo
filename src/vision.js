/**
 * Проверка фото нейросетью (Workers AI): нет ли на нём порно, обнажёнки
 * или жести. Фото с такой пометкой не отклоняется — пост с ним уходит на
 * проверку модератору, как и текст, пойманный фильтром. Нейросеть может
 * ошибиться, а купальник на пляже не повод отказывать человеку.
 *
 * Если нейросеть недоступна (не подключена, кончился бесплатный лимит,
 * сбой) — фото проходит как обычно: без проверки лучше, чем без фото.
 * Состояние проверки видно модератору в боте по команде /media.
 */

import { now } from "./util.js";

const PROMPT =
  "You are a content moderator for a university students' social network. Look at the image and answer with exactly one word. " +
  "Answer NSFW if it shows nudity (exposed genitals, female nipples, bare buttocks), sexual activity, pornography, " +
  "sexual fetish content, or graphic gore. Otherwise answer SAFE: swimwear, underwear ads, kissing, classical art, " +
  "memes, screenshots and ordinary photos are SAFE.";

// Модели по очереди: первая, что ответила, запоминается до конца жизни
// воркера. Разные модели ждут картинку по-разному.
const dataUrl = (bytes, type) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
};
const chat = (bytes, type) => ({
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: PROMPT },
        { type: "image_url", image_url: { url: dataUrl(bytes, type) } },
      ],
    },
  ],
  max_tokens: 5,
  temperature: 0,
});
const MODELS = [
  { id: "@cf/meta/llama-4-scout-17b-16e-instruct", input: chat },
  { id: "@cf/google/gemma-3-12b-it", input: chat },
  {
    id: "@cf/meta/llama-3.2-11b-vision-instruct",
    input: (bytes) => ({ messages: [{ role: "user", content: PROMPT }], image: [...bytes], max_tokens: 5, temperature: 0 }),
    // Эта модель просит один раз принять лицензию Meta.
    agree: true,
  },
];

const TIMEOUT = 12_000;
// Все модели упали — десять минут не пробуем, чтобы загрузки не ждали
// таймаутов впустую.
const BACKOFF = 600;
let preferred = 0;
let lastSaved = "";
let pausedUntil = 0;

/** Тестовая «нейросеть» для локальной проверки (.dev.vars: AI_FAKE=1). */
const fakeAI = {
  async run(model, input) {
    const url = input.messages?.[0]?.content?.[1]?.image_url?.url || "";
    const text = url ? atob(url.split(",")[1]) : "";
    return { response: text.includes("NSFW") ? "NSFW" : "SAFE" };
  },
};

const aiOf = (env) => env.AI || (env.AI_FAKE ? fakeAI : null);
export const visionEnabled = (env) => !!aiOf(env);

function verdictOf(out) {
  const text = String(out?.response ?? out?.result?.response ?? out?.choices?.[0]?.message?.content ?? "").trim();
  if (/nsfw|unsafe/i.test(text)) return "nsfw";
  if (/safe/i.test(text)) return "safe";
  return null;
}

async function withTimeout(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error("нейросеть не ответила за 12 с")), TIMEOUT)))]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * «nsfw», «safe» или null (проверить не удалось). Никогда не бросает
 * исключение: загрузка фото от проверки не зависит.
 */
export async function checkPhoto(env, bytes, type) {
  const ai = aiOf(env);
  if (!ai || now() < pausedUntil) return null;
  let lastError = null;
  for (let n = 0; n < MODELS.length; n++) {
    const i = (preferred + n) % MODELS.length;
    const model = MODELS[i];
    try {
      let out;
      try {
        out = await withTimeout(ai.run(model.id, model.input(bytes, type)));
      } catch (error) {
        if (!model.agree || !/agree/i.test(String(error?.message))) throw error;
        await ai.run(model.id, { prompt: "agree" });
        out = await withTimeout(ai.run(model.id, model.input(bytes, type)));
      }
      const verdict = verdictOf(out);
      if (!verdict) throw new Error(`непонятный ответ: ${JSON.stringify(out).slice(0, 120)}`);
      preferred = i;
      await saveStatus(env, { ok: true, model: model.id, at: now() });
      return verdict;
    } catch (error) {
      lastError = `${model.id}: ${String(error?.message || error).slice(0, 200)}`;
      console.log("vision failed", lastError);
    }
  }
  pausedUntil = now() + BACKOFF;
  await saveStatus(env, { ok: false, error: lastError, at: now() });
  return null;
}

/** Последнее состояние — в settings, но только когда оно меняется. */
async function saveStatus(env, status) {
  const key = status.ok ? `ok:${status.model}` : `err:${status.error}`;
  if (key === lastSaved) return;
  lastSaved = key;
  try {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('vision', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify(status))
      .run();
  } catch {}
}

/** Строка для /media в боте. */
export async function visionStatus(env) {
  if (!visionEnabled(env)) return "Проверка фото нейросетью: не подключена (нет привязки AI).";
  const raw = await env.DB.prepare("SELECT value FROM settings WHERE key = 'vision'").first("value");
  if (!raw) return "Проверка фото нейросетью: подключена, фото ещё не проверялись.";
  const s = JSON.parse(raw);
  return s.ok ? `Проверка фото нейросетью: работает (${s.model}).` : `Проверка фото нейросетью: ошибка — ${s.error}`;
}
