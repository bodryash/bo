/**
 * Точка входа: Telegram, кто я, маршруты, нижние вкладки.
 */

import { refreshMe, store } from "./api.js";
import { composeScreen } from "./compose.js";
import { modScreen } from "./mod.js";
import { battleScreen } from "./battle.js";
import { peopleScreen } from "./people.js";
import { composePath } from "./feed.js";
import { errorState, feedScreen } from "./feed.js";
import { notificationsScreen } from "./notifications.js";
import { onboardingScreen } from "./onboarding.js";
import { postScreen } from "./post.js";
import { profileScreen, settingsScreen } from "./profile.js";
import { currentPath, go, route, setGuard, setInitialPath, start } from "./router.js";
import { searchScreen } from "./search.js";
import { haptic, setup, startParam } from "./tg.js";
import { bump } from "./gestures.js";
import { h, icon } from "./ui.js";

setup();

/**
 * Клавиатура. Пока пишут — нижняя панель прячется (иначе она всплывает
 * над клавиатурой и закрывает текст). Когда клавиатура уходит, iOS
 * оставляет страницу сдвинутой, и нажатия по нижней панели попадают
 * мимо кнопок — возвращаем страницу на место.
 */
const isField = (el) => el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio", "file"].includes(el.type)));
document.addEventListener("focusin", (e) => {
  if (isField(e.target)) document.body.classList.add("typing");
});
document.addEventListener("focusout", () => {
  setTimeout(() => {
    if (isField(document.activeElement)) return;
    document.body.classList.remove("typing");
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = document.body.scrollTop = 0;
  }, 60);
});
window.Telegram?.WebApp?.onEvent?.("viewportChanged", (e) => {
  if (e?.isStateStable && !isField(document.activeElement)) window.scrollTo(0, 0);
});

// Отклик на любое нажатие: всё, что кнопка, — щёлкает. Если кнопка сама
// уже вибрировала (выбор, успех), повтор проглотит vibrate().
document.addEventListener(
  "click",
  (e) => {
    const target = e.target.closest("button, .tappable, a, label.switch");
    if (target && !target.disabled && !target.closest("[data-silent]")) haptic.tap();
  },
  true
);

const app = document.getElementById("app");
const screens = h("main.screens");
const tabbar = buildTabbar();

route("/", () => feedScreen(), { tab: true });
route("/search", () => searchScreen(), { tab: true });
route("/notif", () => notificationsScreen(), { tab: true });
route("/me", () => profileScreen(), { tab: true });
route("/new", () => composeScreen());
route("/new/:rubric", (p) => composeScreen(p));
route("/new/:rubric/:scope", (p) => composeScreen(p));
route("/mod", () => modScreen());
route("/battle", () => battleScreen());
route("/u/:id/:list", (p) => peopleScreen(p));
route("/p/:id", (p) => postScreen(p));
route("/p/:id/:comment", (p) => postScreen(p));
route("/u/:id", (p) => (Number(p.id) === store.me?.id ? profileScreen() : profileScreen(p)));
route("/f/:fac", (p) => feedScreen({ fixedScope: p.fac }));
route("/settings", () => settingsScreen());
route("/onboarding", () => onboardingScreen());

// Без факультета непонятно, какую ленту показывать, — сначала онбординг.
// Пост по ссылке открываем и так: посмотреть можно, писать — после.
setGuard((path) => {
  if (store.me?.faculty) return path === "/onboarding" ? "/" : null;
  if (path.startsWith("/p/") || path === "/onboarding") return null;
  return "/onboarding";
});

boot();

async function boot() {
  try {
    await refreshMe();
  } catch (err) {
    document.querySelector(".splash")?.remove();
    app.replaceChildren(h("div.screen.fatal", errorState(err, () => location.reload())));
    return;
  }

  // Пришли по ссылке «поделиться» — t.me/бот/приложение?startapp=p123.
  const start0 = /^p(\d+)$/.exec(startParam());
  if (start0 && currentPath() === "/") setInitialPath(`/p/${start0[1]}`);

  app.replaceChildren(screens, tabbar.el);
  start(screens, ({ tab }) => tabbar.paint(tab));
  document.querySelector(".splash")?.classList.add("gone");
  setTimeout(() => document.querySelector(".splash")?.remove(), 400);

  // Значок непрочитанного: при возвращении в приложение и раз в минуту.
  const poll = () => document.visibilityState === "visible" && refreshMe().catch(() => {});
  document.addEventListener("visibilitychange", poll);
  setInterval(poll, 60_000);
}

function buildTabbar() {
  const items = [
    ["/", "home", "Лента"],
    ["/search", "search", "Поиск"],
    ["/new", "plus", ""],
    ["/notif", "bell", "Ответы"],
    ["/me", "user", "Профиль"],
  ];
  const buttons = {};
  const badge = h("span.badge");
  const el = h(
    "nav.tabbar",
    items.map(([path, ic, label]) => {
      const btn = h(
        "button.tab" + (path === "/new" ? ".compose-tab" : ""),
        {
          "aria-label": label || "Новый пост",
          onclick: () => {
            haptic.select();
            if (isField(document.activeElement)) document.activeElement.blur();
            btn.classList.remove("bounce");
            void btn.offsetWidth;
            btn.classList.add("bounce");
            // «+» с ленты — сразу в ту рубрику и раздел, что открыты.
            go(path === "/new" && currentPath() === "/" ? composePath() : path);
          },
        },
        icon(ic),
        label ? h("span.tab-label", label) : null,
        path === "/notif" ? badge : null
      );
      buttons[path] = btn;
      return btn;
    })
  );

  let shown = store.unread;
  const paintBadge = () => {
    if (store.unread > shown) {
      bump(badge);
      haptic.tap();
    }
    shown = store.unread;
    badge.textContent = store.unread > 99 ? "99+" : store.unread ? String(store.unread) : "";
    badge.hidden = !store.unread;
  };
  store.subscribe(paintBadge);
  paintBadge();

  return {
    el,
    paint(tab) {
      el.hidden = !tab;
      document.body.classList.toggle("has-tabbar", !!tab);
      for (const [path, btn] of Object.entries(buttons)) btn.classList.toggle("on", path === tab);
    },
  };
}
