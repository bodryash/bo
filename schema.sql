-- Схема базы D1. Создать с нуля:
--   npx wrangler d1 execute potok --remote --file schema.sql
-- Все времена — секунды Unix.

-- id — свой, а не из Telegram: он виден в адресах профилей, и по нему
-- нельзя было бы написать человеку в обход его настроек.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT,
  username TEXT,
  photo_url TEXT,
  faculty TEXT,                         -- код из data.js; NULL — ещё не заполнил
  level TEXT,
  course INTEGER,
  bio TEXT,
  show_username INTEGER NOT NULL DEFAULT 1,
  notify INTEGER NOT NULL DEFAULT 1,    -- присылать уведомления в бота
  can_dm INTEGER NOT NULL DEFAULT 0,    -- бот может писать: человек нажал /start
  created_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL,
  notif_seen_at INTEGER NOT NULL DEFAULT 0,
  pushed_at INTEGER NOT NULL DEFAULT 0, -- последнее уведомление в бота
  banned_until INTEGER NOT NULL DEFAULT 0,
  ban_reason TEXT,
  search TEXT                           -- имя и ник строчными: SQLite не знает регистр кириллицы
);
CREATE INDEX IF NOT EXISTS users_username ON users (username COLLATE NOCASE);

-- scope — чья это лента: код факультета или 'msu' для всего университета.
-- hidden: 0 — виден, 1 — скрыт жалобами до решения модератора, 2 — удалён.
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL,
  anonymous INTEGER NOT NULL DEFAULT 0,
  scope TEXT NOT NULL,
  rubric TEXT NOT NULL,
  text TEXT NOT NULL,
  price INTEGER,
  event_at INTEGER,
  place TEXT,
  poll TEXT,                            -- JSON-массив вариантов или NULL
  closed INTEGER NOT NULL DEFAULT 0,    -- продано, нашлось, сосед найден
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  search TEXT                           -- текст строчными, ё → е: для поиска
);
CREATE INDEX IF NOT EXISTS posts_scope ON posts (scope, hidden, id DESC);
CREATE INDEX IF NOT EXISTS posts_rubric ON posts (scope, rubric, hidden, id DESC);
CREATE INDEX IF NOT EXISTS posts_author ON posts (author_id, id DESC);
CREATE INDEX IF NOT EXISTS posts_events ON posts (rubric, event_at);

-- Фото грузятся до поста, поэтому post_id сначала пустой. Незакреплённые
-- сутки спустя удаляет задача по расписанию — вместе с файлом в R2.
-- tg_* — где файл лежит в Telegram (канал-склад); пусто, если фото в R2.
CREATE TABLE IF NOT EXISTS media (
  key TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  post_id INTEGER,
  pos INTEGER NOT NULL DEFAULT 0,
  w INTEGER NOT NULL,
  h INTEGER NOT NULL,
  tg_file_id TEXT,
  tg_chat_id INTEGER,
  tg_msg_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS media_post ON media (post_id, pos);
CREATE INDEX IF NOT EXISTS media_orphans ON media (created_at) WHERE post_id IS NULL;
-- Суточный лимит загрузок считается по автору: без индекса каждая
-- загрузка перебирала бы все фото подряд.
CREATE INDEX IF NOT EXISTS media_owner ON media (owner_id, created_at);

-- Настройки, которые бот узнаёт сам: например, канал-склад для фото.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS likes (
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS votes (
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  option INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

-- anon_no — «Аноним 3» внутри одного поста: один и тот же человек под
-- одним номером, чтобы разговор можно было читать. 0 — автор поста.
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  author_id INTEGER NOT NULL,
  anonymous INTEGER NOT NULL DEFAULT 0,
  anon_no INTEGER,
  reply_to INTEGER,
  text TEXT NOT NULL,
  reports INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_post ON comments (post_id, id);
CREATE INDEX IF NOT EXISTS comments_author ON comments (author_id, created_at);

-- target — 'p:12' или 'c:34'. Одна жалоба от человека на одну цель.
CREATE TABLE IF NOT EXISTS reports (
  target TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (target, user_id)
);
CREATE INDEX IF NOT EXISTS reports_user ON reports (user_id, created_at);

-- kind: comment — ответ на пост, reply — ответ на комментарий,
-- like — лайки поста одной строкой со счётчиком, а не строка на каждый,
-- follow — подписка (post_id = 0: поста тут нет).
-- actor_id не отдаётся, если действие анонимное.
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  post_id INTEGER NOT NULL,
  comment_id INTEGER,
  actor_id INTEGER,
  anonymous INTEGER NOT NULL DEFAULT 0,
  count INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_like ON notifications (user_id, post_id) WHERE kind = 'like';

-- Подписки: кто на кого подписан. Лента «Подписки» — открытые посты тех,
-- на кого подписан человек (анонимные туда не попадают никогда).
CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL,
  followee_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS follows_followee ON follows (followee_id, created_at DESC);
