/**
 * Демо Потока в одной вкладке браузера. Здесь нет ни сервера, ни заглушек
 * вместо логики: код воркера из src/ запускается прямо на странице поверх
 * SQLite (sql.js), а запросы приложения к /api/* уходят в него, а не в сеть.
 * Подпись Telegram тоже настоящая — просто ключ бота здесь демонстрационный.
 *
 * Данные живут до перезагрузки страницы.
 */

import worker from "../src/index.js";
import { hmac, toHex } from "../src/util.js";
import { createD1, createMedia } from "./d1.js";
import { drawBook, drawPass, drawQuiz } from "./pictures.js";

const TOKEN = "777000:DEMO-TOKEN";
const DELAY = Number(new URLSearchParams(location.search).get("delay")) || 0;
const ORIGIN = "https://potok.demo";
const ME = { id: 7000, first_name: "Гость", language_code: "ru" };

const PEOPLE = {
  anya: { id: 9001, first_name: "Аня", last_name: "Лебедева", username: "anya_leb", profile: { faculty: "fgp", level: "bach", course: 3, bio: "Глобалистика, кофе и настолки. Староста 311" } },
  boris: { id: 9002, first_name: "Борис", last_name: "Ким", username: "boris_kim", profile: { faculty: "fgp", level: "bach", course: 2 } },
  vera: { id: 9003, first_name: "Вера", last_name: "Соколова", username: "verasok", profile: { faculty: "cmc", level: "mag", course: 1, bio: "Матан спасёт мир" } },
  gleb: { id: 9004, first_name: "Глеб", last_name: "Миронов", username: "gleb_m", profile: { faculty: "journ", level: "bach", course: 4, bio: "Веду квизы в ДК" } },
  dima: { id: 9005, first_name: "Дима", last_name: "Орлов", username: "dimaorlov", profile: { faculty: "fgp", level: "bach", course: 3 } },
  sasha: { id: 9006, first_name: "Саша", last_name: "Белова", username: "sasha_b", profile: { faculty: "fgp", level: "mag", course: 1 } },
  kirill: { id: 9007, first_name: "Кирилл", last_name: "Новиков", username: "kirnov", profile: { faculty: "hist", level: "bach", course: 1 } },
};

async function sign(user) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "demo",
    user: JSON.stringify(user),
  });
  const check = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = await hmac("WebAppData", TOKEN);
  params.set("hash", toHex(await hmac(secret, check)));
  return params.toString();
}

async function boot() {
  const SQL = await window.initSqlJs();
  const DB = createD1(SQL);
  const MEDIA = createMedia();
  const schema = await (await fetch(new URL("../schema.sql", import.meta.url))).text();
  DB.raw.exec(schema);

  // Гость в демо — модератор: чтобы было видно, кто за анонимками, и экран
  // «Модерация».
  const env = { DB, MEDIA, BOT_TOKEN: TOKEN, WEBHOOK_SECRET: "demo", ADMIN_IDS: String(ME.id), BOT_USERNAME: "", APP_NAME: "", APP_URL: "" };
  const ctx = { waitUntil: (p) => p?.catch?.((e) => console.warn(e)) };

  const handle = (path, init = {}) => worker.fetch(new Request(ORIGIN + path, init), env, ctx);

  const auth = new Map();
  async function as(person, method, path, body) {
    if (!auth.has(person.id)) auth.set(person.id, "tma " + (await sign(person)));
    const isBlob = body instanceof Blob;
    const res = await handle(path, {
      method,
      headers: { authorization: auth.get(person.id), ...(isBlob ? { "content-type": body.type } : body ? { "content-type": "application/json" } : {}) },
      body: isBlob ? body : body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`${path}: ${data.error}`);
    return data;
  }

  await seed(as, DB);

  // Запросы приложения: /api/* — в воркер, Telegram — «принято».
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("/api/")) {
      // ?delay=1500 — изобразить медленный сервер (для проверки интерфейса).
      if (DELAY) await new Promise((r) => setTimeout(r, DELAY));
      const res = await handle(url, init);
      react(url, init, res.clone());
      return res;
    }
    if (url.includes("api.telegram.org")) return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
    return realFetch(input, init);
  };

  window.POTOK_DEMO = {
    initData: await sign(ME),
    imageUrl: (key) => MEDIA.url(key),
  };

  // Кто-то отвечает — чтобы уведомления и значок на вкладке было видно в деле.
  const { refreshMe } = await import("../public/js/api.js");
  const { toast } = await import("../public/js/ui.js");
  const later = (ms, fn) => setTimeout(() => fn().catch((e) => console.warn(e)), ms);
  const ping = async (postId) => {
    window.dispatchEvent(new CustomEvent("potok:activity", { detail: { postId } }));
    await refreshMe();
    toast("Вам ответили 💬");
  };
  const answered = new Set();

  async function react(url, init, res) {
    if (init?.method !== "POST" || !res.ok) return;
    const data = await res.json().catch(() => ({}));

    if (url === "/api/posts" && data.post) {
      const post = data.post;
      const anon = post.anonymous;
      later(3000, async () => {
        await as(PEOPLE.dima, "POST", `/api/posts/${post.id}/like`, { on: true });
        await as(PEOPLE.sasha, "POST", `/api/posts/${post.id}/like`, { on: true });
      });
      later(5500, async () => {
        const who = post.rubric === "market" ? PEOPLE.vera : post.rubric === "event" ? PEOPLE.gleb : PEOPLE.anya;
        await as(who, "POST", `/api/posts/${post.id}/comments`, { text: REPLIES[post.rubric] || REPLIES.talk, anonymous: anon });
        await ping(post.id);
      });
    }

    const m = /^\/api\/posts\/(\d+)\/comments$/.exec(url);
    if (m && data.comment && !answered.has(m[1])) {
      answered.add(m[1]);
      const row = await DB.prepare("SELECT p.anonymous, u.tg_id FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?")
        .bind(Number(m[1]))
        .first();
      const author = Object.values(PEOPLE).find((p) => p.id === row?.tg_id);
      if (!author) return;
      later(4500, async () => {
        await as(author, "POST", `/api/posts/${m[1]}/comments`, {
          text: row.anonymous ? "Спасибо, что поддержали 🙈" : "Спасибо! Давай так 🙌",
          anonymous: !!row.anonymous,
          reply_to: data.comment.id,
        });
        await ping(Number(m[1]));
      });
    }
  }

  await import("../public/js/app.js");
  setTimeout(() => toast("Это демо: всё работает по-настоящему, но живёт до перезагрузки"), 900);
}

