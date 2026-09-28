/**
 * Сквозная проверка API на локальном воркере. Запуск:
 *   npm run mock                          (имитация Telegram, в одном окне)
 *   npm run db:local && npm run dev       (во втором)
 *   npm run smoke                         (в третьем)
 * Каждый прогон создаёт новых людей, поэтому базу между прогонами чистить
 * не нужно.
 */

import assert from "node:assert/strict";
import { devToken, signInitData } from "../tools/sign.mjs";

const BASE = process.env.BASE || "http://127.0.0.1:8787";
const MOCK = process.env.MOCK || "http://127.0.0.1:8790";
const TOKEN = devToken();
const CHANNEL = -1005550001;

/** Обновление от Telegram на вебхук бота — как будто прислал сам Telegram. */
const botUpdate = (update) =>
  fetch(BASE + "/tg", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "devsecret", "content-type": "application/json" },
    body: JSON.stringify({ update_id: Date.now(), ...update }),
  });

/** Что воркер отправил в Telegram (записывает tools/mock-telegram.mjs). */
async function telegramCalls() {
  // Уведомления уходят после ответа (waitUntil) — даём им долететь.
  await new Promise((r) => setTimeout(r, 400));
  return (await fetch(MOCK + "/__calls")).json();
}

const channelUpdate = (fromId, status) => ({
  my_chat_member: {
    chat: { id: CHANNEL, type: "channel", title: "Поток — фото" },
    from: { id: fromId, first_name: "Кто-то" },
    date: 0,
    old_chat_member: { status: "left", user: { id: 1 } },
    new_chat_member: { status, user: { id: 1 } },
  },
});
const run = Date.now() % 1_000_000;

function person(n, name, extra = {}) {
  const tgId = n === "admin" ? 1001 : 5_000_000 + run * 10 + n;
  const auth = "tma " + signInitData(TOKEN, { id: tgId, first_name: name, username: `u${tgId}`, ...extra });
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { authorization: auth, ...(body && !(body instanceof Uint8Array) ? { "content-type": "application/json" } : {}), ...headers },
      body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ...data };
  };
  return {
    tgId,
    get: (p) => call("GET", p),
    post: (p, b = {}, h) => call("POST", p, b, h),
  };
}

let passed = 0;
async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log("✓", name);
  } catch (error) {
    console.log("✗", name);
    throw error;
  }
}

const admin = person("admin", "Модератор");
const anya = person(1, "Аня");
const boris = person(2, "Борис");
const vera = person(3, "Вера");
const gleb = person(4, "Глеб");
const dima = person(5, "Дима");

await step("без подписи — 401", async () => {
  const res = await fetch(BASE + "/api/me");
  assert.equal(res.status, 401);
});

await step("поддельная подпись — 401", async () => {
  const res = await fetch(BASE + "/api/me", { headers: { authorization: "tma user=%7B%22id%22%3A1%7D&hash=00" } });
  assert.equal(res.status, 401);
});

await step("новый человек без профиля не может писать", async () => {
  const me = await anya.get("/api/me");
  assert.equal(me.me.faculty, null);
  const res = await anya.post("/api/posts", { rubric: "talk", text: "привет" });
  assert.equal(res.status, 403);
  assert.equal(res.code, "profile");
});

await step("профиль: проверка курса по ступени", async () => {
  const bad = await anya.post("/api/me", { faculty: "fgp", level: "mag", course: 3 });
  assert.equal(bad.status, 400);
  const ok = await anya.post("/api/me", { faculty: "fgp", level: "bach", course: 3, bio: "  люблю  \n кофе " });
  assert.equal(ok.me.faculty, "fgp");
  assert.equal(ok.me.bio, "люблю кофе");
  await boris.post("/api/me", { faculty: "fgp", level: "bach", course: 1 });
  await vera.post("/api/me", { faculty: "cmc", level: "mag", course: 1 });
  await gleb.post("/api/me", { faculty: "cmc", level: "alum" });
  await dima.post("/api/me", { faculty: "fgp", level: "spec", course: 5 });
  await admin.post("/api/me", { faculty: "fgp", level: "phd", course: 2 });
});

let talkId, confessId, marketId, pollId;

