/**
 * Бот настраивает себя сам — всё, что Bot API позволяет без BotFather:
 * вебхук на этот воркер, кнопка «Поток» слева от поля ввода, описание,
 * команды. Вызывается после каждой выкладки (POST /setup, см.
 * .github/workflows/deploy.yml) и раз в час проверяет, что вебхук на месте.
 *
 * Создать бота и получить токен можно только в @BotFather — это делает
 * человек.
 */

import { adminIds, callTelegram, fail, hmac, safeEqual, toHex } from "./util.js";

const COMMANDS = [{ command: "start", description: "Открыть Поток" }];
const ADMIN_COMMANDS = [
  ...COMMANDS,
  { command: "stats", description: "Сводка за сутки и неделю" },
  { command: "hidden", description: "Скрытое жалобами" },
  { command: "media", description: "Где хранятся фото" },
  { command: "help", description: "Команды модератора" },
];

/**
 * Секрет вебхука. Если его не задали отдельно — выводим из токена бота:
 * знает его только тот, у кого есть токен, а один секрет проще, чем два.
 */
export async function webhookSecret(env) {
  if (env.WEBHOOK_SECRET) return env.WEBHOOK_SECRET;
  return toHex(await hmac(env.BOT_TOKEN, "potok-webhook")).slice(0, 48);
}

export async function getSetting(env, key) {
  return env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first("value");
}

async function setSetting(env, key, value) {
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, String(value))
    .run();
}

/** Ник бота: из настроек воркера или тот, что бот сам узнал при настройке. */
export async function botUsername(env) {
  return env.BOT_USERNAME || (await getSetting(env, "bot_username"));
}

async function tg(env, method, payload) {
  const res = await callTelegram(env, method, payload);
  const data = await res.json().catch(() => ({}));
  return { ok: !!data.ok, result: data.result, error: data.description };
}

/** POST /setup — только с токеном бота в заголовке: его знает лишь владелец. */
export async function handleSetup(request, env, url) {
  const auth = request.headers.get("authorization") || "";
  if (!env.BOT_TOKEN || !safeEqual(auth, `Bearer ${env.BOT_TOKEN}`)) fail(403, "Нужен токен бота");
  return ensureBot(env, url.origin);
}

export async function ensureBot(env, origin) {
  const steps = {};

  const me = await tg(env, "getMe", {});
  if (!me.ok) fail(502, `Telegram не принял токен: ${me.error || "нет ответа"}`);
  await setSetting(env, "bot_username", me.result.username);
  await setSetting(env, "main_app", me.result.has_main_web_app ? "1" : "0");
  await setSetting(env, "app_url", origin);
  steps.bot = "@" + me.result.username;

  const hook = await tg(env, "setWebhook", {
    url: `${origin}/tg`,
    secret_token: await webhookSecret(env),
    allowed_updates: ["message", "callback_query", "my_chat_member"],
  });
  steps.webhook = hook.ok ? `${origin}/tg` : `ошибка: ${hook.error}`;

  const menu = await tg(env, "setChatMenuButton", {
    menu_button: { type: "web_app", text: "Поток", web_app: { url: `${origin}/` } },
  });
  steps.menu_button = menu.ok ? "Поток" : `ошибка: ${menu.error}`;

  await tg(env, "setMyCommands", { commands: COMMANDS });
  // Модераторам — их команды в подсказках. У того, кто ещё не нажал
  // Start, Telegram откажет — это не страшно: настройка повторится при
  // следующей выкладке.
  for (const id of adminIds(env)) {
    await tg(env, "setMyCommands", { commands: ADMIN_COMMANDS, scope: { type: "chat", chat_id: id } });
  }

  await tg(env, "setMyShortDescription", {
    short_description: "Студенческая соцсеть МГУ: лента факультета, Подслушано, барахолка, события.",
  });
  await tg(env, "setMyDescription", {
    description:
      "Поток — студенческая соцсеть МГУ прямо в Telegram.\n\n" +
      "Лента своего факультета и всего университета, анонимное «Подслушано», барахолка, бюро находок, события и жильё.\n\n" +
      "Нажмите «Старт», чтобы получать ответы на свои посты.",
  });

  return { ok: hook.ok && menu.ok, steps };
}

/**
 * Раз в час: вебхук всё ещё указывает сюда? Его мог сбросить кто-то с
 * токеном или другой проект, запущенный на том же боте.
 */
export async function checkWebhook(env) {
  const appUrl = await getSetting(env, "app_url");
  if (!appUrl || !env.BOT_TOKEN) return;
  // Заодно — не включили ли в BotFather главное мини-приложение.
  const me = await tg(env, "getMe", {});
  if (me.ok) await setSetting(env, "main_app", me.result.has_main_web_app ? "1" : "0");
  const info = await tg(env, "getWebhookInfo", {});
  if (info.ok && info.result?.url !== `${appUrl}/tg`) {
    console.log("webhook drifted:", info.result?.url, "→ restoring");
    await ensureBot(env, appUrl);
  }
}
