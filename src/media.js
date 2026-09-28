import { DAY, fail, now } from "./util.js";

// Приложение само сжимает фото до 1600 точек по длинной стороне, это
// 200–600 КБ. Всё крупнее — не наш клиент или испорченный файл.
const MAX_BYTES = 3 * 1024 * 1024;
const UPLOADS_PER_DAY = 60;

const TYPES = {
  "image/jpeg": { ext: "jpg", magic: [0xff, 0xd8, 0xff] },
  "image/png": { ext: "png", magic: [0x89, 0x50, 0x4e, 0x47] },
  "image/webp": { ext: "webp", magic: [0x52, 0x49, 0x46, 0x46] },
};

/** Фото грузится отдельно от поста, чтобы пост отправлялся мгновенно. */
export async function upload(env, user, request, url) {
  if (!env.MEDIA) fail(503, "Хранилище фото не подключено");
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

  const key = `${crypto.randomUUID()}.${kind.ext}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type } });
  await env.DB.prepare("INSERT INTO media (key, owner_id, w, h, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(key, user.id, w, h, t)
    .run();

  return { key, w, h };
}

function clampSize(value) {
  const n = Math.round(Number(value) || 0);
  return Math.min(Math.max(n, 1), 10000);
}

/**
 * Отдаёт фото. Имя файла случайное и не меняется, поэтому кэшировать можно
 * навсегда — и на телефоне, и на краю сети Cloudflare.
 */
export async function serveImage(env, request, key, ctx) {
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key)) return new Response("Not found", { status: 404 });

  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;

  const object = await env.MEDIA?.get(key);
  if (!object) return new Response("Not found", { status: 404 });

  const response = new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType || "image/jpeg",
      "cache-control": "public, max-age=31536000, immutable",
      etag: object.httpEtag,
      "x-content-type-options": "nosniff",
    },
  });
  ctx.waitUntil(cache.put(request, response.clone()));
  return response;
}

/** Фото, которые так и не попали в пост: закрыли окно, передумали. */
export async function cleanupOrphans(env) {
  const { results } = await env.DB.prepare(
    "SELECT key FROM media WHERE post_id IS NULL AND created_at < ? LIMIT 200"
  )
    .bind(now() - DAY)
    .all();
  if (!results.length) return;
  const keys = results.map((r) => r.key);
  await env.MEDIA?.delete(keys);
  await env.DB.prepare(`DELETE FROM media WHERE key IN (${keys.map(() => "?").join(",")})`)
    .bind(...keys)
    .run();
}
