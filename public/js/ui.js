/**
 * Мелкие кирпичики интерфейса: создание элементов, иконки, время, аватары,
 * всплывающие подсказки и нижние листы. Никакого innerHTML с данными
 * пользователей — только textContent, поэтому текст поста не может
 * оказаться разметкой.
 */

import { insideTelegram, openLink, tg } from "./tg.js";

/** h("div.card.big", { onclick }, child, "текст", [дети]) */
export function h(tag, attrs, ...children) {
  const [name, ...classes] = tag.split(".");
  const el = document.createElement(name || "div");
  if (classes.length) el.className = classes.join(" ");
  if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className += (el.className ? " " : "") + value;
    else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key in el && typeof value !== "string") el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export const clear = (el) => {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
};

const ICONS = {
  home: '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.6 4-5.3 7.5-5.3s6.3 1.7 7.5 5.3"/>',
  heart:
    '<path d="M12 20s-7.5-4.6-7.5-10.1A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.5 2.3C19.5 15.4 12 20 12 20z"/>',
  comment: '<path d="M4.5 12a7.5 7 0 1 1 3.6 6l-3.6 1.3 1.1-3.3A6.8 6.8 0 0 1 4.5 12z"/>',
  share: '<path d="M12 4v11M7.5 8.5 12 4l4.5 4.5"/><path d="M6 12.5V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-6.5"/>',
  more: '<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  send: '<path d="M5 12 19.5 5 16 19.5l-4.2-5.3z"/><path d="m11.8 14.2 7.7-9.2"/>',
  image:
    '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3.5 2.5-2 4.5 4"/>',
  poll: '<path d="M5 19V11M12 19V5M19 19v-5"/>',
  mask:
    '<path d="M3.5 9.5c2.8-1.3 5.6-1.3 8.5 0 2.9-1.3 5.7-1.3 8.5 0 0 4-1.8 6.5-4.5 6.5-1.8 0-3-1.3-4-2.7-1 1.4-2.2 2.7-4 2.7-2.7 0-4.5-2.5-4.5-6.5z"/><circle cx="8" cy="11.5" r="1"/><circle cx="16" cy="11.5" r="1"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  pin: '<path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  edit: '<path d="M5 19h3.5L19 8.5 15.5 5 5 15.5z"/><path d="m13.5 7 3.5 3.5"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
  flag: '<path d="M6 21V4M6 4h11l-2 4 2 4H6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  reply: '<path d="M10 7 5 12l5 5"/><path d="M5.5 12H14a5 5 0 0 1 5 5v1"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  shield: '<path d="M12 3.5 5 6v5.5c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  refresh: '<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19.5 4.5v4h-4"/>',
  telegram: '<path d="m4 11.5 15.5-6-2.6 13.2-5-3.9-2.6 2.5.4-4 7-6.3-8.8 5.2z"/>',
};

export function icon(name, cls = "") {
  const span = document.createElement("span");
  span.className = "icon" + (cls ? " " + cls : "");
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
  return span;
}

// ——— время ———

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTHS_FULL = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

const pad = (n) => String(n).padStart(2, "0");
const hm = (d) => `${d.getHours()}:${pad(d.getMinutes())}`;

