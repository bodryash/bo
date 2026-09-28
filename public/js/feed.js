import { api, store } from "./api.js";
import { myFacultyShort, postCard } from "./card.js";
import { FACULTY, RUBRICS } from "./data.js";
import { go } from "./router.js";
import { haptic } from "./tg.js";
import { emptyState, h, icon, spinner } from "./ui.js";

const PREFS_KEY = "feedPrefs";

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

const EMPTY = {
  "": ["🌱", "Здесь пока тихо", "Напишите первым — расскажите, что происходит на факультете."],
  talk: ["💬", "Пока ни слова", "Начните разговор."],
  study: ["📚", "Вопросов по учёбе нет", "Спросите про конспекты, билеты или преподавателя."],
  confess: ["🤫", "Никто ни в чём не признался", "Здесь пишут анонимно — даже модераторы в ленте не видят автора."],
  event: ["📅", "Ближайших событий нет", "Позовите всех на лекцию, квиз или вечеринку."],
  market: ["🛍", "Ничего не продают", "Учебники, техника, билеты — выложите, что не нужно."],
  lost: ["🔎", "Ничего не теряли", "Нашли пропуск или зарядку? Напишите сюда."],
  housing: ["🏠", "Объявлений о жилье нет", "Ищете соседа или комнату — начните здесь."],
};

/**
 * Лента. Вкладка — с выбором «мой факультет / весь МГУ»; чужой факультет
 * (fixedScope) открывается отдельным экраном без переключателя.
 */
export function feedScreen({ fixedScope = null } = {}) {
  const prefs = fixedScope ? { scope: fixedScope, rubric: "", sort: "new" } : { scope: "fac", rubric: "", sort: "new", ...loadPrefs() };

  const el = h("div.feed");
  const list = h("div.list");
  const sentinel = h("div.sentinel");
  const ptr = h("div.ptr", icon("refresh"));
  let next = null;
  let loading = false;
  let generation = 0;

  // ——— шапка ———
  const scopeBtns = {};
  const segmented = fixedScope
    ? null
    : h(
        "div.segmented",
        ["fac", "msu"].map((s) =>
          (scopeBtns[s] = h(
            "button",
            {
              onclick: () => {
                if (prefs.scope === s) return;
                haptic.select();
                prefs.scope = s;
                changed();
              },
            },
            s === "fac" ? myFacultyShort() : "Весь МГУ"
          ))
        )
      );

  const topbar = h(
    "div.topbar",
    fixedScope
      ? h("div.topbar-title", h("div.brand-small", FACULTY[fixedScope]?.short || ""), h("div.topbar-sub", FACULTY[fixedScope]?.name || ""))
      : h("div.brand", "Поток"),
    segmented
  );

  const chipBtns = {};
  const chips = h(
    "div.chips",
    [{ id: "", name: "Все", emoji: "" }, ...RUBRICS].map((r) =>
      (chipBtns[r.id] = h(
        "button.chip",
        {
          onclick: () => {
            if (prefs.rubric === r.id) return;
            haptic.select();
            prefs.rubric = r.id;
            // У событий свой порядок: ближайшие сверху.
            prefs.sort = r.id === "event" ? "soon" : prefs.sort === "soon" ? "new" : prefs.sort;
            changed();
            chipBtns[r.id].scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
          },
        },
        r.emoji ? r.emoji + " " : "",
        r.name
      ))
    )
  );

  const sortBtns = {};
  const sortbar = h("div.sortbar");
  function renderSort() {
    const options = prefs.rubric === "event" ? [["soon", "Скоро"], ["new", "Новые"]] : [["new", "Новое"], ["hot", "Горячее"]];
    sortbar.replaceChildren(
      ...options.map(([id, name]) =>
        (sortBtns[id] = h(
          "button" + (prefs.sort === id ? ".on" : ""),
          {
            onclick: () => {
              if (prefs.sort === id) return;
              haptic.select();
              prefs.sort = id;
              changed();
            },
          },
          name
        ))
      )
    );
  }

  el.append(ptr, topbar, chips, sortbar, list, sentinel);

  function paintControls() {
    for (const [s, b] of Object.entries(scopeBtns)) b.classList.toggle("on", prefs.scope === s);
    if (scopeBtns.fac) scopeBtns.fac.textContent = myFacultyShort();
    for (const [r, b] of Object.entries(chipBtns)) b.classList.toggle("on", prefs.rubric === r);
    renderSort();
  }

  function changed() {
    if (!fixedScope) savePrefs(prefs);
    paintControls();
    reload();
  }

  function query(cursor) {
    const p = new URLSearchParams({ scope: prefs.scope, sort: prefs.sort });
    if (prefs.rubric) p.set("rubric", prefs.rubric);
    if (cursor) p.set(prefs.sort === "new" ? "before" : "offset", cursor);
    return "/api/feed?" + p;
  }

  async function load(reset) {
    if (loading && !reset) return;
    const gen = reset ? ++generation : generation;
    loading = true;
    if (reset) {
      list.replaceChildren(skeleton(), skeleton());
      next = null;
    } else {
      sentinel.replaceChildren(spinner());
    }
    try {
      const data = await api.get(query(reset ? null : next));
      if (gen !== generation) return; // пока грузилось, переключили рубрику
      if (reset) list.replaceChildren();
      for (const post of data.posts) list.append(postCard(post));
      next = data.next;
      if (reset && !data.posts.length) list.append(empty());
      sentinel.replaceChildren(!next && list.querySelector(".post") ? h("div.end", "Это всё — дальше пусто") : "");
    } catch (err) {
      if (gen !== generation) return;
      if (reset) list.replaceChildren(errorState(err, () => load(true)));
      else sentinel.replaceChildren(h("button.link-btn", { onclick: () => load(false) }, "Не загрузилось — ещё раз"));
    } finally {
      if (gen === generation) loading = false;
    }
  }

  function reload() {
    load(true);
  }

  function empty() {
    const [emoji, title, text] = EMPTY[prefs.rubric] || EMPTY[""];
    const canWrite = !fixedScope || fixedScope === store.me?.faculty;
    return emptyState(emoji, title, text, canWrite ? h("button.btn", { onclick: () => go("/new") }, "Написать пост") : null);
  }

  // Подгрузка при приближении к концу списка.
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && next && !loading) load(false);
    },
    { root: el, rootMargin: "800px 0px" }
  );
  observer.observe(sentinel);

  pullToRefresh(el, ptr, reload);

  // Новый пост появляется сверху сразу, без перезагрузки ленты.
  const onNewPost = (e) => {
    const post = e.detail;
    const scopeMatches = prefs.scope === "msu" ? post.scope === "msu" : post.scope === (fixedScope || store.me?.faculty);
    const rubricMatches = !prefs.rubric || prefs.rubric === post.rubric;
    if (scopeMatches && rubricMatches && prefs.sort === "new") {
      list.querySelector(".empty")?.remove();
      list.prepend(postCard(post));
    }
  };
  window.addEventListener("potok:post", onNewPost);

  paintControls();
  reload();

  return {
    el,
    onShow() {
      if (scopeBtns.fac) scopeBtns.fac.textContent = myFacultyShort();
    },
    onReselect() {
      el.scrollTo({ top: 0, behavior: "smooth" });
      reload();
    },
    destroy() {
      observer.disconnect();
      window.removeEventListener("potok:post", onNewPost);
    },
  };
}