await step("посты разных рубрик", async () => {
  const talk = await anya.post("/api/posts", { rubric: "talk", text: "Кто идёт на лекцию Акаева?" });
  assert.equal(talk.status, 200);
  talkId = talk.post.id;
  assert.equal(talk.post.scope, "fgp");
  assert.equal(talk.post.author.name, "Аня");

  const confess = await boris.post("/api/posts", { rubric: "confess", text: "Влюбился в старосту", anonymous: false });
  confessId = confess.post.id;
  assert.equal(confess.post.anonymous, true, "Подслушано всегда анонимно");
  assert.equal(confess.post.author, null);

  const market = await vera.post("/api/posts", { rubric: "market", scope: "msu", text: "Продам Демидовича", price: 500 });
  marketId = market.post.id;
  assert.equal(market.post.scope, "msu");
  assert.equal(market.post.price, 500);

  const badEvent = await vera.post("/api/posts", { rubric: "event", text: "Вечеринка" });
  assert.equal(badEvent.status, 400);
  const event = await vera.post("/api/posts", {
    rubric: "event",
    scope: "msu",
    text: "Квиз в ДК",
    event_at: Math.floor(Date.now() / 1000) + 86400,
    place: "ДК МГУ",
  });
  assert.equal(event.status, 200);

  const poll = await anya.post("/api/posts", { rubric: "study", text: "Когда ботаем?", poll: ["Сегодня", "Завтра", "Никогда"] });
  pollId = poll.post.id;
  assert.deepEqual(poll.post.poll.counts, [0, 0, 0]);

  const dupPoll = await anya.post("/api/posts", { rubric: "study", text: "?", poll: ["Да", "да"] });
  assert.equal(dupPoll.status, 400);
});

await step("лента факультета и МГУ", async () => {
  const fac = await boris.get("/api/feed?scope=fac");
  const ids = fac.posts.map((p) => p.id);
  assert.ok(ids.includes(talkId) && ids.includes(confessId));
  assert.ok(!ids.includes(marketId), "пост для всего МГУ не в ленте факультета");
  const mine = fac.posts.find((p) => p.id === confessId);
  assert.equal(mine.mine, true);
  assert.equal(mine.author, null);
  const other = (await anya.get("/api/feed?scope=fac")).posts.find((p) => p.id === confessId);
  assert.equal(other.mine, false);
  assert.ok(!JSON.stringify(other).includes(String(boris.tgId)), "tg id автора не утекает");

  const msu = await anya.get("/api/feed?scope=msu");
  assert.ok(msu.posts.some((p) => p.id === marketId));
  const hot = await anya.get("/api/feed?scope=fgp&sort=hot");
  assert.ok(hot.posts.length >= 2);
  const soon = await anya.get("/api/feed?scope=msu&rubric=event&sort=soon");
  assert.equal(soon.posts[0].place, "ДК МГУ");
  const confessOnly = await anya.get("/api/feed?scope=fac&rubric=confess");
  assert.ok(confessOnly.posts.every((p) => p.rubric === "confess"));
});

await step("анонимный пост не виден в профиле автора другим", async () => {
  const me = await boris.get("/api/me");
  const forOthers = await anya.get(`/api/feed?author=${me.me.id}`);
  assert.ok(!forOthers.posts.some((p) => p.id === confessId));
  const forSelf = await boris.get(`/api/feed?author=${me.me.id}`);
  assert.ok(forSelf.posts.some((p) => p.id === confessId));
  const profile = await anya.get(`/api/users/${me.me.id}`);
  assert.equal(profile.stats.posts, 0);
});

await step("лайк, повторный лайк, снятие", async () => {
  let r = await boris.post(`/api/posts/${talkId}/like`, { on: true });
  assert.equal(r.likes, 1);
  r = await boris.post(`/api/posts/${talkId}/like`, { on: true });
  assert.equal(r.likes, 1, "второй лайк не считается");
  r = await vera.post(`/api/posts/${talkId}/like`, { on: true });
  assert.equal(r.likes, 2);
  r = await vera.post(`/api/posts/${talkId}/like`, { on: false });
  assert.equal(r.likes, 1);
});

await step("опрос: один голос", async () => {
  let r = await boris.post(`/api/posts/${pollId}/vote`, { option: 1 });
  assert.deepEqual(r.poll.counts, [0, 1, 0]);
  r = await boris.post(`/api/posts/${pollId}/vote`, { option: 0 });
  assert.deepEqual(r.poll.counts, [0, 1, 0]);
  assert.equal(r.poll.mine, 1);
});

let commentId;
await step("комментарии и ответы", async () => {
  const c1 = await boris.post(`/api/posts/${talkId}/comments`, { text: "Я иду!" });
  commentId = c1.comment.id;
  const c2 = await anya.post(`/api/posts/${talkId}/comments`, { text: "Супер", reply_to: commentId });
  assert.equal(c2.comment.reply_to, commentId);
  assert.equal(c2.comment.is_op, true);
  const view = await vera.get(`/api/posts/${talkId}`);
  assert.equal(view.post.comments, 2);
  assert.equal(view.comments.length, 2);
});