const REPLIES = {
  talk: "О, я тоже об этом думала! Давай обсудим после пары",
  study: "Могу скинуть свой конспект, пиши в личку",
  confess: "Кажется, я знаю, о ком ты 👀",
  event: "Записываю нашу команду! Сколько человек можно?",
  market: "Ещё актуально? Могу забрать завтра у ГЗ",
  lost: "Кажется, это моё! Где можно забрать?",
  housing: "Интересно! А сколько идти до метро?",
};

async function seed(as, DB) {
  const p = PEOPLE;
  for (const person of Object.values(p)) await as(person, "POST", "/api/me", person.profile);

  const upload = async (who, canvas) => {
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.86));
    return (await as(who, "POST", `/api/upload?w=${canvas.width}&h=${canvas.height}`, blob)).key;
  };

  const at = (days, hour, minute = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(hour, minute, 0, 0);
    return Math.floor(d / 1000);
  };
  const saturday = (() => {
    const d = new Date();
    return (6 - d.getDay() + 7) % 7 || 7;
  })();

  const post = async (who, body, minutesAgo) => {
    const { post } = await as(who, "POST", "/api/posts", body);
    post.minutesAgo = minutesAgo;
    return post;
  };

  const posts = [];
  posts.push(await post(p.sasha, { rubric: "housing", scope: "msu", text: "Ищу соседку в двушку у метро «Университет», 10 минут пешком до ГЗ. 28 000 ₽ с человека плюс коммуналка. Тихая, не курю, без животных — кроме моего кота 🐈‍⬛" }, 60 * 26));
  posts.push(await post(p.gleb, {
    rubric: "event",
    scope: "msu",
    text: "Межфакультетский квиз «Что? Где? Когда?» — собираем команды по 6 человек. Победителям пицца от студсовета 🍕\n\nРегистрация в комментариях: название команды и факультет.",
    event_at: at(1, 19),
    place: "ДК МГУ, малый зал",
    media: [await upload(p.gleb, drawQuiz())],
  }, 60 * 20));
  posts.push(await post(p.anya, {
    rubric: "event",
    text: "Субботний разговорный клуб по-китайски 🇨🇳 Уровень любой, приносите вопросы и печеньки.",
    event_at: at(saturday, 12),
    place: "1-й гуманитарный, ауд. 614",
  }, 60 * 9));
  posts.push(await post(p.vera, {
    rubric: "market",
    scope: "msu",
    text: "Продам «Сборник задач» Демидовича и конспекты по матанализу за первый курс. Состояние отличное, пометки карандашом. Отдам у ГЗ или у 2-го гумана.",
    price: 400,
    media: [await upload(p.vera, drawBook())],
  }, 60 * 7));
  posts.push(await post(p.dima, {
    rubric: "lost",
    text: "Нашёл пропуск МГУ на имя Кирилла Н. у гардероба в 1-м гумане. Оставил на вахте 🙌",
    media: [await upload(p.dima, drawPass())],
  }, 60 * 5));
  const poll = await post(p.dima, {
    rubric: "study",
    text: "Как готовимся к коллоквиуму по мировой экономике?",
    poll: ["Делим билеты и пишем общий конспект", "Каждый сам за себя", "Коллоквиум? Какой коллоквиум"],
  }, 190);
  posts.push(poll);
  const confess = await post(p.boris, { rubric: "confess", text: "Каждое утро в столовой на первом этаже вижу девушку с томиком Бродского. Если ты это читаешь — я тот, кто всегда берёт сырники 🙈" }, 95);
  posts.push(confess);
  const talk = await post(p.anya, { rubric: "talk", text: "Кто-нибудь знает, лекцию в четверг точно перенесли? В расписании стоит 614, а на двери написано про 1-й гуманитарный. Не хочу бегать между корпусами 😅" }, 38);
  posts.push(talk);
  const quiz = posts[1];

  for (const [who, post] of [
    [p.boris, talk], [p.vera, talk], [p.dima, talk], [p.sasha, talk],
    [p.anya, confess], [p.dima, confess], [p.sasha, confess], [p.gleb, confess], [p.vera, confess], [p.kirill, confess],
    [p.anya, quiz], [p.dima, quiz], [p.kirill, quiz], [p.boris, posts[3]], [p.anya, posts[4]], [p.kirill, posts[4]], [p.boris, posts[0]],
    [p.anya, poll], [p.sasha, poll],
  ]) await as(who, "POST", `/api/posts/${post.id}/like`, { on: true });

  for (const [who, option] of [[p.anya, 0], [p.boris, 2], [p.sasha, 0], [p.vera, 1], [p.kirill, 0]]) {
    await as(who, "POST", `/api/posts/${poll.id}/vote`, { option });
  }

  for (const [a, b] of [[p.anya, p.dima], [p.dima, p.anya], [p.sasha, p.anya], [p.boris, p.anya], [p.kirill, p.gleb], [p.vera, p.gleb], [p.anya, p.gleb]]) {
    const target = (await DB.prepare("SELECT id FROM users WHERE tg_id = ?").bind(b.id).first()).id;
    await as(a, "POST", `/api/users/${target}/follow`, { on: true });
  }

  const comment = async (who, post, body) => (await as(who, "POST", `/api/posts/${post.id}/comments`, body)).comment.id;
  const c1 = await comment(p.dima, talk, { text: "Перенесли, в деканате сказали — 1-й гуман, ауд. 402." });
  await comment(p.anya, talk, { text: "Спасибо, спас!", reply_to: c1 });
  await comment(p.sasha, talk, { text: "А время то же? 13:30?" });
  const a1 = await comment(p.anya, confess, { text: "Сырники там правда лучшие", anonymous: true });
  await comment(p.boris, confess, { text: "Это не ответ на главный вопрос 😅", anonymous: true, reply_to: a1 });
  await comment(p.sasha, confess, { text: "Кажется, я знаю, о ком ты. Она с третьего курса!", anonymous: true });
  await comment(p.dima, quiz, { text: "«Глобальные сырники», ФГП, нас пятеро — ищем шестого!" });
  await comment(p.kirill, posts[4], { text: "Это мой!! Спасибо огромное, уже забрал 🙏" });

  // Правки: модератор увидит «изменено» и прежние версии.
  await as(p.dima, "POST", `/api/comments/${c1}/edit`, { text: "Перенесли, в деканате сказали — 1-й гуман, ауд. 402. Начало в 13:40." });
  await as(p.anya, "POST", `/api/posts/${talk.id}/edit`, {
    text: talk.text + "\n\nUPD: перенесли в 1-й гуманитарный, ауд. 402. Спасибо всем!",
  });
  // Спам, который трое скрыли жалобами, — в очереди и серым под постом.
  const spam = await comment(p.kirill, quiz, { text: "Курсовые и дипломы недорого, пишите в личку 📩" });
  for (const who of [p.anya, p.dima, p.vera]) await as(who, "POST", "/api/report", { target: `c:${spam}`, reason: "spam" });
  // Галочка у ведущего квизов — подтверждённый организатор.
  const gleb = (await DB.prepare("SELECT id FROM users WHERE tg_id = ?").bind(p.gleb.id).first()).id;
  await DB.prepare("INSERT INTO verified (user_id, granted_by, created_at) VALUES (?, NULL, ?)").bind(gleb, Math.floor(Date.now() / 1000)).run();

  // Чтобы лента выглядела живой, «состариваем» посты и комментарии.
  const now = Math.floor(Date.now() / 1000);
  for (const post of posts) {
    const created = now - post.minutesAgo * 60;
    await DB.prepare("UPDATE posts SET created_at = ? WHERE id = ?").bind(created, post.id).run();
    await DB.prepare("UPDATE comments SET created_at = ? + (id % 7 + 1) * 240 WHERE post_id = ?").bind(created, post.id).run();
  }
}

boot().catch((error) => {
  console.error(error);
  const splash = document.querySelector(".splash");
  if (splash) splash.textContent = "Демо не запустилось. Обновите страницу.";
});
