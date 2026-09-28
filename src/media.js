/**
 * Фото. Два хранилища, выбор — сам собой:
 *
 * - Telegram (по умолчанию). Воркер отправляет файл в закрытый канал, где
 *   бот — администратор, и запоминает file_id. Отдаёт — забирая файл у
 *   Telegram. Бесплатно, без ограничения по объёму и без банковской карты:
 *   R2 её требует даже на бесплатном тарифе.
 * - R2, если в wrangler.toml подключён бакет (привязка MEDIA).
 *
 * Снаружи разницы нет: у фото случайное имя вида <uuid>.jpg, по нему
 * приложение и просит /img/<имя>. Ссылки Telegram на файл содержат токен
 * бота, поэтому наружу они не уходят никогда.
 */

import { adminIds, callTelegram, DAY, fail, now, telegramUrl } from "./util.js";
import { checkRate } from "./guard.js";

// Приложение само сжимает фото до 1600 точек по длинной стороне, это
// 200–600 КБ. Всё крупнее — не наш клиент или испорченный файл.
const MAX_BYTES = 3 * 1024 * 1024;
const UPLOADS_PER_DAY = 60;

const TYPES = {
  "image/jpeg": { ext: "jpg", magic: [0xff, 0xd8, 0xff] },
  "image/png": { ext: "png", magic: [0x89, 0x50, 0x4e, 0x47] },
  "image/webp": { ext: "webp", magic: [0x52, 0x49, 0x46, 0x46] },
};

const TYPE_BY_EXT = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Канал для фото: из настроек воркера или тот, куда бота добавил модератор. */
export async function mediaChat(env) {
  if (env.MEDIA_CHAT_ID) return env.MEDIA_CHAT_ID;
  return env.DB.prepare("SELECT value FROM settings WHERE key = 'media_chat'").first("value");
}

/** Фото грузится отдельно от поста, чтобы пост отправлялся мгновенно. */
export async function upload(env, user, request, url) {
  if (user.banned_until > now()) fail(403, "Вы не можете загружать фото", "banned");

  const type = (request.headers.get("content-type") || "").split(";")[0].trim();
  const kind = TYPES[type];
  if (!kind) fail(415, "Поддерживаются JPEG, PNG и WebP");

  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BYTES) fail(413, "Фото слишком большое");

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) fail(413, "Фото слишком большое");
  // Тип из заголовка ничего не гарантирует: проверяем, что внутри
  // действительно картинка, иначе под видом фото можно раздавать что угодно.
  if (!kind.magic.every((b, i) => bytes[i] === b)) fail(415, "Это не похоже на изображение");

  const w = clampSize(url.searchParams.get("w"));
  const h = clampSize(url.searchParams.get("h"));

  const t = now();
  const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM media WHERE owner_id = ? AND created_at > ?")
    .bind(user.id, t - DAY)
    .first("n");
  if (today >= UPLOADS_PER_DAY) fail(429, "На сегодня фото достаточно");
  await checkRate(env, user, "upload");

  const key = `${crypto.randomUUID()}.${kind.ext}`;
  let tg = { file_id: null, chat_id: null, message_id: null };
  if (env.MEDIA) {
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type } });
  } else {
    tg = await sendToChannel(env, key, bytes, type);
  }

  await env.DB.prepare(
    "INSERT INTO media (key, owner_id, w, h, tg_file_id, tg_chat_id, tg_msg_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(key, user.id, w, h, tg.file_id, tg.chat_id, tg.message_id, t)
    .run();

  return { key, w, h };
}

/**
 * Файлом, а не фотографией: sendPhoto пережал бы картинку ещё раз, а она
 * уже сжата приложением. Уведомление в канале не нужно — это склад.
 */
async function sendToChannel(env, key, bytes, type) {
  const chatId = await mediaChat(env);
  if (!chatId) {
    console.log("upload: канал для фото не подключён");
    fail(503, "Фото пока не подключены — напишите модератору", "media");
  }

  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([bytes], { type }), key);
  form.append("disable_notification", "true");
  form.append("disable_content_type_detection", "true");

  let data = null;
  try {
    const res = await fetch(telegramUrl(env, "sendDocument"), { method: "POST", body: form });
    data = await res.json();
  } catch (error) {
    console.log("sendDocument failed", error?.stack || error);
  }
  const fileId = data?.result?.document?.file_id;
  if (!data?.ok || !fileId) {
    console.log("sendDocument rejected", JSON.stringify(data)?.slice(0, 300));
    fail(502, "Фото не загрузилось — попробуйте ещё раз");
  }
  return { file_id: fileId, chat_id: data.result.chat?.id ?? Number(chatId), message_id: data.result.message_id };
}

