/**
 * Карточка поста — одна и та же в ленте, в поиске, в профиле и на
 * странице поста. В ленте длинный текст сворачивается, на странице — нет.
 */

import { api, imageUrl, postCache, postLink, store } from "./api.js";
import { FACULTY, LIMITS, REPORT_REASONS, RUBRIC, studentLine } from "./data.js";
import { go } from "./router.js";
import { haptic, openLink } from "./tg.js";
import { actionSheet, ago, avatar, confirmDialog, eventBadge, eventDate, formatPrice, h, icon, plural, richText, tick, toast } from "./ui.js";
import { openViewer } from "./viewer.js";
import { editSheet, editedMark, modActions, removalText, shieldButton } from "./modtools.js";
import { bump, heartBurst, pressable } from "./gestures.js";

const CLOSED_LABEL = { market: "Продано", lost: "Нашлось", housing: "Уже не актуально" };

export function postCard(post, { full = false, showScope = false, onRemove, onChange, index = 0, appear = true } = {}) {
  postCache.set(post.id, post);
  const card = h("article.post" + (appear ? ".appear" : ""), { dataset: { id: post.id }, style: { "--i": Math.min(index, 8) } });
  // Перерисовать на месте — после правки или «Продано».
  const redraw = (next) => {
    const fresh = postCard(next, { full, showScope, onRemove, onChange, appear: false });
    card.replaceWith(fresh);
    onChange?.(next, fresh);
  };
  // Модератор удалил из ленты — карточка сжимается и исчезает.
  const removed = () => {
    card.classList.add("leaving");
    setTimeout(() => card.remove(), 260);
    onRemove?.();
  };
  if (post.closed) card.classList.add("closed");
  if (post.hidden === 2) card.classList.add("deleted");
  if (!full) card.classList.add("tappable");
  // Касание — открыть пост, двойное — лайк с сердцем, долгое — меню.
  pressable(card, {
    ignore: "button, a, .poll, input, textarea",
    onTap: full ? null : (e) => !e.target.closest(".media") && go(`/p/${post.id}`),
    onDoubleTap: (e) => {
      if (post.hidden) return;
      heartBurst(card, e.clientX, e.clientY);
      if (!post.liked) card.querySelector(".act.like")?.click();
      else haptic.tap();
    },
    onLongPress: () => postMenu(post, { card, redraw, removed }),
  });

  card.append(header(post, { showScope, card, redraw, removed }));
  if (post.mod_author) card.append(modAuthor(post.mod_author));
  if (post.removal) card.append(removalNotice(post));
  else if (post.hidden === 1) card.append(h("div.notice.warn", "Пост скрыт жалобами и ждёт решения модератора. Остальным он не виден."));
  if (post.rubric === "event" && post.event_at) card.append(eventBlock(post));
  if (post.rubric === "market" && post.price !== null) card.append(h("div.price", formatPrice(post.price)));
  if (post.closed) card.append(h("div.closed-badge", icon("check"), CLOSED_LABEL[post.rubric] || "Закрыто"));

  if (post.text) {
    const text = h("div.post-text", richText(post.text));
    card.append(text);
    if (!full) clampText(text);
  }
  if (post.media.length) card.append(mediaGrid(post.media));
  if (post.poll) card.append(pollBlock(post));
  card.append(actions(post, { full }));
  return card;
}