export function skeleton() {
  return h(
    "div.post.skeleton",
    h("div.sk-head", h("div.sk-circle"), h("div.sk-lines", h("div.sk-line.w40"), h("div.sk-line.w25"))),
    h("div.sk-line.w90"),
    h("div.sk-line.w70")
  );
}

export function errorState(err, retry) {
  if (err.code === "auth") {
    return emptyState("🔒", "Откройте через Telegram", "Поток работает внутри Telegram: так мы знаем, что вы — это вы.");
  }
  return emptyState("😶‍🌫️", "Не загрузилось", err.message, h("button.btn", { onclick: retry }, "Повторить"));
}

/** Потянуть ленту вниз у самого верха — обновить. */
function pullToRefresh(scroller, indicator, onRefresh) {
  let startY = null;
  let pulled = 0;
  const THRESHOLD = 70;
  scroller.addEventListener(
    "touchstart",
    (e) => {
      startY = scroller.scrollTop <= 0 ? e.touches[0].clientY : null;
      pulled = 0;
    },
    { passive: true }
  );
  scroller.addEventListener(
    "touchmove",
    (e) => {
      if (startY === null) return;
      pulled = Math.max(0, e.touches[0].clientY - startY);
      const p = Math.min(pulled / THRESHOLD, 1.4);
      indicator.style.transform = `translateY(${Math.min(pulled * 0.5, 60)}px) rotate(${p * 270}deg)`;
      indicator.style.opacity = String(Math.min(p, 1));
      indicator.classList.toggle("ready", pulled > THRESHOLD);
    },
    { passive: true }
  );
  scroller.addEventListener("touchend", () => {
    if (startY !== null && pulled > THRESHOLD) {
      haptic.tap();
      onRefresh();
    }
    startY = null;
    indicator.style.transform = "";
    indicator.style.opacity = "0";
    indicator.classList.remove("ready");
  });
}
