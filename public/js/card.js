/**
 * Карточка поста — одна и та же в ленте, в поиске, в профиле и на
 * странице поста. В ленте длинный текст сворачивается, на странице — нет.
 */

import { api, imageUrl, postLink, store } from "./api.js";
import { FACULTY, REPORT_REASONS, RUBRIC, studentLine } from "./data.js";
import { go } from "./router.js";
import { confirmDialog, haptic, openLink } from "./tg.js";
import { actionSheet, ago, avatar, eventBadge, eventDate, formatPrice, h, icon, plural, richText, toast } from "./ui.js";
import { openViewer } from "./viewer.js";

const CLOSED_LABEL = { market: "Продано", lost: "Нашлось", housing: "Уже не актуально" };

export function postCard(post, { full = false, showScope = false, onRemove } = {}) {
  const card = h("article.post", { dataset: { id: post.id } });
  if (post.closed) card.classList.add("closed");
  if (!full) {
    card.classList.add("tappable");
    card.addEventListener("click", (e) => {
      if (e.target.closest("button, a, .media, .poll")) return;
      go(`/p/${post.id}`);
    });
  }

  card.append(header(post, { showScope, onRemove, card }));
  if (post.hidden === 1) card.append(h("div.notice.warn", "Пост скрыт жалобами и ждёт решения модератора. Остальным он не виден."));
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

function header(post, { showScope, onRemove, card }) {
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
  const headerEl = h(
    "header.post-head",
    h(
      "button.post-author",
      { onclick: () => who && go(`/u/${who.id}`), disabled: !who },
      avatar(who, 40),
      h("div.post-meta", h("div.post-name", name, post.mine && !who ? h("span.me-tag", "это вы") : null), h("div.post-sub", line.filter(Boolean).join(" · ")))
    ),
    h("span.rubric-tag", { dataset: { rubric: post.rubric } }, rubric ? `${rubric.emoji} ${rubric.name}` : ""),
    h("button.icon-btn.more", { "aria-label": "Ещё", onclick: () => postMenu(post, { onRemove, card }) }, icon("more"))
  );
  return headerEl;
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

function pollBlock(post) {
  const wrap = h("div.poll");
  const render = () => {
    wrap.replaceChildren();
    const { options, counts, total, mine } = post.poll;
    const voted = mine !== null;
    options.forEach((text, i) => {
      const pct = total ? Math.round((counts[i] / total) * 100) : 0;
      const row = h(
        "button.poll-option" + (voted ? ".voted" : "") + (mine === i ? ".mine" : ""),
        {
          disabled: voted,
          onclick: async (e) => {
            e.stopPropagation();
            haptic.select();
            try {
              const res = await api.post(`/api/posts/${post.id}/vote`, { option: i });
              post.poll = res.poll;
              render();
            } catch (err) {
              toast(err.message, "error");
            }
          },
        },
        voted ? h("div.poll-bar", { style: { width: `${pct}%` } }) : null,
        h("span.poll-text", text, mine === i ? icon("check") : null),
        voted ? h("span.poll-pct", `${pct}%`) : null
      );
      wrap.append(row);
    });
    wrap.append(h("div.poll-total", total ? `${total} ${plural(total, "голос", "голоса", "голосов")}` : "Пока никто не голосовал"));
  };
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
    like.classList.toggle("pop", on);
    likeCount.textContent = post.likes ? String(post.likes) : "";
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
    h("button.act", { "aria-label": "Поделиться", onclick: (e) => (e.stopPropagation(), share(post)) }, icon("share"))
  );
}

export function share(post) {
  const link = postLink(post.id);
  const text = (post.text || "").split("\n")[0].slice(0, 80);
  openLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
}

function postMenu(post, { onRemove, card }) {
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
      closable && {
        label: post.closed ? "Снова актуально" : CLOSED_LABEL[post.rubric],
        icon: "check",
        onClick: async () => {
          try {
            const res = await api.post(`/api/posts/${post.id}/close`, { closed: !post.closed });
            post.closed = res.closed;
            card.replaceWith(postCard(post, { full: card.classList.contains("tappable") === false, onRemove }));
          } catch (err) {
            toast(err.message, "error");
          }
        },
      },
    !post.mine && { label: "Пожаловаться", icon: "flag", onClick: () => reportSheet(`p:${post.id}`) },
    post.can_delete && {
      label: post.mine ? "Удалить пост" : "Удалить (модератор)",
      icon: "trash",
      danger: true,
      onClick: async () => {
        if (!(await confirmDialog("Удалить пост? Вернуть его будет нельзя."))) return;
        try {
          await api.post(`/api/posts/${post.id}/delete`);
          haptic.success();
          toast("Пост удалён");
          card.remove();
          onRemove?.();
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