function header(post, { showScope, card, redraw, removed }) {
  const rubric = RUBRIC[post.rubric];
  const who = post.author;
  const line = [];
  if (who) line.push(studentLine(who));
  // Куда написан пост — только если это что-то добавляет: у анонима это
  // единственная подсказка, а у автора со своего факультета — повтор.
  if (!who || (showScope && post.scope !== who.faculty)) {
    line.push(post.scope === "msu" ? "весь МГУ" : FACULTY[post.scope]?.short);
  }
  line.push(ago(post.created_at));

  const name = who ? who.name : "Аноним";
  const admin = store.me?.admin && !post.mine;
  const headerEl = h(
    "header.post-head",
    h(
      "button.post-author",
      { onclick: () => who && go(`/u/${who.id}`), disabled: !who },
      avatar(who, 40),
      h(
        "div.post-meta",
        h("div.post-name", h("span.name-text", name), tick(who), post.mine && !who ? h("span.me-tag", "это вы") : null),
        h("div.post-sub", line.filter(Boolean).join(" · "))
      )
    ),
    h("span.rubric-tag", { dataset: { rubric: post.rubric } }, rubric ? `${rubric.emoji} ${rubric.name}` : ""),
    // Щит — модератору прямо в ленте: бан, удаление, кто за анонимкой.
    admin ? shieldButton(() => postModeration(post, removed, redraw)) : null,
    h("button.icon-btn.more", { "aria-label": "Ещё", onclick: () => postMenu(post, { card, redraw, removed }) }, icon("more"))
  );
  return headerEl;
}

/**
 * Автор анонимки — только на экране модератора. Остальным это поле
 * сервер вообще не присылает.
 */
export function modAuthor(author) {
  return h(
    "button.mod-reveal",
    { onclick: (e) => (e.stopPropagation(), go(`/u/${author.id}`)) },
    icon("shield"),
    h("span", "Видно модератору: "),
    h("b", author.name),
    author.faculty ? h("span", " · " + studentLine(author)) : null
  );
}

/** Модератору на удалённом посте: кто и когда. */
function removalNotice(post) {
  const r = post.removal;
  const by = r.by ? ` · ${r.by.name}` : "";
  return h(
    "div.notice." + (r.kind === "hide" ? "warn" : "danger"),
    icon(r.kind === "hide" ? "flag" : "trash"),
    h("span", `${removalText(r.kind, r.note)}${by}${r.at ? " · " + ago(r.at) : ""}. Видно только модераторам.`)
  );
}

function postModeration(post, removed, redraw) {
  modActions({
    target: `p:${post.id}`,
    author: post.author || post.mod_author,
    edited: post.edited,
    hidden: post.hidden,
    // В ленте удалённое исчезает; на экране поста модератор остаётся и
    // видит плашку «Удалён» — там перерисовываем со свежими данными.
    onRemoved: removed,
    onRestored: () => api.get(`/api/posts/${post.id}`).then((d) => redraw(d.post), () => {}),
  });
}

function eventBlock(post) {
  const { day, month } = eventBadge(post.event_at);
  const past = post.event_at < Date.now() / 1000 - 3 * 3600;
  return h(
    "div.event" + (past ? ".past" : ""),
    h("div.event-date", h("b", day), h("span", month)),
    h(
      "div.event-info",
      h("div.event-when", icon("calendar"), past ? "прошло · " + eventDate(post.event_at) : eventDate(post.event_at)),
      post.place ? h("div.event-where", icon("pin"), post.place) : null
    )
  );
}

/** Длинный текст в ленте — первые строки и «Показать полностью». */
function clampText(el) {
  el.classList.add("clamped");
  requestAnimationFrame(() => {
    if (el.scrollHeight <= el.clientHeight + 2) {
      el.classList.remove("clamped");
      return;
    }
    const more = h(
      "button.more-text",
      {
        onclick: (e) => {
          e.stopPropagation();
          el.classList.remove("clamped");
          more.remove();
        },
      },
      "Показать полностью"
    );
    el.after(more);
  });
}

