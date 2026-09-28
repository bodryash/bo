/**
 * Навигация. Вкладки (лента, поиск, уведомления, профиль) создаются один
 * раз и живут всё время: вернулся — лента на том же месте. Остальные
 * экраны (пост, чужой профиль, новый пост) собираются заново при каждом
 * открытии.
 *
 * История — свой стек, а не история браузера: у мини-приложения нет
 * браузерной кнопки «назад», а history.back() во встроенном окне Telegram
 * иногда не срабатывал — экран «зависал». Адрес после «#» только
 * отражает текущий экран (для ссылок и отладки).
 *
 * Экран — объект { el, onShow?, onHide?, onReselect?, destroy? }.
 */

import { EDGE, reducedMotion, swipeX } from "./gestures.js";
import { backButton, insideTelegram, vibrate } from "./tg.js";
import { h, icon } from "./ui.js";

const routes = [];
const tabScreens = new Map();
let current = null; // { key, screen, tab }
let guard = null;
let stack = ["/"];
// Куда идёт переход: forward — вглубь, back — назад, gesture — экран уже
// уехал под пальцем, досматривать анимацию не нужно.
let direction = "forward";
let lastTab = null;
let settleTimer = null;
const DURATION = 280;

export const TABS = ["/", "/search", "/notif", "/me"];

// Экраны, у которых своя кнопка отмены или куда «назад» не ведёт.
const OWN_BACK = new Set(["/new", "/settings", "/onboarding"]);

/** route("/p/:id", (params) => screen, { tab: true }) */
export function route(pattern, factory, opts = {}) {
  const keys = [];
  const re = new RegExp(
    "^" +
      pattern.replace(/:(\w+)/g, (_, k) => {
        keys.push(k);
        return "([^/]+)";
      }) +
      "$"
  );
  routes.push({ pattern, re, keys, factory, tab: !!opts.tab });
}

/** Пока guard возвращает путь, туда и отправляем — например, на онбординг. */
export function setGuard(fn) {
  guard = fn;
}

export const currentPath = () => stack[stack.length - 1];

export function go(path, { replace = false } = {}) {
  if (path === currentPath()) {
    current?.screen.onReselect?.();
    return;
  }
  direction = "forward";
  // Вкладка начинает стек заново: «назад» с вкладки никуда не ведёт.
  if (TABS.includes(path)) stack = [path];
  else if (replace) stack[stack.length - 1] = path;
  else stack.push(path);
  render();
}

export function back({ gesture = false } = {}) {
  direction = gesture ? "gesture" : "back";
  if (stack.length > 1) stack.pop();
  else stack = ["/"];
  render();
}

/** Куда открыться при запуске — пост из ссылки «поделиться» и т. п. */
export function setInitialPath(path) {
  stack = TABS.includes(path) ? [path] : ["/", path];
}

let root;
let onChange = () => {};
const memoryOnly = () => !!window.POTOK_DEMO;

export function start(container, changed) {
  root = container;
  onChange = changed;
  if (!memoryOnly() && stack.length === 1 && stack[0] === "/") {
    const fromHash = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (fromHash.startsWith("/") && fromHash !== "/") setInitialPath(fromHash);
  }
  render();
}

function reflectInUrl(path) {
  if (memoryOnly()) return;
  try {
    history.replaceState(null, "", "#" + path);
  } catch {}
}

