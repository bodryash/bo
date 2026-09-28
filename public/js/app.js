/**
 * Точка входа: Telegram, кто я, маршруты, нижние вкладки.
 */

import { refreshMe, store } from "./api.js";
import { composeScreen } from "./compose.js";
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
            btn.classList.remove("bounce");
            void btn.offsetWidth;
            btn.classList.add("bounce");
            go(path);
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