/** «только что», «5 мин», «3 ч», «вчера в 14:05», «12 окт», «12 окт 2025». */
export function ago(ts) {
  const d = new Date(ts * 1000);
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин`;
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() / 1000;
  if (ts >= startOfToday) return `${Math.floor(diff / 3600)} ч`;
  if (ts >= startOfToday - 86400) return `вчера в ${hm(d)}`;
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === today.getFullYear() ? date : `${date} ${d.getFullYear()}`;
}

/** «сб, 12 октября · 19:00», а для ближайших — «сегодня · 19:00». */
export function eventDate(ts) {
  const d = new Date(ts * 1000);
  const today = new Date();
  const dayDiff = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) /
      86400000
  );
  const day =
    dayDiff === 0 ? "сегодня" : dayDiff === 1 ? "завтра" : `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_FULL[d.getMonth()]}`;
  return `${day} · ${hm(d)}`;
}

export function eventBadge(ts) {
  const d = new Date(ts * 1000);
  return { day: d.getDate(), month: MONTHS[d.getMonth()] };
}

export function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const formatPrice = (n) => (n === 0 ? "Даром" : `${n.toLocaleString("ru-RU")} ₽`);

// ——— аватары ———

// Семь пар цветов, как у Telegram: цвет выбирается по id, поэтому у
// человека он один и тот же везде.
const AVATAR_COLORS = [
  ["#ff885e", "#ff516a"],
  ["#ffcd6a", "#ffa85c"],
  ["#82b1ff", "#665fff"],
  ["#a0de7e", "#54cb68"],
  ["#53edd6", "#28c9b7"],
  ["#72d5fd", "#2a9ef1"],
  ["#e0a2f3", "#d669ed"],
];

export function avatar(user, size = 40) {
  const el = h("div.avatar", { style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.4)}px` } });
  if (!user) {
    el.classList.add("anon");
    el.append(icon("mask"));
    return el;
  }
  const [a, b] = AVATAR_COLORS[Math.abs(user.id || 0) % AVATAR_COLORS.length];
  el.style.background = `linear-gradient(180deg, ${a}, ${b})`;
  const initials = (user.name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => [...w][0] || "")
    .join("")
    .toUpperCase();
  el.append(h("span", initials));
  if (user.photo) {
    const img = h("img", { src: user.photo, alt: "", loading: "lazy", referrerPolicy: "no-referrer" });
    img.onerror = () => img.remove();
    el.append(img);
  }
  return el;
}

// ——— текст ———

const URL_RE = /\bhttps?:\/\/[^\s<>"«»]+[^\s<>"«».,:;!?)\]]/gi;

/** Текст с кликабельными ссылками — без innerHTML. */
export function richText(text) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of String(text).matchAll(URL_RE)) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    const url = m[0];
    const a = h("a", { href: url, rel: "noopener", target: "_blank" }, prettyUrl(url));
    a.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openLink(url);
    });
    frag.append(a);
    last = m.index + url.length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

function prettyUrl(url) {
  const short = url.replace(/^https?:\/\/(www\.)?/, "");
  return short.length > 40 ? short.slice(0, 38) + "…" : short;
}

// ——— всплывающее ———

let toastTimer;
export function toast(message, kind = "") {
  let el = document.querySelector(".toast");
  if (!el) {
    el = h("div.toast");
    document.body.append(el);
  }
  el.textContent = message;
  el.className = "toast show" + (kind ? " " + kind : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

/**
 * Нижний лист. content — элемент или функция (close) => элемент.
 * Возвращает функцию закрытия.
 */
export function sheet(content, { title, onClose } = {}) {
  const backdrop = h("div.sheet-backdrop");
  const panel = h("div.sheet", { role: "dialog" });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    onClose?.();
    backdrop.classList.remove("open");
    panel.classList.remove("open");
    document.removeEventListener("keydown", onKey);
    setTimeout(() => {
      backdrop.remove();
      panel.remove();
    }, 220);
  };
  const onKey = (e) => e.key === "Escape" && close();
  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", onKey);

  panel.append(h("div.sheet-grip"));
  if (title) panel.append(h("div.sheet-title", title));
  panel.append(typeof content === "function" ? content(close) : content);
  document.body.append(backdrop, panel);
  requestAnimationFrame(() => {
    backdrop.classList.add("open");
    panel.classList.add("open");
  });
  return close;
}

/** Меню действий: [{ label, icon, danger, onClick }]. */
export function actionSheet(actions, opts) {
  return sheet(
    (close) =>
      h(
        "div.actions",
        h(
          "div.actions-group",
          actions.filter(Boolean).map((a) =>
            h(
              "button.action" + (a.danger ? ".danger" : ""),
              {
                onclick: () => {
                  close();
                  a.onClick();
                },
              },
              a.icon ? icon(a.icon) : null,
              h("span", a.label)
            )
          )
        ),
        h("button.action.cancel", { onclick: close }, "Отмена")
      ),
    opts
  );
}

export function spinner() {
  return h("div.spinner", h("div"));
}

export function emptyState(emoji, title, text, action) {
  return h("div.empty", h("div.empty-emoji", emoji), h("div.empty-title", title), text ? h("div.empty-text", text) : null, action || null);
}

/** Текстовое поле, растущее вместе с текстом. */
export function autoGrow(textarea, max = 220) {
  const fit = () => {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, max) + "px";
  };
  textarea.addEventListener("input", fit);
  requestAnimationFrame(fit);
  return fit;
}