await step("анонимные номера в Подслушано", async () => {
  const a = await anya.post(`/api/posts/${confessId}/comments`, { text: "кто это", anonymous: true });
  const v = await vera.post(`/api/posts/${confessId}/comments`, { text: "ого", anonymous: true });
  const a2 = await anya.post(`/api/posts/${confessId}/comments`, { text: "ну скажи", anonymous: true });
  const op = await boris.post(`/api/posts/${confessId}/comments`, { text: "не скажу", anonymous: true });
  assert.equal(a.comment.anon_no, 1);
  assert.equal(v.comment.anon_no, 2);
  assert.equal(a2.comment.anon_no, 1, "тот же человек — тот же номер");
  assert.equal(op.comment.anon_no, 0);
  assert.equal(op.comment.is_op, true);
  assert.equal(op.comment.author, null);
});

await step("уведомления", async () => {
  const n = await anya.get("/api/me");
  assert.ok(n.unread >= 2, "лайк и комментарий");
  const list = await anya.get("/api/notifications");
  const kinds = list.items.map((i) => i.kind);
  assert.ok(kinds.includes("like") && kinds.includes("comment"));
  const after = await anya.get("/api/me");
  assert.equal(after.unread, 0);
  const boriska = await boris.get("/api/notifications");
  assert.ok(boriska.items.some((i) => i.kind === "reply"));
  const anonComment = boriska.items.find((i) => i.post_id === confessId && i.kind === "comment");
  assert.equal(anonComment.actor, null, "анонимный комментатор не раскрывается в уведомлении");
});

await step("ответ на пост приходит в бота, если человек нажал /start", async () => {
  await fetch(MOCK + "/__reset");
  await botUpdate({ message: { message_id: 1, chat: { id: anya.tgId, type: "private" }, from: { id: anya.tgId, first_name: "Аня" }, text: "/start" } });
  const quiet = await vera.post(`/api/posts/${talkId}/comments`, { text: "Я тоже приду" });
  assert.equal(quiet.status, 200);
  const calls = await telegramCalls();
  const push = calls.find((c) => c.method === "sendMessage" && Number(c.chat_id) === anya.tgId && /прокомментировал/.test(c.text));
  assert.ok(push, "Аня получила сообщение о комментарии");
  assert.match(push.text, /Я тоже приду/);
  assert.match(push.reply_markup.inline_keyboard[0][0].web_app.url, new RegExp(`#/p/${talkId}/c${quiet.comment.id}$`));
  assert.ok(!calls.some((c) => Number(c.chat_id) === boris.tgId && c.method === "sendMessage" && /прокомментировал/.test(c.text)), "кто не нажимал /start — тому бот не пишет");
});

await step("фото без канала-склада — понятная ошибка", async () => {
  await botUpdate(channelUpdate(1001, "kicked")); // на случай повторного прогона
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0xff, 0xd9]);
  const res = await anya.post("/api/upload?w=10&h=10", jpeg, { "content-type": "image/jpeg" });
  assert.equal(res.status, 503);
  assert.equal(res.code, "media");
});

await step("канал-склад: подключает только модератор", async () => {
  await fetch(MOCK + "/__reset");
  await botUpdate(channelUpdate(42, "administrator"));
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0xff, 0xd9]);
  const still = await anya.post("/api/upload?w=10&h=10", jpeg, { "content-type": "image/jpeg" });
  assert.equal(still.status, 503, "канал, куда бота добавил не модератор, не считается");

  await botUpdate(channelUpdate(1001, "administrator"));
  const calls = await telegramCalls();
  assert.ok(calls.some((c) => c.method === "sendMessage" && Number(c.chat_id) === 1001 && /Готово/.test(c.text)), "модератору пришло подтверждение");
});

