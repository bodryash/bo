/**
 * Бот на вебхуке. Для всех — дверь в приложение и уведомления. Для
 * модераторов (ADMIN_IDS) — пульт: жалобы с кнопками, баны, статистика.
 */

import { FACULTY } from "../public/js/data.js";
import {
  banUser,
  deleteTarget,
  describeTarget,
  moderationButtons,
  parseTarget,
  restoreTarget,
  unbanUser,
} from "./moderation.js";
import { mediaChat, onChannelMember } from "./media.js";
import { appUrl } from "./notify.js";
import { webhookSecret } from "./setup.js";
import { displayName, userSearchKey } from "./users.js";
import { DAY, callTelegram, escapeHtml, isAdminTg, now, safeEqual } from "./util.js";

export async function handleUpdate(env, request) {
  const secret = request.headers.get("x-telegram-bot-api-secret-token") || "";
  // Без секрета любой, кто знает адрес воркера, мог бы слать поддельные
  // обновления — например, «нажатия» модераторских кнопок.
  if (!env.BOT_TOKEN || !safeEqual(secret, await webhookSecret(env))) {
    return new Response("forbidden", { status: 403 });
  }

  const update = await request.json().catch(() => null);
  try {
    if (update?.message) await onMessage(env, update.message);
    else if (update?.callback_query) await onCallback(env, update.callback_query);
    else if (update?.my_chat_member) await onChatMember(env, update.my_chat_member);
  } catch (error) {
    // Telegram повторяет обновление, пока не получит 200, — одна ошибка в
    // разборе превратилась бы в бесконечный повтор. Пишем в журнал и
    // отвечаем «принято».
    console.log("update failed", error?.stack || error);
  }
  return new Response("ok");
}

function openButton(env, text = "Открыть Поток", hash = "") {
  return { inline_keyboard: [[{ text, web_app: { url: appUrl(env, hash) } }]] };
}

/** Бот может писать только тем, кто сам начал разговор, — запоминаем. */
async function rememberChat(env, from, canDm) {
  const t = now();
  await env.DB.prepare(
    `INSERT INTO users (tg_id, first_name, last_name, username, search, can_dm, created_at, seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tg_id) DO UPDATE SET can_dm = excluded.can_dm`
  )
    .bind(from.id, from.first_name || "Без имени", from.last_name || null, from.username || null, userSearchKey(from), canDm ? 1 : 0, t, t)
    .run();
}

async function onChatMember(env, update) {
  if (["channel", "supergroup", "group"].includes(update.chat?.type)) return onChannelMember(env, update);
  if (update.chat?.type !== "private") return;
  const status = update.new_chat_member?.status;
  await rememberChat(env, update.from, status === "member");
}

async function reply(env, message, text, extra = {}) {
  return callTelegram(env, "sendMessage", {
    chat_id: message.chat.id,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...extra,
  });
}

async function onMessage(env, message) {
  if (message.chat?.type !== "private" || !message.from) return;
  const text = String(message.text || "").trim();
  const [rawCommand, ...rest] = text.split(/\s+/);
  const command = rawCommand.toLowerCase().replace(/@\w+$/, "");
  const args = rest;

  if (command === "/start") {
    await rememberChat(env, message.from, true);
    // /start p123 — пришли по ссылке на пост: сразу открываем его.
    const payload = args[0] || "";
    const post = /^p(\d+)$/.exec(payload);
    return reply(
      env,
      message,
      "<b>Поток</b> — студенческая соцсеть МГУ.\n\n" +
        "Лента факультета и всего университета, «Подслушано», барахолка, бюро находок, события и жильё. " +
        "Сюда же придут ответы на ваши посты и комментарии.",
      { reply_markup: post ? openButton(env, "Открыть пост", `#/p/${post[1]}`) : openButton(env) }
    );
  }

  if (!isAdminTg(env, message.from.id)) {
    return reply(env, message, "Всё самое интересное — в приложении 👇", { reply_markup: openButton(env) });
  }

  switch (command) {
    case "/help":
      return reply(env, message, HELP);
    case "/stats":
      return reply(env, message, await stats(env));
    case "/who":
    case "/card":
      return card(env, message, args[0]);
    case "/del":
    case "/restore": {
      const target = parseTarget(args[0]);
      if (!target) return reply(env, message, "Укажите, что: <code>p12</code> — пост, <code>c34</code> — комментарий.");
      const via = { note: `через бота (${message.from.first_name || "модератор"})` };
      const result = command === "/del" ? await deleteTarget(env, target, via) : await restoreTarget(env, target, via);
      return reply(env, message, result);
    }
    case "/ban":
      return ban(env, message, args);
    case "/unban": {
      const user = await findUser(env, args[0]);
      if (!user) return reply(env, message, "Не нашёл такого человека.");
      await unbanUser(env, user.id, { note: "через бота" });
      return reply(env, message, `Бан снят: ${escapeHtml(displayName(user))}.`);
    }
    case "/hidden":
      return hiddenList(env, message);
    case "/media":
      return mediaStatus(env, message);
    default:
      return reply(env, message, HELP, { reply_markup: openButton(env) });
  }
}

const HELP = `<b>Модерация</b>

/stats — сводка за сутки и неделю
/hidden — что скрыто жалобами и ждёт решения
/who p12 · /who c34 — карточка: автор (даже анонимный), жалобы, кнопки
/del p12 · /restore p12 — удалить или вернуть
/ban №5 7 спам — бан на 7 дней с причиной (без числа — навсегда)
/ban @ivanov · /ban p12 · /ban c34 — по нику или автору поста
/unban №5 — снять бан
/media — где хранятся фото

<i>№ — номер человека в Потоке, он есть в карточках.</i>`;