/** Сетка фото: одно — во всю ширину по пропорциям, больше — плиткой. */
export function mediaGrid(media) {
  const count = media.length;
  const grid = h("div.media", { dataset: { count: Math.min(count, 4) } });
  const shown = count > 4 ? media.slice(0, 4) : media;
  shown.forEach((m, i) => {
    const cell = h("button.media-cell", { onclick: (e) => (e.stopPropagation(), openViewer(media, i)) });
    if (count === 1) {
      // Пропорции ограничены: сверхвысокий скриншот не должен занимать
      // три экрана ленты, а панорама — превращаться в полоску.
      const ratio = Math.min(Math.max(m.w / m.h, 0.75), 1.9);
      cell.style.aspectRatio = String(ratio);
    }
    cell.append(h("img", { src: imageUrl(m.key), alt: "", loading: "lazy", decoding: "async" }));
    if (i === 3 && count > 4) cell.append(h("div.media-more", `+${count - 4}`));
    grid.append(cell);
  });
  return grid;
}

/**
 * Опрос. До голоса — просто варианты; после — проценты и полоски.
 * Коснуться другого варианта — переголосовать, своего — отменить голос.
 */
function pollBlock(post) {
  const wrap = h("div.poll");
  const { options } = post.poll;
  // Строки создаются один раз и дальше только обновляются: полоски и
  // проценты перетекают к новым значениям, а не перерисовываются.
  const rows = options.map((text, i) => {
    const bar = h("div.poll-bar");
    const check = icon("check");
    const pct = h("span.poll-pct");
    const btn = h("button.poll-option", { onclick: (e) => (e.stopPropagation(), vote(i)) }, bar, h("span.poll-text", text, check), pct);
    return { btn, bar, check, pct };
  });
  const total = h("div.poll-total");
  wrap.append(...rows.map((r) => r.btn), total);

  const render = () => {
    const { counts, total: sum, mine } = post.poll;
    const voted = mine !== null;
    rows.forEach((r, i) => {
      const p = sum ? Math.round((counts[i] / sum) * 100) : 0;
      r.btn.classList.toggle("voted", voted);
      r.btn.classList.toggle("mine", mine === i);
      r.bar.style.width = voted ? `${p}%` : "0%";
      r.pct.textContent = voted ? `${p}%` : "";
      r.check.hidden = mine !== i;
    });
    total.replaceChildren(
      sum ? `${sum} ${plural(sum, "голос", "голоса", "голосов")}` : "Пока никто не голосовал",
      voted ? h("span.poll-hint", " · коснитесь своего варианта, чтобы отменить") : ""
    );
  };

  /**
   * Голос виден сразу: проценты пересчитываются на экране, запрос идёт
   * следом. Ответ сервера лишь уточняет числа; ошибка — откат.
   */
  async function vote(i) {
    const before = post.poll;
    const cancel = before.mine === i;
    haptic[cancel ? "tap" : "select"]();
    const counts = [...before.counts];
    if (before.mine !== null) counts[before.mine] = Math.max(0, counts[before.mine] - 1);
    if (!cancel) counts[i] += 1;
    post.poll = { ...before, counts, total: counts.reduce((a, b) => a + b, 0), mine: cancel ? null : i };
    render();
    if (cancel) toast("Голос отменён");

    const seq = (wrap.seq = (wrap.seq || 0) + 1);
    try {
      const res = await api.post(`/api/posts/${post.id}/vote`, { option: cancel ? null : i });
      // Пока шёл запрос, могли нажать ещё раз — тогда этот ответ устарел.
      if (seq === wrap.seq) {
        post.poll = res.poll;
        render();
      }
    } catch (err) {
      if (seq === wrap.seq) {
        post.poll = before;
        render();
      }
      haptic.error();
      toast(err.message, "error");
    }
  }

  render();
  return wrap;
}

