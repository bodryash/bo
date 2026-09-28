import { FACULTY, LEVEL, LIMITS } from "../public/js/data.js";
import { cleanText, charCount, fail, isAdminTg, now, searchKey, verifyInitData } from "./util.js";

// Имя и аватар обновляем не на каждом запросе, а если что-то поменялось или
// давно не заходил: иначе каждое открытие ленты было бы записью в базу.
const SEEN_REFRESH = 600;

/**
 * Кто делает запрос. Подпись Telegram приходит в заголовке
 * `Authorization: tma <initData>`; без неё — 401, приложение покажет
 * «откройте через Telegram».
 */
export async function viewer(request, env) {
  const header = request.headers.get("authorization") || "";
  const initData = header.startsWith("tma ") ? header.slice(4) : "";
  const tg = await verifyInitData(initData, env.BOT_TOKEN);
  if (!tg) fail(401, "Откройте приложение заново через Telegram", "auth");

  const t = now();
  const fields = {
    first_name: String(tg.first_name || "Без имени").slice(0, 64),
    last_name: tg.last_name ? String(tg.last_name).slice(0, 64) : null,
    username: tg.username ? String(tg.username).slice(0, 32) : null,
    photo_url: typeof tg.photo_url === "string" && tg.photo_url.startsWith("https://") ? tg.photo_url : null,
  };

  let user = await env.DB.prepare("SELECT * FROM users WHERE tg_id = ?").bind(tg.id).first();
  const search = userSearchKey({ ...fields, show_username: user ? user.show_username : 1 });
  if (!user) {
    user = await env.DB.prepare(
      `INSERT INTO users (tg_id, first_name, last_name, username, photo_url, search, created_at, seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tg_id) DO UPDATE SET seen_at = excluded.seen_at
       RETURNING *`
    )
      .bind(tg.id, fields.first_name, fields.last_name, fields.username, fields.photo_url, search, t, t)
      .first();
  } else {
    const changed = Object.keys(fields).some((k) => (user[k] ?? null) !== fields[k]) || user.search !== search;
    if (changed || t - user.seen_at > SEEN_REFRESH) {
      await env.DB.prepare(
        "UPDATE users SET first_name = ?, last_name = ?, username = ?, photo_url = ?, search = ?, seen_at = ? WHERE id = ?"
      )
        .bind(fields.first_name, fields.last_name, fields.username, fields.photo_url, search, t, user.id)
        .run();
      Object.assign(user, fields, { search, seen_at: t });
    }
  }

  user.admin = isAdminTg(env, tg.id);
  return user;
}

// Ник попадает в поиск, только если человек разрешил его показывать: иначе
// поиском можно было бы проверить, сидит ли здесь конкретный @username.
export const userSearchKey = (u) =>
  searchKey([u.first_name, u.last_name, u.show_username !== 0 && u.username].filter(Boolean).join(" "));

/** Писать можно только заполнив профиль и не будучи в бане. */
export function assertCanWrite(user) {
  if (user.banned_until > now()) {
    const forever = user.banned_until > now() + 50 * 365 * 86400;
    const until = forever
      ? "навсегда"
      : "до " + new Date(user.banned_until * 1000).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
    const reason = user.ban_reason ? ` Причина: ${user.ban_reason}.` : "";
    fail(403, `Вы не можете писать ${until}.${reason}`, "banned");
  }
  if (!user.faculty) fail(403, "Сначала заполните профиль", "profile");
}

export function displayName(u) {
  return [u.first_name, u.last_name].filter(Boolean).join(" ");
}

/** То, что о человеке видят другие. Telegram id сюда не попадает никогда. */
export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: displayName(u),
    username: u.show_username ? u.username : null,
    photo: u.photo_url || null,
    faculty: u.faculty,
    level: u.level,
    course: u.course,
  };
}

/** Для постов и комментариев: поля автора приходят из JOIN с префиксом a_. */
export function authorFromRow(row) {
  return publicUser({
    id: row.a_id,
    first_name: row.a_first_name,
    last_name: row.a_last_name,
    username: row.a_username,
    show_username: row.a_show_username,
    photo_url: row.a_photo_url,
    faculty: row.a_faculty,
    level: row.a_level,
    course: row.a_course,
  });
}

export const AUTHOR_COLUMNS = `u.id AS a_id, u.first_name AS a_first_name, u.last_name AS a_last_name,
  u.username AS a_username, u.show_username AS a_show_username, u.photo_url AS a_photo_url,
  u.faculty AS a_faculty, u.level AS a_level, u.course AS a_course`;

export function selfView(user) {
  return {
    ...publicUser(user),
    username: user.username,
    bio: user.bio || "",
    show_username: !!user.show_username,
    notify: !!user.notify,
    can_dm: !!user.can_dm,
    admin: !!user.admin,
    banned_until: user.banned_until > now() ? user.banned_until : 0,
    ban_reason: user.banned_until > now() ? user.ban_reason : null,
  };
}

export async function getMe(env, user, url) {
  const unread = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND created_at > ?"
  )
    .bind(user.id, user.notif_seen_at)
    .first("n");
  return {
    me: selfView(user),
    unread,
    config: {
      bot: env.BOT_USERNAME || null,
      app: env.APP_NAME || null,
      origin: url.origin,
    },
  };
}

export async function updateMe(env, user, body) {
  const set = {};

  if ("faculty" in body || "level" in body || "course" in body) {
    const faculty = String(body.faculty ?? user.faculty ?? "");
    const level = String(body.level ?? user.level ?? "");
    if (!FACULTY[faculty]) fail(400, "Выберите факультет");
    if (!LEVEL[level]) fail(400, "Выберите ступень");
    let course = null;
    if (LEVEL[level].years) {
      course = Number(body.course ?? user.course);
      if (!Number.isInteger(course) || course < 1 || course > LEVEL[level].years) fail(400, "Выберите курс");
    }
    Object.assign(set, { faculty, level, course });
  }

  if ("bio" in body) {
    const bio = cleanText(body.bio).replace(/\s+/g, " ");
    if (charCount(bio) > LIMITS.bio) fail(400, `О себе — не длиннее ${LIMITS.bio} знаков`);
    set.bio = bio || null;
  }
  if ("show_username" in body) {
    set.show_username = body.show_username ? 1 : 0;
    set.search = userSearchKey({ ...user, show_username: set.show_username });
  }
  if ("notify" in body) set.notify = body.notify ? 1 : 0;

  const keys = Object.keys(set);
  if (keys.length) {
    await env.DB.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
      .bind(...keys.map((k) => set[k]), user.id)
      .run();
    Object.assign(user, set);
  }
  return { me: selfView(user) };
}

export async function getProfile(env, viewerUser, id) {
  const u = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  if (!u) fail(404, "Такого человека нет");
  // Анонимные посты в счётчик не входят: иначе по разнице между числом и
  // видимым списком можно было бы вычислить, что человек пишет анонимно.
  const stats = await env.DB.prepare(
    `SELECT COUNT(*) AS posts, COALESCE(SUM(likes), 0) AS likes
     FROM posts WHERE author_id = ? AND anonymous = 0 AND hidden = 0`
  )
    .bind(u.id)
    .first();
  return {
    user: { ...publicUser(u), bio: u.bio || "", created_at: u.created_at },
    stats,
    self: u.id === viewerUser.id,
  };
}