await step("фото: загрузка, проверка содержимого, прикрепление", async () => {
  const fake = new TextEncoder().encode("<script>alert(1)</script>");
  const bad = await anya.post("/api/upload?w=10&h=10", fake, { "content-type": "image/jpeg" });
  assert.equal(bad.status, 415);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
  const up = await anya.post("/api/upload?w=1600&h=1200", jpeg, { "content-type": "image/jpeg" });
  assert.equal(up.status, 200);
  const stolen = await boris.post("/api/posts", { rubric: "talk", text: "чужое фото", media: [up.key] });
  assert.equal(stolen.status, 400);
  const post = await anya.post("/api/posts", { rubric: "lost", text: "Нашла ключи в 614", media: [up.key] });
  assert.equal(post.post.media[0].w, 1600);
  const img = await fetch(`${BASE}/img/${up.key}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(new Uint8Array(await img.arrayBuffer()), jpeg, "из Telegram вернулся тот же файл");
  const calls = await telegramCalls();
  const sent = calls.find((c) => c.method === "sendDocument" && c.name === up.key);
  assert.equal(Number(sent?.chat_id), CHANNEL, "файл ушёл в канал-склад");
  const missing = await fetch(`${BASE}/img/00000000-0000-0000-0000-000000000000.jpg`);
  assert.equal(missing.status, 404);
  const again = await anya.post("/api/posts", { rubric: "talk", text: "то же фото", media: [up.key] });
  assert.equal(again.status, 400, "одно фото — в одном посте");
});

await step("жалобы: три — и пост скрыт", async () => {
  const self = await boris.post("/api/report", { target: `p:${confessId}`, reason: "spam" });
  assert.equal(self.status, 400);
  await anya.post("/api/report", { target: `p:${confessId}`, reason: "abuse" });
  await anya.post("/api/report", { target: `p:${confessId}`, reason: "abuse" });
  await dima.post("/api/report", { target: `p:${confessId}`, reason: "abuse" });
  let feed = await dima.get("/api/feed?scope=fgp");
  assert.ok(feed.posts.some((p) => p.id === confessId), "две жалобы от разных — ещё виден");
  await admin.post("/api/report", { target: `p:${confessId}`, reason: "spam" });
  feed = await dima.get("/api/feed?scope=fgp");
  assert.ok(!feed.posts.some((p) => p.id === confessId));
  const direct = await dima.get(`/api/posts/${confessId}`);
  assert.equal(direct.status, 404);
  const own = await boris.get(`/api/posts/${confessId}`);
  assert.equal(own.post.hidden, 1, "автор видит, что пост скрыт");
});

await step("бот: /media показывает, где фото", async () => {
  await fetch(MOCK + "/__reset");
  await botUpdate({ message: { message_id: 2, chat: { id: 1001, type: "private" }, from: { id: 1001, first_name: "M" }, text: "/media" } });
  const calls = await telegramCalls();
  assert.ok(calls.some((c) => c.method === "sendMessage" && String(c.text).includes(String(CHANNEL))));
});

await step("бот: секрет вебхука и возврат модератором", async () => {
  const noSecret = await fetch(BASE + "/tg", { method: "POST", body: "{}" });
  assert.equal(noSecret.status, 403);
  const res = await fetch(BASE + "/tg", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "devsecret", "content-type": "application/json" },
    body: JSON.stringify({
      update_id: 1,
      callback_query: { id: "1", from: { id: 1001, first_name: "Модератор" }, data: `m:ok:p:${confessId}` },
    }),
  });
  assert.equal(res.status, 200);
  const feed = await dima.get("/api/feed?scope=fgp");
  assert.ok(feed.posts.some((p) => p.id === confessId), "вернулся в ленту");

  const notAdmin = await fetch(BASE + "/tg", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "devsecret", "content-type": "application/json" },
    body: JSON.stringify({
      update_id: 2,
      callback_query: { id: "2", from: { id: 42, first_name: "Хитрец" }, data: `m:del:p:${talkId}` },
    }),
  });
  assert.equal(notAdmin.status, 200);
  const still = await dima.get(`/api/posts/${talkId}`);
  assert.equal(still.post.id, talkId, "кнопка не-модератора ничего не делает");
});

await step("удаление комментария правит счётчик", async () => {
  const foreign = await vera.post(`/api/comments/${commentId}/delete`);
  assert.equal(foreign.status, 403);
  const before = (await vera.get(`/api/posts/${talkId}`)).post.comments;
  await boris.post(`/api/comments/${commentId}/delete`);
  const view = await vera.get(`/api/posts/${talkId}`);
  assert.equal(view.post.comments, before - 1);
  assert.ok(!view.comments.some((c) => c.id === commentId));
});

await step("поиск", async () => {
  const r = await boris.get("/api/search?q=" + encodeURIComponent("демидович"));
  assert.ok(r.posts.some((p) => p.id === marketId), "поиск без учёта регистра по кириллице");
  const u = await boris.get("/api/search?q=" + encodeURIComponent("Вера"));
  assert.ok(u.users.some((x) => x.name === "Вера"));
});

await step("бан через бота запрещает писать", async () => {
  const me = await gleb.get("/api/me");
  await fetch(BASE + "/tg", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "devsecret", "content-type": "application/json" },
    body: JSON.stringify({
      update_id: 3,
      message: { message_id: 1, chat: { id: 1001, type: "private" }, from: { id: 1001, first_name: "M" }, text: `/ban №${me.me.id} 3 спам` },
    }),
  });
  const res = await gleb.post("/api/posts", { rubric: "talk", text: "спам" });
  assert.equal(res.status, 403);
  assert.equal(res.code, "banned");
  assert.match(res.error, /спам/);
});

console.log(`\nВсё прошло: ${passed} проверок.`);
