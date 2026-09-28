import { initData } from "./tg.js";

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(method, path, body, headers = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        authorization: "tma " + initData(),
        ...(body && !(body instanceof Blob) ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body instanceof Blob ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Нет связи. Проверьте интернет.", 0, "network");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error || "Что-то пошло не так", response.status, data.code);
  return data;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body = {}) => request("POST", path, body),
  upload: (blob, w, h) => request("POST", `/api/upload?w=${w}&h=${h}`, blob, { "content-type": blob.type }),
};

/**
 * Общее состояние: кто я, настройки бота, непрочитанные. Экраны читают его
 * напрямую и подписываются на изменения, чтобы, например, значок
 * уведомлений на вкладке обновлялся сам.
 */
export const store = {
  me: null,
  config: {},
  unread: 0,
  listeners: new Set(),
  set(patch) {
    Object.assign(this, patch);
    for (const fn of this.listeners) fn(this);
  },
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },
};

export async function refreshMe() {
  const data = await api.get("/api/me");
  store.set({ me: data.me, config: data.config, unread: data.unread });
  return data;
}

/** Ссылка на пост, которую можно переслать в любой чат. */
export function postLink(id) {
  const { bot, app, origin } = store.config;
  if (bot && app) return `https://t.me/${bot}/${app}?startapp=p${id}`;
  if (bot) return `https://t.me/${bot}?start=p${id}`;
  return `${origin || location.origin}/#/p/${id}`;
}

// Демо хранит фото в памяти страницы и отдаёт их своими адресами.
export const imageUrl = (key) => window.POTOK_DEMO?.imageUrl(key) || `/img/${key}`;