function render() {
  let path = currentPath();
  const redirect = guard?.(path);
  if (redirect && redirect !== path) {
    stack[stack.length - 1] = redirect;
    path = redirect;
  }

  let match = null;
  const params = {};
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      match = r;
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      break;
    }
  }
  if (!match) {
    stack = ["/"];
    return render();
  }

  const prev = current;
  const dir = direction;
  direction = "forward";
  const animate = !!prev && !reducedMotion();

  let screen;
  let isNew = false;
  if (match.tab) {
    screen = tabScreens.get(match.pattern);
    if (!screen) {
      screen = match.factory(params);
      screen.el.classList.add("screen");
      tabScreens.set(match.pattern, screen);
      root.append(screen.el);
    }
    lastTab = screen;
  } else {
    screen = match.factory(params);
    isNew = true;
    screen.el.classList.add("screen", "pushed");
    screen.el.__screen = screen;
    // Вне Telegram его кнопки «назад» нет — рисуем свою полосу сверху.
    if (!insideTelegram && !OWN_BACK.has(path)) {
      screen.el.prepend(h("div.backbar", h("button", { onclick: () => back() }, icon("back"), "Назад")));
    }
    root.append(screen.el);
    if (path !== "/onboarding") swipeBack(screen);
  }
  screen.el.hidden = false;
  screen.el.classList.remove("under", "leaving-back", "leaving-under");
  screen.el.style.transform = screen.el.style.transition = screen.el.style.boxShadow = "";

  if (prev && prev.screen !== screen) {
    prev.screen.onHide?.();
    const el = prev.screen.el;
    // hidden сбрасывает прокрутку — запоминаем её до того, как спрятать.
    if (prev.tab) prev.screen.savedScroll = el.scrollTop;
    if (animate && dir !== "gesture" && !(prev.tab && match.tab)) {
      // Назад — уходящий уезжает вправо поверх; вперёд — остаётся под
      // новым и чуть сдвигается, как в iOS.
      el.classList.add(dir === "back" ? "leaving-back" : "leaving-under");
    }
  }

  if (animate) {
    const cls = match.tab && prev?.tab ? "enter-tab" : dir === "forward" && isNew ? "enter-push" : dir === "back" ? "enter-back" : "";
    if (cls) {
      screen.el.classList.add(cls);
      setTimeout(() => screen.el.classList.remove(cls), DURATION);
    }
  }

  const saved = match.tab ? screen.savedScroll : 0;
  current = { key: path, screen, tab: match.tab };
  if (match.tab && saved) screen.el.scrollTop = saved;
  for (const s of root.children) s.classList.toggle("current", s === screen.el);

  // Уходящие экраны убираем, когда доиграет анимация. Если за это время
  // успели перейти ещё раз — settle() всё равно наведёт порядок.
  clearTimeout(settleTimer);
  const leaving = animate && prev && prev.screen !== screen && dir !== "gesture" && !(prev.tab && match.tab);
  if (leaving) settleTimer = setTimeout(settle, DURATION);
  else settle();

  screen.onShow?.(params);
  reflectInUrl(path);
  backButton(match.tab ? null : () => back());
  onChange({ path, tab: match.tab ? match.pattern : null });
}

/**
 * Порядок на экране: виден ровно один экран — текущий. Все вкладки,
 * кроме него, спрятаны; все прочие экраны удалены. Раньше после жеста
 * «назад» вкладка-подложка иногда оставалась видимой поверх текущей, и
 * казалось, что приложение зависло: нажатия шли, а экран не менялся.
 */
function settle() {
  if (!current) return;
  const tabs = [...tabScreens.values()];
  for (const s of tabs) {
    s.el.classList.remove("leaving-back", "leaving-under", "under");
    if (s !== current.screen) {
      s.el.hidden = true;
      s.el.style.transform = s.el.style.transition = s.el.style.boxShadow = "";
    }
  }
  for (const el of [...root.children]) {
    if (el === current.screen.el || tabs.some((s) => s.el === el)) continue;
    el.__screen?.destroy?.();
    el.remove();
  }
}

/**
 * Свайп вправо — назад, как в Telegram: с любого места экрана, экран едет
 * за пальцем, под ним уже видна вкладка, откуда пришли. Где свайп вбок
 * занят своим делом (лента листает рубрики) — только от левого края.
 */
function swipeBack(screen) {
  const el = screen.el;
  const reveal = (on) => {
    if (!lastTab || lastTab.el === el || current?.screen !== screen) return;
    lastTab.el.hidden = !on;
    lastTab.el.classList.toggle("under", on);
    if (on && lastTab.savedScroll) lastTab.el.scrollTop = lastTab.savedScroll;
  };
  let armed = false;
  swipeX(el, {
    direction: "right",
    canStart: (x, target) => x < EDGE || !target.closest("[data-swipe], .photo-row, .chips, input, textarea"),
    move: () => {
      reveal(true);
      armed = false;
      return el;
    },
    onProgress: (dx) => {
      const ready = dx > innerWidth * 0.12;
      if (ready && !armed) vibrate("rigid");
      armed = ready;
    },
    onCancel: () => setTimeout(() => reveal(false), 320),
    onSwipe: () => {
      el.style.transition = "transform .2s ease-out";
      el.style.transform = "translateX(100%)";
      setTimeout(() => {
        if (current?.screen === screen) back({ gesture: true });
      }, 180);
    },
  });
}

/** Вернуть кнопку «назад» после того, как её временно забрал просмотр фото. */
export function refreshBackButton() {
  backButton(current && !current.tab ? () => back() : null);
}
