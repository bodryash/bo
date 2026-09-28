/**
 * Защита от флуда, спама и «бомберов».
 *
 * - Частота: сколько постов, комментариев, фото и подписок можно за минуту,
 *   десять минут и час. Суточные лимиты — там же, где сами действия.
 * - Повторы: один и тот же текст второй раз подряд не публикуется.
 * - Фильтр: наркотики, интим-услуги и порно, казино и «лёгкий заработок»,
 *   скрытые ссылки-приглашения. Пост с таким текстом сразу уходит на проверку
 *   модератору (виден только автору), комментарий не публикуется.
 * - Кто трижды за сутки упёрся в фильтр — получает бан на сутки сам, без
 *   модератора: так ведут себя боты, а не люди.
 */

import { auditStmt } from "./audit.js";
import { DAY, clip, fail, now } from "./util.js";

// ——— частота ———

const RATES = {
  // Пять за десять минут: продавая несколько вещей, пишут несколько постов.
  post: [
    [600, 5, "Много постов за десять минут — подождите немного"],
    [3600, 10, "Много постов за час — продолжим чуть позже"],
  ],
  comment: [
    [60, 6, "Слишком быстро — подождите минуту"],
    [600, 30, "Много комментариев подряд — сделайте паузу на пару минут"],
  ],
  upload: [[600, 30, "Много фото подряд — подождите несколько минут"]],
  follow: [[3600, 60, "Много подписок подряд — продолжите через час"]],
};

const RATE_SQL = {
  post: "SELECT created_at AS t FROM posts WHERE author_id = ? AND created_at > ?",
  comment: "SELECT created_at AS t FROM comments WHERE author_id = ? AND created_at > ?",
  upload: "SELECT created_at AS t FROM media WHERE owner_id = ? AND created_at > ?",
  follow: "SELECT created_at AS t FROM follows WHERE follower_id = ? AND created_at > ?",
};

/** Запрос для пакета: времена действий за самое длинное окно. */
export function rateQuery(env, kind, userId) {
  const longest = Math.max(...RATES[kind].map(([w]) => w));
  return env.DB.prepare(`${RATE_SQL[kind]} ORDER BY created_at DESC LIMIT 500`).bind(userId, now() - longest);
}

/**
 * Проверить результат rateQuery; модераторов не ограничиваем. RATE_SCALE —
 * только для локальных тестов (.dev.vars): они пишут быстрее любого человека.
 */
export function assertRate(env, user, kind, rows) {
  if (user.admin) return;
  const t = now();
  const scale = Math.max(1, Number(env.RATE_SCALE) || 1);
  for (const [window, max, message] of RATES[kind]) {
    if (rows.filter((r) => r.t > t - window).length >= max * scale) fail(429, message);
  }
}

export async function checkRate(env, user, kind) {
  if (user.admin) return;
  const { results } = await rateQuery(env, kind, user.id).all();
  assertRate(env, user, kind, results);
}

// ——— фильтр ———

// Латиница, похожая на кириллицу: «kaзино», «з@кл@дки». Цифры меняем только
// для поиска слитных основ: в обычном тексте «от 5000» должно остаться числом.
const LETTERS = { a: "а", b: "в", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о", p: "р", t: "т", x: "х", y: "у", "@": "а" };
const DIGITS = { "0": "о", "3": "з", "6": "б" };

/** Строчные, ё → е, невидимые символы прочь, похожие латинские → русские. */
function cyr(text) {
  return String(text)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\u200b-\u200f\u2060\ufeff\u00ad]/g, "")
    .replace(/[abcehkmoptxy@]/g, (ch) => LETTERS[ch]);
}

/** Только буквы подряд: «к а з и н о», «к.а.з.и.н.о», «k@zin0» → «казино». */
const squash = (s) => s.replace(/[036]/g, (d) => DIGITS[d]).replace(/[^a-zа-я0-9]/g, "");

