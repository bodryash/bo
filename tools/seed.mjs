/**
 * Наполняет локальную базу правдоподобными постами, чтобы было на что
 * смотреть при разработке. Только для `wrangler dev`:
 *   npm run dev          (в одном окне)
 *   node tools/seed.mjs  (в другом)
 */

import { devToken, signInitData } from "./sign.mjs";

const BASE = process.env.BASE || "http://127.0.0.1:8787";
const TOKEN = devToken();

const PEOPLE = {
  anya: { id: 9001, first_name: "Аня", last_name: "Лебедева", profile: { faculty: "fgp", level: "bach", course: 3, bio: "Глобалистика, кофе, настолки" } },
  boris: { id: 9002, first_name: "Борис", last_name: "Ким", profile: { faculty: "fgp", level: "bach", course: 2 } },
  vera: { id: 9003, first_name: "Вера", last_name: "Соколова", profile: { faculty: "cmc", level: "mag", course: 1 } },
  gleb: { id: 9004, first_name: "Глеб", last_name: "Миронов", profile: { faculty: "journ", level: "bach", course: 4 } },
  dima: { id: 9005, first_name: "Дима", last_name: "Орлов", profile: { faculty: "fgp", level: "bach", course: 3 } },
  sasha: { id: 9006, first_name: "Саша", last_name: "Белова", profile: { faculty: "fgp", level: "mag", course: 1 } },
};

async function call(person, method, path, body) {
  const auth = "tma " + signInitData(TOKEN, { id: person.id, first_name: person.first_name, last_name: person.last_name, username: `seed${person.id}` });
  const res = await fetch(BASE + path, {
    method,
    headers: { authorization: auth, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${data.error}`);
  return data;
}

const p = PEOPLE;
for (const person of Object.values(p)) await call(person, "POST", "/api/me", person.profile);

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
tomorrow.setHours(19, 0, 0, 0);
const saturday = new Date();
saturday.setDate(saturday.getDate() + ((6 - saturday.getDay() + 7) % 7 || 7));
saturday.setHours(12, 0, 0, 0);

const post = async (who, body) => (await call(who, "POST", "/api/posts", body)).post.id;

const housing = await post(p.sasha, { rubric: "housing", scope: "msu", text: "Ищу соседку в двушку у метро «Университет», 10 минут пешком до ГЗ. 28 000 ₽ с человека плюс коммуналка. Тихая, не курю, без животных 🐈‍⬛ — кроме моего кота." });
const quiz = await post(p.gleb, {
  rubric: "event",
  scope: "msu",
  text: "Межфакультетский квиз «Что? Где? Когда?» — собираем команды по 6 человек. Победителям пицца от студсовета 🍕\n\nРегистрация в комментариях: название команды и факультет.",
  event_at: Math.floor(tomorrow / 1000),
  place: "ДК МГУ, малый зал",
});
await post(p.anya, {
  rubric: "event",
  scope: "fgp",
  text: "Субботний разговорный клуб по-китайски 🇨🇳 Уровень любой, приносите вопросы и печеньки.",
  event_at: Math.floor(saturday / 1000),
  place: "1-й гуманитарный, ауд. 614",
});
const market = await post(p.vera, { rubric: "market", scope: "msu", text: "Продам «Сборник задач» Демидовича и конспекты по матанализу за первый курс. Состояние отличное, пометки карандашом. Отдам у ГЗ или у 2-го гумана.", price: 400 });
const lost = await post(p.dima, { rubric: "lost", text: "Нашёл чёрный пропуск МГУ на имя Кирилла Н. у гардероба в 1-м гумане. Оставил на вахте 🙌" });
const poll = await post(p.dima, {
  rubric: "study",
  text: "Как готовимся к коллоквиуму по мировой экономике?",
  poll: ["Делим билеты и пишем общий конспект", "Каждый сам за себя", "Коллоквиум? Какой коллоквиум"],
});
const confess = await post(p.boris, { rubric: "confess", text: "Каждое утро в столовой на первом этаже вижу девушку с томиком Бродского. Если ты это читаешь — я тот, кто всегда берёт сырники 🙈" });
const talk = await post(p.anya, { rubric: "talk", text: "Кто-нибудь знает, лекцию в четверг точно перенесли? В расписании стоит 614, а на двери написано про 1-й гуманитарный. Не хочу бегать между корпусами 😅" });

for (const [who, id] of [
  [p.boris, talk], [p.vera, talk], [p.dima, talk], [p.sasha, talk],
  [p.anya, confess], [p.dima, confess], [p.sasha, confess], [p.gleb, confess], [p.vera, confess],
  [p.anya, quiz], [p.dima, quiz], [p.boris, market], [p.anya, lost], [p.gleb, lost], [p.boris, housing],
]) await call(who, "POST", `/api/posts/${id}/like`, { on: true });

for (const [who, option] of [[p.anya, 0], [p.boris, 2], [p.sasha, 0], [p.vera, 1]]) {
  await call(who, "POST", `/api/posts/${poll}/vote`, { option });
}

const c1 = (await call(p.dima, "POST", `/api/posts/${talk}/comments`, { text: "Перенесли, в деканате сказали — 1-й гуман, ауд. 402." })).comment.id;
await call(p.anya, "POST", `/api/posts/${talk}/comments`, { text: "Спасибо, спас!", reply_to: c1 });
await call(p.sasha, "POST", `/api/posts/${talk}/comments`, { text: "А время то же? 13:30?" });

const a1 = (await call(p.anya, "POST", `/api/posts/${confess}/comments`, { text: "Сырники там правда лучшие", anonymous: true })).comment.id;
await call(p.boris, "POST", `/api/posts/${confess}/comments`, { text: "Это не ответ на главный вопрос 😅", anonymous: true, reply_to: a1 });
await call(p.sasha, "POST", `/api/posts/${confess}/comments`, { text: "Кажется, я знаю, о ком ты. Она с третьего курса!", anonymous: true });

await call(p.dima, "POST", `/api/posts/${quiz}/comments`, { text: "«Глобальные сырники», ФГП, нас пятеро — ищем шестого!" });

console.log("Готово: 9 постов, лайки, опрос и комментарии.");