/** Переключатель в стиле iOS. */
export function toggle(checked, onChange) {
  const input = h("input", { type: "checkbox", checked });
  input.addEventListener("change", () => onChange(input.checked));
  return h("label.switch", input, h("span"));
}

/**
 * Подтверждение. В Telegram — его родное окно; вне его — нижний лист:
 * window.confirm во встроенных окнах браузера часто молча отвечает «нет».
 */
export function confirmDialog(message, { ok = "Удалить", danger = true } = {}) {
  if (insideTelegram && tg.isVersionAtLeast?.("6.2")) {
    return new Promise((resolve) => tg.showConfirm(message, resolve));
  }
  return new Promise((resolve) => {
    let answer = false;
    sheet(
      (close) =>
        h(
          "div.actions",
          h("div.confirm-text", message),
          h(
            "div.actions-group",
            h("button.action" + (danger ? ".danger" : ""), { onclick: () => ((answer = true), close()) }, h("span", ok))
          ),
          h("button.action.cancel", { onclick: close }, "Отмена")
        ),
      { onClose: () => resolve(answer) }
    );
  });
}

/**
 * Ползунок переключателя: переезжает под выбранный вариант, а не
 * перекрашивает кнопки. Вызывать после каждой отрисовки переключателя.
 */
export function syncThumb(seg) {
  let thumb = seg.querySelector(":scope > .seg-thumb");
  if (!thumb) {
    thumb = h("span.seg-thumb");
    seg.prepend(thumb);
  }
  const on = seg.querySelector(":scope > button.on");
  if (!on) return;
  const place = () => {
    thumb.style.width = `${on.offsetWidth}px`;
    thumb.style.transform = `translateX(${on.offsetLeft - 3}px)`;
  };
  if (!thumb.dataset.ready) {
    thumb.style.transition = "none";
    requestAnimationFrame(() => {
      place();
      requestAnimationFrame(() => {
        thumb.style.transition = "";
        thumb.dataset.ready = "1";
      });
    });
  } else place();
}

/** Знак Потока — тонкий чёрный «:П» на белом, в пару к «:P» расписания. */
export function logo(size = 32) {
  const el = document.createElement("span");
  el.className = "logo";
  el.style.width = el.style.height = `${size}px`;
  el.innerHTML =
    '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="18" fill="#fff"/>' +
    '<circle class="mk-dot" cx="20" cy="28.2" r="2.35" fill="#111"/><circle class="mk-dot mk-dot2" cx="20" cy="41.6" r="2.35" fill="#111"/>' +
    '<path class="mk-p" d="M28.9 44V21.6h16.4V44" fill="none" stroke="#111" stroke-width="3.2" stroke-linejoin="miter"/></svg>';
  return el;
}

/**
 * «Таблетка» выбранной рубрики: едет и тянется к новой кнопке. Кнопки
 * должны жить постоянно — переключается только класс .on.
 */
export function syncPill(container) {
  container.classList.add("has-pill");
  let pill = container.querySelector(":scope > .chip-pill");
  if (!pill) {
    pill = h("span.chip-pill");
    container.prepend(pill);
  }
  const on = container.querySelector(":scope > .chip.on");
  if (!on) {
    pill.style.opacity = "0";
    return;
  }
  const place = () => {
    pill.style.opacity = "1";
    pill.style.width = `${on.offsetWidth}px`;
    pill.style.height = `${on.offsetHeight}px`;
    pill.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`;
  };
  if (!pill.dataset.ready) {
    pill.style.transition = "none";
    requestAnimationFrame(() => {
      place();
      requestAnimationFrame(() => {
        pill.style.transition = "";
        pill.dataset.ready = "1";
      });
    });
  } else place();
}
