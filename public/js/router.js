/**
 * Навигация по адресу после «#». Вкладки (лента, поиск, уведомления,
 * профиль) создаются один раз и живут всё время: вернулся — лента на том же
 * месте. Остальные экраны (пост, чужой профиль, новый пост) собираются
 * заново при каждом открытии.
 *
 * Экран — объект { el, onShow?, onHide?, onReselect?, destroy? }.
 *
 * В демо история живёт в памяти: встроенное окно, в котором оно открыто,
 * может не дать менять адрес страницы.
 */

import { reducedMotion, swipeX } from "./gestures.js";
import { backButton, insideTelegram, vibrate } from "./tg.js";
import { h, icon } from "./ui.js";

const routes = [];
const tabScreens = new Map();
let current = null; // { key, screen, tab }
let depth = 0;
let guard = null;
// Куда идёт переход: forward — вглубь, back — назад, из жеста — экран уже
// уехал под пальцем, досматривать анимацию не нужно.
let direction = "forward";
let lastTab = null;
const DURATION = 280;

const memory = !!window.POTOK_DEMO;
const stack = ["/"];

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

export function currentPath() {
  if (memory) return stack[stack.length - 1];
  return decodeURIComponent(location.hash.replace(/^#/, "")) || "/";
}

function replacePath(path) {
  if (memory) stack[stack.length - 1] = path;
  else history.replaceState(null, "", "#" + path);
}

export function go(path, { replace = false } = {}) {
  if (path === currentPath()) {
    if (current?.screen.onReselect) current.screen.onReselect();
    return;
  }
  direction = "forward";
  if (replace) {
    replacePath(path);
    render();
  } else if (memory) {
    stack.push(path);
    render();
  } else {
    depth++;
    location.hash = "#" + path;
  }
}

export function back({ gesture = false } = {}) {
  direction = gesture ? "gesture" : "back";
  if (memory) {
    if (stack.length > 1) stack.pop();
    else stack[0] = "/";
    render();
  } else if (depth > 0) {
    depth--;
    history.back();
  } else {
    go("/", { replace: true });
  }
}

/** Куда открыться при запуске — например, пост из ссылки «поделиться». */
export function setInitialPath(path) {
  replacePath(path);
}

let root;
let onChange = () => {};

export function start(container, changed) {
  root = container;
  onChange = changed;
  if (!memory) window.addEventListener("hashchange", render);
  render();
}

function render() {
  let path = currentPath();
  const redirect = guard?.(path);
  if (redirect && redirect !== path) {
    replacePath(redirect);
    path = redirect;
  }

  let match = null;
  let params = {};
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      match = r;
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      break;
    }
  }
  if (!match) {
    replacePath("/");
    return render();
  }

  const prev = current;
  const dir = direction;
  direction = "forward";
  const animate = prev && !reducedMotion();

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
    screen.el.hidden = false;
    screen.el.classList.remove("under");
    lastTab = screen;
  } else {
    screen = match.factory(params);
    isNew = true;
    screen.el.classList.add("screen", "pushed");
    // Вне Telegram его кнопки «назад» нет — рисуем свою полосу сверху.
    if (!insideTelegram && !OWN_BACK.has(path)) {
      screen.el.prepend(h("div.backbar", h("button", { onclick: () => back() }, icon("back"), "Назад")));
    }
    root.append(screen.el);
    edgeSwipe(screen);
  }

  if (prev && prev.screen !== screen) {
    prev.screen.onHide?.();
    const el = prev.screen.el;
    // hidden сбрасывает прокрутку — запоминаем её до того, как спрятать.
    if (prev.tab) prev.screen.savedScroll = el.scrollTop;
    const leave = () => {
      el.classList.remove("leaving-back", "leaving-under");
      el.style.transform = el.style.transition = el.style.boxShadow = "";
      if (prev.tab) {
        if (current?.screen !== prev.screen) el.hidden = true;
      } else {
        prev.screen.destroy?.();
        el.remove();
      }
    };
    if (!animate || dir === "gesture" || (prev.tab && match.tab)) {
      leave();
    } else {
      // Уходящий экран: назад — уезжает вправо поверх; вперёд — остаётся
      // под новым и чуть сдвигается, как в iOS.
      el.classList.add(dir === "back" ? "leaving-back" : "leaving-under");
      setTimeout(leave, DURATION);
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
  screen.onShow?.(params);

  backButton(match.tab ? null : back);
  onChange({ path, tab: match.tab ? match.pattern : null });
}

/** Вернуть кнопку «назад» после того, как её временно забрал просмотр фото. */
export function refreshBackButton() {
  backButton(current && !current.tab ? back : null);
}

/**
 * Свайп от левого края — назад, как в iOS: экран едет за пальцем, а под
 * ним уже видна вкладка, откуда пришли. Отпустил рано — экран вернулся.
 */
function edgeSwipe(screen) {
  if (currentPath() === "/onboarding") return;
  const el = screen.el;
  const reveal = (on) => {
    if (!lastTab || lastTab.el === el) return;
    lastTab.el.hidden = !on;
    lastTab.el.classList.toggle("under", on);
    if (on && lastTab.savedScroll) lastTab.el.scrollTop = lastTab.savedScroll;
  };
  swipeX(el, {
    edgeOnly: true,
    resist: 0,
    move: () => {
      reveal(true);
      return el;
    },
    onCancel: () => setTimeout(() => current?.screen === screen && reveal(false), 280),
    onSwipe: () => {
      vibrate("light");
      el.style.transition = "transform .2s ease-out";
      el.style.transform = "translateX(100%)";
      setTimeout(() => back({ gesture: true }), 190);
    },
  });
}