function actions(post, { full }) {
  const likeCount = h("span", post.likes ? String(post.likes) : "");
  const like = h(
    "button.act.like" + (post.liked ? ".on" : ""),
    { "aria-label": "Нравится", onclick: (e) => (e.stopPropagation(), toggleLike()) },
    icon("heart"),
    likeCount
  );
  let busy = false;
  async function toggleLike() {
    if (busy) return;
    busy = true;
    haptic.tap();
    const on = !post.liked;
    // Сразу на экране, запрос — следом: лайк должен ощущаться мгновенным.
    post.liked = on;
    post.likes += on ? 1 : -1;
    like.classList.toggle("on", on);
    like.classList.remove("pop");
    void like.offsetWidth;
    like.classList.toggle("pop", on);
    likeCount.textContent = post.likes ? String(post.likes) : "";
    bump(likeCount);
    try {
      const res = await api.post(`/api/posts/${post.id}/like`, { on });
      post.likes = res.likes;
      likeCount.textContent = post.likes ? String(post.likes) : "";
    } catch (err) {
      post.liked = !on;
      post.likes += on ? -1 : 1;
      like.classList.toggle("on", !on);
      likeCount.textContent = post.likes ? String(post.likes) : "";
      toast(err.message, "error");
    } finally {
      busy = false;
    }
  }

  return h(
    "footer.post-actions",
    like,
    h(
      "button.act",
      { "aria-label": "Комментарии", onclick: (e) => (e.stopPropagation(), full ? document.querySelector(".composer textarea")?.focus() : go(`/p/${post.id}`)) },
      icon("comment"),
      h("span", post.comments ? String(post.comments) : "")
    ),
    h("div.spacer"),
    // В шапке места нет — «изменено» рядом с «Поделиться», как в Telegram.
    post.edited ? editedMark(`p:${post.id}`) : null,
    h("button.act", { "aria-label": "Поделиться", onclick: (e) => (e.stopPropagation(), share(post)) }, icon("share"))
  );
}

export function share(post) {
  const link = postLink(post.id);
  const text = (post.text || "").split("\n")[0].slice(0, 80);
  openLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
}

function postMenu(post, { card, redraw, removed }) {
  const closable = ["market", "lost", "housing"].includes(post.rubric);
  actionSheet([
    { label: "Поделиться", icon: "share", onClick: () => share(post) },
    {
      label: "Скопировать ссылку",
      icon: "reply",
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(postLink(post.id));
          toast("Ссылка скопирована");
        } catch {
          toast("Не получилось скопировать", "error");
        }
      },
    },
    post.mine &&
      !post.hidden && {
        label: "Редактировать",
        icon: "edit",
        onClick: () =>
          editSheet({
            title: "Правка поста",
            text: post.text,
            max: LIMITS.postText,
            onSave: async (text) => {
              const res = await api.post(`/api/posts/${post.id}/edit`, { text });
              redraw(res.post);
            },
          }),
      },
    post.mine &&
      closable && {
        label: post.closed ? "Снова актуально" : CLOSED_LABEL[post.rubric],
        icon: "check",
        onClick: async () => {
          try {
            const res = await api.post(`/api/posts/${post.id}/close`, { closed: !post.closed });
            redraw({ ...post, closed: res.closed });
          } catch (err) {
            toast(err.message, "error");
          }
        },
      },
    !post.mine && { label: "Пожаловаться", icon: "flag", onClick: () => reportSheet(`p:${post.id}`) },
    store.me?.admin && !post.mine && { label: "Модерация…", icon: "shield", onClick: () => postModeration(post, removed, redraw) },
    post.mine && {
      label: "Удалить пост",
      icon: "trash",
      danger: true,
      onClick: async () => {
        if (!(await confirmDialog("Удалить пост? Вернуть его будет нельзя."))) return;
        try {
          await api.post(`/api/posts/${post.id}/delete`);
          haptic.success();
          toast("Пост удалён");
          removed();
        } catch (err) {
          toast(err.message, "error");
        }
      },
    },
  ]);
}

export function reportSheet(target) {
  actionSheet(
    REPORT_REASONS.map((r) => ({
      label: r.name,
      onClick: async () => {
        try {
          await api.post("/api/report", { target, reason: r.id });
          haptic.success();
          toast("Спасибо! Модераторы посмотрят");
        } catch (err) {
          toast(err.message, "error");
        }
      },
    })),
    { title: "Что не так?" }
  );
}

export const myFacultyShort = () => FACULTY[store.me?.faculty]?.short || "Факультет";
