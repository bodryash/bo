/**
 * Поток — студенческая соцсеть МГУ в Telegram Mini App.
 *
 * Один воркер делает всё: раздаёт страницу приложения (папка public через
 * assets), отвечает на /api/*, отдаёт фото из R2 по /img/* и принимает
 * обновления бота на /tg. Одна команда `wrangler deploy` выкладывает всё
 * разом, и приложение с API живут на одном адресе — без CORS.
 */

import { handleUpdate } from "./bot.js";
import { addComment, deleteComment, listComments } from "./comments.js";
import { cleanupOrphans, serveImage, upload } from "./media.js";
import { report } from "./moderation.js";
import { listNotifications } from "./notify.js";
import { closePost, createPost, deletePost, feed, getPostView, likePost, search, votePost } from "./posts.js";
import { getMe, getProfile, updateMe, viewer } from "./users.js";
import { DAY, HttpError, json, now, readJson } from "./util.js";

/** [метод, шаблон пути, обработчик(ctx) ] — :id всегда число. */
const ROUTES = [
  ["GET", "/api/me", (c) => getMe(c.env, c.user, c.url)],
  ["POST", "/api/me", async (c) => updateMe(c.env, c.user, await readJson(c.request))],
  ["GET", "/api/users/:id", (c) => getProfile(c.env, c.user, c.id)],
  ["GET", "/api/feed", (c) => feed(c.env, c.user, c.url.searchParams)],
  ["GET", "/api/search", (c) => search(c.env, c.user, c.url.searchParams.get("q"))],
  ["POST", "/api/posts", async (c) => createPost(c.env, c.user, await readJson(c.request))],
  [
    "GET",
    "/api/posts/:id",
    async (c) => ({
      post: await getPostView(c.env, c.user, c.id),
      comments: await listComments(c.env, c.user, c.id),
    }),
  ],
  ["POST", "/api/posts/:id/delete", (c) => deletePost(c.env, c.user, c.id)],
  ["POST", "/api/posts/:id/close", async (c) => closePost(c.env, c.user, c.id, await readJson(c.request))],
  ["POST", "/api/posts/:id/like", async (c) => likePost(c.env, c.user, c.id, await readJson(c.request), c.ctx)],
  ["POST", "/api/posts/:id/vote", async (c) => votePost(c.env, c.user, c.id, await readJson(c.request))],
  ["POST", "/api/posts/:id/comments", async (c) => addComment(c.env, c.user, c.id, await readJson(c.request), c.ctx)],
  ["POST", "/api/comments/:id/delete", (c) => deleteComment(c.env, c.user, c.id)],
  ["POST", "/api/report", async (c) => report(c.env, c.user, await readJson(c.request), c.ctx)],
  ["POST", "/api/upload", (c) => upload(c.env, c.user, c.request, c.url)],
  ["GET", "/api/notifications", (c) => listNotifications(c.env, c.user)],
];

function match(method, path) {
  for (const [m, pattern, handler] of ROUTES) {
    if (m !== method) continue;
    const re = new RegExp("^" + pattern.replace(":id", "(\\d+)") + "$");
    const found = re.exec(path);
    if (found) return { handler, id: found[1] ? Number(found[1]) : null };
  }
  return null;
}

async function api(request, env, ctx, url) {
  const route = match(request.method, url.pathname);
  if (!route) return json({ error: "Нет такого адреса" }, 404);
  try {
    const user = await viewer(request, env);
    const data = await route.handler({ request, env, ctx, url, user, id: route.id });
    return json(data);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message, code: error.code }, error.status);
    console.log("api error", url.pathname, error?.stack || error);
    return json({ error: "Что-то пошло не так. Попробуйте ещё раз." }, 500);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Адрес приложения для кнопок бота. Если не задан явно — тот, по
    // которому к воркеру пришёл запрос: это и есть адрес приложения.
    if (!env.APP_URL) env.APP_URL = url.origin + "/";

    if (url.pathname.startsWith("/api/")) return api(request, env, ctx, url);
    if (url.pathname.startsWith("/img/") && request.method === "GET") {
      return serveImage(env, request, url.pathname.slice(5), ctx);
    }
    if (url.pathname === "/tg" && request.method === "POST") return handleUpdate(env, request);
    return env.ASSETS.fetch(request);
  },

  /** Раз в час: сироты-фото и старые уведомления. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      Promise.all([
        cleanupOrphans(env),
        env.DB.prepare("DELETE FROM notifications WHERE created_at < ?").bind(now() - 60 * DAY).run(),
      ])
    );
  },
};