function clampSize(value) {
  const n = Math.round(Number(value) || 0);
  return Math.min(Math.max(n, 1), 10000);
}

/**
 * Отдаёт фото. Имя файла случайное и не меняется, поэтому кэшировать можно
 * навсегда — и на телефоне, и на краю сети Cloudflare: повторный показ не
 * доходит ни до базы, ни до Telegram.
 */
export async function serveImage(env, request, key, ctx) {
  const m = /^[0-9a-f-]{36}\.(jpg|png|webp)$/.exec(key);
  if (!m) return notFound();

  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;

  let body = null;
  let type = TYPE_BY_EXT[m[1]];
  if (env.MEDIA) {
    const object = await env.MEDIA.get(key);
    if (object) {
      body = object.body;
      type = object.httpMetadata?.contentType || type;
    }
  } else {
    body = await fetchFromTelegram(env, key);
  }
  if (!body) return notFound();

  const response = new Response(body, {
    headers: {
      "content-type": type,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
  ctx.waitUntil(cache.put(request, response.clone()));
  return response;
}

async function fetchFromTelegram(env, key) {
  const row = await env.DB.prepare("SELECT tg_file_id FROM media WHERE key = ?").bind(key).first();
  if (!row?.tg_file_id) return null;
  try {
    // Ссылка на файл живёт не меньше часа, но просим каждый раз: промахи
    // кэша редки, а хранить ссылки с токеном бота лишний раз не хочется.
    const info = await (await fetch(telegramUrl(env, "getFile") + "?file_id=" + encodeURIComponent(row.tg_file_id))).json();
    if (!info?.ok) {
      console.log("getFile rejected", JSON.stringify(info)?.slice(0, 200));
      return null;
    }
    const file = await fetch(telegramUrl(env, null, info.result.file_path));
    return file.ok ? file.body : null;
  } catch (error) {
    console.log("image fetch failed", error?.stack || error);
    return null;
  }
}

const notFound = () => new Response("Not found", { status: 404 });

/**
 * Фото, которые так и не попали в пост: закрыли окно, передумали. Из
 * канала их тоже убираем — по 40 за раз, чтобы уложиться в лимит
 * обращений наружу у бесплатного воркера.
 */
export async function cleanupOrphans(env) {
  const { results } = await env.DB.prepare(
    "SELECT key, tg_chat_id, tg_msg_id FROM media WHERE post_id IS NULL AND created_at < ? LIMIT 40"
  )
    .bind(now() - DAY)
    .all();
  if (!results.length) return;
  const keys = results.map((r) => r.key);
  if (env.MEDIA) await env.MEDIA.delete(keys);
  for (const r of results) {
    if (r.tg_chat_id && r.tg_msg_id) {
      await callTelegram(env, "deleteMessage", { chat_id: r.tg_chat_id, message_id: r.tg_msg_id });
    }
  }
  await env.DB.prepare(`DELETE FROM media WHERE key IN (${keys.map(() => "?").join(",")})`)
    .bind(...keys)
    .run();
}

/**
 * Бота добавили в канал или убрали из него. Если добавил модератор и дал
 * права администратора — это и есть склад для фото.
 */
export async function onChannelMember(env, update) {
  const chat = update.chat;
  const status = update.new_chat_member?.status;
  const current = await mediaChat(env);

  if (status === "administrator" && adminIds(env).includes(Number(update.from?.id))) {
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('media_chat', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
      .bind(String(chat.id))
      .run();
    await callTelegram(env, "sendMessage", {
      chat_id: update.from.id,
      text:
        `📷 Готово: фото Потока будут храниться в «${chat.title || "канале"}».\n\n` +
        "Не удаляйте канал и не убирайте из него бота — иначе фото перестанут открываться.",
    });
    return;
  }

  if (["left", "kicked"].includes(status) && String(chat.id) === String(current) && !env.MEDIA_CHAT_ID) {
    await env.DB.prepare("DELETE FROM settings WHERE key = 'media_chat'").run();
    for (const id of adminIds(env)) {
      await callTelegram(env, "sendMessage", {
        chat_id: id,
        text:
          `⚠️ Бота убрали из «${chat.title || "канала"}», где хранились фото Потока. ` +
          "Новые фото не загрузятся, старые не откроются, пока бота не вернут администратором.",
      });
    }
  }
}
