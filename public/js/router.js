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

import { backButton, insideTelegram } from "./tg.js";
import { h, icon } from "./ui.js";

const routes = [];
const tabScreens = new Map();
let current = null; // { key, screen, tab }
let depth = 0;
let guard = null;

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

export function back() {
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

  if (current) {
    current.screen.onHide?.();
    if (current.tab) {
      // hidden сбрасывает прокрутку — запоминаем её до того, как спрятать.
      current.screen.savedScroll = current.screen.el.scrollTop;
      current.screen.el.hidden = true;
    } else {
      current.screen.destroy?.();
      current.screen.el.remove();
    }
  }

  let screen;
  if (match.tab) {
    screen = tabScreens.get(match.pattern);
    if (!screen) {
      screen = match.factory(params);
      screen.el.classList.add("screen");
      tabScreens.set(match.pattern, screen);
      root.append(screen.el);
    }
    screen.el.hidden = false;
  } else {
    screen = match.factory(params);
    screen.el.classList.add("screen", "pushed");
    // Вне Telegram его кнопки «назад» нет — рисуем свою полосу сверху.
    if (!insideTelegram && !OWN_BACK.has(path)) {
      screen.el.prepend(h("div.backbar", h("button", { onclick: back }, icon("back"), "Назад")));
    }
    root.append(screen.el);
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