/** Человек по «№5», «5», «@ivanov», или автор «p12»/«c34». */
async function findUser(env, value) {
  const v = String(value || "").trim();
  if (!v) return null;
  const target = parseTarget(v);
  if (target) {
    const table = target.type === "p" ? "posts" : "comments";
    const row = await env.DB.prepare(`SELECT author_id FROM ${table} WHERE id = ?`).bind(target.id).first();
    return row ? env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(row.author_id).first() : null;
  }
  if (v.startsWith("@")) {
    return env.DB.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").bind(v.slice(1)).first();
  }
  const id = Number(v.replace(/^№/, ""));
  return Number.isInteger(id) ? env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first() : null;
}

async function ban(env, message, args) {
  const user = await findUser(env, args[0]);
  if (!user) return reply(env, message, "Не нашёл такого человека. Пример: <code>/ban №5 7 спам</code>");
  let days = 0;
  let reasonWords = args.slice(1);
  if (/^\d+$/.test(reasonWords[0] || "")) {
    days = Number(reasonWords[0]);
    reasonWords = reasonWords.slice(1);
  }
  const reason = reasonWords.join(" ").slice(0, 200);
  const until = await banUser(env, user.id, days, reason, { note: "через бота" });
  const when = days ? `до ${formatDate(until)}` : "навсегда";
  return reply(env, message, `⛔ ${escapeHtml(displayName(user))} (№${user.id}) — бан ${when}.`);
}

async function card(env, message, value) {
  const target = parseTarget(value);
  if (!target) return reply(env, message, "Пример: <code>/who p12</code>");
  const info = await describeTarget(env, target);
  if (!info) return reply(env, message, "Не найдено.");
  return reply(env, message, info.text, { reply_markup: moderationButtons(env, target, info.postId) });
}

async function hiddenList(env, message) {
  const { results } = await env.DB.prepare(
    `SELECT 'p' AS type, id, text, reports FROM posts WHERE hidden = 1
     UNION ALL SELECT 'c', id, text, reports FROM comments WHERE hidden = 1
     ORDER BY reports DESC LIMIT 20`
  ).all();
  if (!results.length) return reply(env, message, "Скрытого жалобами нет 👌");
  const lines = results.map(
    (r) => `<code>/who ${r.type}${r.id}</code> · ${r.reports} жал. · ${escapeHtml(String(r.text).slice(0, 60))}`
  );
  return reply(env, message, "<b>Ждут решения</b>\n\n" + lines.join("\n"));
}

async function mediaStatus(env, message) {
  if (env.MEDIA) return reply(env, message, "📷 Фото хранятся в R2.");
  const chat = await mediaChat(env);
  if (!chat) {
    return reply(
      env,
      message,
      "📷 Канал для фото не подключён — фото не загружаются.\n\n" +
        "Создайте закрытый канал и добавьте туда бота администратором (с правом публиковать). " +
        "Бот сам поймёт, что это склад, и напишет сюда."
    );
  }
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM media WHERE tg_file_id IS NOT NULL").first("n");
  return reply(env, message, `📷 Фото хранятся в канале <code>${escapeHtml(chat)}</code>. Всего файлов: ${count}.`);
}

async function stats(env) {
  const t = now();
  const [users, day, week, posts, comments, faculties] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE faculty IS NOT NULL"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE seen_at > ?").bind(t - DAY),
    env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE seen_at > ?").bind(t - 7 * DAY),
    env.DB.prepare("SELECT COUNT(*) AS n FROM posts WHERE created_at > ?").bind(t - DAY),
    env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE created_at > ?").bind(t - DAY),
    env.DB.prepare(
      "SELECT faculty, COUNT(*) AS n FROM users WHERE faculty IS NOT NULL GROUP BY faculty ORDER BY n DESC LIMIT 8"
    ),
  ]);
  const n = (r) => r.results[0]?.n ?? 0;
  const top = faculties.results.map((f) => `${FACULTY[f.faculty]?.short || f.faculty} — ${f.n}`).join("\n");
  return (
    `<b>Поток</b>\n\n` +
    `Профилей: ${n(users)}\n` +
    `Заходили за сутки: ${n(day)}, за неделю: ${n(week)}\n` +
    `За сутки постов: ${n(posts)}, комментариев: ${n(comments)}\n\n` +
    (top ? `<b>Факультеты</b>\n${top}` : "")
  );
}

async function onCallback(env, query) {
  const answer = (text) => callTelegram(env, "answerCallbackQuery", { callback_query_id: query.id, text });
  if (!isAdminTg(env, query.from.id)) return answer("Только для модераторов");

  const m = /^m:(ok|del|ban):([pc]:\d+)$/.exec(query.data || "");
  if (!m) return answer("Кнопка устарела");
  const target = parseTarget(m[2]);

  let result;
  const via = { note: `через бота (${query.from.first_name || "модератор"})` };
  if (m[1] === "ok") result = await restoreTarget(env, target, via);
  else {
    result = await deleteTarget(env, target, via);
    if (m[1] === "ban") {
      const info = await describeTarget(env, target);
      if (info?.author) {
        await banUser(env, info.author.id, 7, "жалобы на контент", via);
        result += ", автор забанен на 7 дней";
      }
    }
  }

  await answer(result);
  // Отмечаем решение прямо в карточке, чтобы второй модератор не взялся
  // за уже разобранное.
  if (query.message) {
    await callTelegram(env, "editMessageText", {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: "HTML",
      text: `${escapeHtml(query.message.text || "")}\n\n<b>Решение:</b> ${escapeHtml(result)} — ${escapeHtml(
        query.from.first_name || ""
      )}`,
      link_preview_options: { is_disabled: true },
    });
  }
}

function formatDate(ts) {
  return new Date(ts * 1000).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
}