// Основы ищутся в тексте без пробелов и знаков — поэтому только длинные и
// однозначные (иначе «об налоге» превратилось бы в «обнал»). Слова и фразы —
// регулярками по обычному тексту. Писать можно и латиницей: основы
// приводятся к тому же виду, что и текст.
const RULES = [
  {
    id: "drugs",
    label: "наркотики",
    stems: ["мефедрон", "амфетамин", "кокаин", "гашиш", "марихуан", "экстази", "метадон", "героин", "альфапвп", "alfapvp", "шишкибошки"],
    words: [
      /(^|[^а-я])меф([^а-я]|$)/,
      /(^|[^а-я])(закладк|кладмен)\S*\s+(в\s|по\s|магазин|район|москв|мск|гарант|с\s+гарант)/,
      /(^|[^а-я])(соль|соли|скорость)\s+(в\s+наличии|закладк|оптом)/,
    ],
  },
  {
    id: "sex",
    label: "интим и 18+",
    stems: ["onlyfans", "онлифанс", "онлифэнс", "проститутк", "интимуслуг", "интимдосуг", "вебкаммодел", "webcammodel", "порнуха", "порновидео", "эскортуслуг", "нюдсы", "nudes", "слитыефото", "интимфото", "xvideos", "pornhub"],
    words: [/(^|[^а-я])порн/, /(^|[^а-я])секс\s*(за\s+деньг|услуг|знакомств|по\s+вызов)/, /(^|[^а-я])(досуг|интим)\s+(для|от)\s+(мужчин|девуш)/],
  },
  {
    id: "gamble",
    label: "казино и «лёгкий заработок»",
    // Казино само по себе — ещё не спам («Казино Рояль»), а вместе с бонусами — да.
    combos: [["казино", ["бонус", "депозит", "промокод", "фриспин", "выигрыш"]]],
    stems: ["1xbet", "1хбет", "melbet", "мелбет", "пассивныйдоход", "легкийзаработок", "легкиеденьги", "быстрыеденьги", "заработоквинтернете", "обналичиван", "криптосигнал", "ищудропов", "нужныдропы", "дропывкоманду"],
    words: [
      /казино[\s\S]{0,40}(бонус|депозит|промокод|фриспин|выигр|регистр)|(бонус|промокод|фриспин)[\s\S]{0,40}казино/,
      /(заработ\S*|доход\S*)\s+от\s+\d+/,
      /ставк\S*\s+на\s+спорт[\s\S]{0,40}(гарант|прогноз|без\s+риск)/,
    ],
  },
  {
    id: "papers",
    label: "продажа курсовых и дипломов",
    stems: [],
    words: [/(курсов\S*|диплом\S*|реферат\S*)\s+(на\s+заказ|недорого|под\s+ключ)/, /(продам|куплю|купить)\s+(диплом|справк|зачетк|зачётк)/],
  },
];
for (const rule of RULES) rule.stems = rule.stems.map((s) => squash(cyr(s)));

const combo = (rule, flat) => (rule.combos || []).some(([a, rest]) => flat.includes(a) && rest.some((b) => flat.includes(b)));

const INVITE = /t(elegram)?\.me\/(\+|joinchat)/i;
const SHORTENER = /(^|[^a-z0-9.])(bit\.ly|clck\.ru|goo\.su|tinyurl\.com|cutt\.ly|u\.to|vk\.cc|is\.gd)\//i;
const URLS = /https?:\/\/|t\.me\//gi;

/** Что не так с текстом: { id, label } или null. */
export function scan(text) {
  if (!text) return null;
  const raw = String(text);
  if (INVITE.test(raw)) return { id: "invite", label: "скрытые ссылки-приглашения" };
  if (SHORTENER.test(raw)) return { id: "short", label: "сокращённые ссылки" };
  if ((raw.match(URLS) || []).length >= 4) return { id: "links", label: "много ссылок" };
  const plain = cyr(raw);
  const flat = squash(plain);
  for (const rule of RULES) {
    if (rule.stems.some((s) => flat.includes(s)) || combo(rule, flat) || rule.words.some((re) => re.test(plain))) {
      return { id: rule.id, label: rule.label };
    }
  }
  return null;
}

const STRIKES_FOR_BAN = 3;

/**
 * Попытка упёрлась в фильтр: записываем в журнал (модератор видит текст), на
 * третьей за сутки — автоматический бан на сутки. Возвращает true, если бан.
 */
export async function strike(env, user, flag, text, where) {
  const t = now();
  const target = `u:${user.id}`;
  const prev = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit WHERE target = ? AND kind = 'blocked' AND created_at > ?")
    .bind(target, t - DAY)
    .first("n");
  const statements = [auditStmt(env, { kind: "blocked", target, actorId: user.id, oldText: clip(text, 1000), note: `${where}: ${flag.label}` })];
  const ban = !user.admin && prev + 1 >= STRIKES_FOR_BAN;
  if (ban) {
    statements.push(
      env.DB.prepare("UPDATE users SET banned_until = ?, ban_reason = ? WHERE id = ? AND banned_until < ?").bind(t + DAY, "автоматически: спам", user.id, t + DAY),
      auditStmt(env, { kind: "ban", target, note: `1 дн. · автобан: ${STRIKES_FOR_BAN} раза за сутки упёрся в фильтр` })
    );
  }
  await env.DB.batch(statements);
  return ban;
}

/** Нормализованный текст для поиска повторов. */
export const sameKey = (text) => squash(cyr(text || ""));
