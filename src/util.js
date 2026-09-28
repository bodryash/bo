export const now = () => Math.floor(Date.now() / 1000);

export const DAY = 86400;

/** Ошибка, которую пользователь увидит текстом. Всё прочее — «что-то пошло не так». */
export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || null;
  }
}

export const fail = (status, message, code) => {
  throw new HttpError(status, message, code);
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    fail(400, "Не удалось прочитать запрос");
  }
}

export async function hmac(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    typeof key === "string" ? new TextEncoder().encode(key) : key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message)));
}

export const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Сравнение без утечки по времени: подпись не угадать посимвольно. */
export function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Подписанная строка живёт сутки. Дольше — и перехваченную строку можно
// было бы использовать бесконечно; короче — у того, кто оставил приложение
// свёрнутым на ночь, утром всё падало бы с ошибкой входа.
const INIT_DATA_TTL = DAY;

/**
 * Проверяет подпись initData мини-приложения и возвращает пользователя
 * Telegram или null. Без этой проверки кто угодно мог бы писать от чужого
 * имени одним запросом из консоли.
 */
export async function verifyInitData(initData, token) {
  if (!initData || !token) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = await hmac("WebAppData", token);
  const expected = toHex(await hmac(secret, checkString));
  if (!safeEqual(expected, hash)) return null;

  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || now() - authDate > INIT_DATA_TTL) return null;

  try {
    const user = JSON.parse(params.get("user") || "null");
    return user && Number.isInteger(user.id) ? user : null;
  } catch {
    return null;
  }
}

export async function callTelegram(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  // Telegram отвергает сообщение целиком из-за одной ошибки в разметке —
  // без записи в журнал это выглядит как «бот молчит».
  if (!response.ok) {
    console.log(`${method} rejected ${response.status}`, (await response.clone().text()).slice(0, 300));
  }
  return response;
}

export function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Обрезка по символам, а не по UTF-16: эмодзи не разламываются пополам. */
export function clip(text, max) {
  const chars = [...String(text ?? "")];
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : chars.join("");
}

export const charCount = (text) => [...String(text ?? "")].length;

/**
 * Приводит текст к виду для хранения: без управляющих символов, без
 * пробелов по краям и без пустых абзацев больше одного подряд.
 */
export function cleanText(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function adminIds(env) {
  return String(env.ADMIN_IDS || "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
}

export const isAdminTg = (env, tgId) => adminIds(env).includes(Number(tgId));

/**
 * Ключ для поиска: строчные буквы и «е» вместо «ё». LOWER и LIKE в SQLite
 * понимают регистр только у латиницы, поэтому «Демидович» по запросу
 * «демидович» без такого поля не нашёлся бы.
 */
export const searchKey = (text) => String(text ?? "").toLowerCase().replace(/ё/g, "е");
