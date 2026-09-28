import { api, store, writes } from "./api.js";
import { myFacultyShort, postCard } from "./card.js";
import { FACULTY, RUBRICS } from "./data.js";
import { go } from "./router.js";
import { reducedMotion, slideSwap, swipeX } from "./gestures.js";
import { haptic } from "./tg.js";
import { emptyState, h, icon, logo, spinner, syncPill, syncThumb } from "./ui.js";

const PREFS_KEY = "feedPrefs";

// Последняя загруженная первая страница каждой ленты — на время сессии.
const feedCache = new Map();

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

  const el = h("div.feed", { dataset: { swipe: "rubrics" } });
  const list = h("div.list", { dataset: { swipe: "rubrics" } });
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
                paintControls();
                leaveThen(s === "msu" ? 1 : -1, false, changed);
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
      : h("div.brand", logo(30), "Поток"),
    segmented
  );

  const chipBtns = {};
  const chips = h(
    "div.chips",
    [{ id: "", name: "Все", emoji: "" }, ...RUBRICS].map((r) =>
      (chipBtns[r.id] = h(
        "button.chip",
        {
          onclick: () => selectRubric(r.id, 0),
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
    if (segmented) syncThumb(segmented);
    for (const [r, b] of Object.entries(chipBtns)) b.classList.toggle("on", prefs.rubric === r);
    syncPill(chips);
    renderSort();
  }

  const RUBRIC_ORDER = ["", ...RUBRICS.map((r) => r.id)];

  let enterDir = 0;

  /**
   * dir: 1 — дальше (свайп влево), -1 — назад. Старая лента уезжает и
   * гаснет, таблетка переезжает к новой рубрике, новая лента въезжает с
   * той стороны, куда листали.
   */
  function selectRubric(id, dir, { fromSwipe = false } = {}) {
    if (prefs.rubric === id) return;
    haptic.select();
    const from = RUBRIC_ORDER.indexOf(prefs.rubric);
    dir = dir || (RUBRIC_ORDER.indexOf(id) > from ? 1 : -1);
    prefs.rubric = id;
    // У событий свой порядок: ближайшие сверху.
    prefs.sort = id === "event" ? "soon" : prefs.sort === "soon" ? "new" : prefs.sort;
    paintControls();
    chipBtns[id].scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    leaveThen(dir, fromSwipe, changed);
  }

  function leaveThen(dir, alreadyMoving, next) {
    enterDir = dir;
    if (reducedMotion() || !list.firstChild) return next();
    list.style.transition = "transform .16s ease-in, opacity .16s ease-in";
    list.style.transform = `translateX(${-dir * (alreadyMoving ? 120 : 48)}px)`;
    list.style.opacity = "0";
    setTimeout(() => {
      list.style.transition = "none";
      list.style.transform = "";
      list.style.opacity = "";
      next();
    }, 160);
  }

  // Свайп по ленте — соседняя рубрика, как листание дней в расписании.
  // Ловим по всему экрану ленты, а не только по постам: в короткой рубрике
  // палец часто ложится на пустое место под ними.
  swipeX(el, {
    move: () => list,
    canStart: (x, target) => !target.closest(".poll, .media, .topbar, .chips, .sortbar"),
    onSwipe: (dir) => {
      const i = RUBRIC_ORDER.indexOf(prefs.rubric) + dir;
      if (i < 0 || i >= RUBRIC_ORDER.length) {
        haptic.warning();
        return false;
      }
      selectRubric(RUBRIC_ORDER[i], dir, { fromSwipe: true });
    },
  });

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

  /**
   * Первая страница. Если эту рубрику уже открывали — показываем её из
   * памяти мгновенно и тихо обновляем; перерисовываем, только если что-то
   * изменилось. Первый раз — заглушки, пока идёт запрос.
   */
  async function load(reset) {
    if (loading && !reset) return;
    const gen = reset ? ++generation : generation;
    loading = true;
    const key = query(null);
    const cached = reset ? feedCache.get(key) : null;
    const writesAtStart = writes.n;
    if (reset) {
      next = null;
      if (cached) paint(cached, true);
      else list.replaceChildren(skeleton(), skeleton());
      if (enterDir) {
        slideSwap(list, enterDir);
        if (cached) enterDir = 0;
      }
    } else {
      sentinel.replaceChildren(spinner());
    }
    try {
      const data = await api.get(query(reset ? null : next));
      // Пока шёл запрос, человек что-то сделал (лайк, голос) — на экране
      // уже его версия, свежее этого ответа. Не перерисовываем.
      const stale = reset && cached && writes.n !== writesAtStart;
      // В память кладём, даже если за это время ушли на другую рубрику:
      // вернутся — увидят сразу.
      if (reset && !stale) feedCache.set(key, data);
      if (gen !== generation) return;
      if (reset) {
        if (!stale && (!cached || JSON.stringify(cached) !== JSON.stringify(data))) {
          const quietly = !!cached;
          if (enterDir && !cached) slideSwap(list, enterDir);
          enterDir = 0;
          paint(data, !quietly, quietly);
        }
        next = data.next;
      } else {
        data.posts.forEach((post, i) => list.append(postCard(post, { index: i })));
        next = data.next;
      }
      sentinel.replaceChildren(!next && list.querySelector(".post") ? h("div.end", "Это всё — дальше пусто") : "");
    } catch (err) {
      if (gen !== generation) return;
      if (reset && !cached) list.replaceChildren(errorState(err, () => load(true)));
      else if (!reset) sentinel.replaceChildren(h("button.link-btn", { onclick: () => load(false) }, "Не загрузилось — ещё раз"));
    } finally {
      if (gen === generation) loading = false;
    }
  }

  /** Отрисовать первую страницу. quiet — без анимации появления. */
  function paint(data, animate = true, quiet = false) {
    list.replaceChildren(...data.posts.map((post, i) => postCard(post, { index: i, appear: animate && !quiet })));
    next = data.next;
    if (!data.posts.length) list.append(empty());
    sentinel.replaceChildren(!next && data.posts.length ? h("div.end", "Это всё — дальше пусто") : "");
  }

  function reload() {
    load(true);
  }

  function empty() {
    const [emoji, title, text] = EMPTY[prefs.rubric] || EMPTY[""];
    const canWrite = !fixedScope || fixedScope === store.me?.faculty;
    // На факультете пока пусто — пусть человек увидит, что жизнь есть
    // во всём университете, а не уйдёт с пустого экрана.
    const toMsu =
      !fixedScope && prefs.scope !== "msu"
        ? h("button.btn", { onclick: () => ((prefs.scope = "msu"), changed()) }, "Лента всего МГУ")
        : null;
    return emptyState(
      emoji,
      title,
      text,
      h("div.empty-actions", canWrite ? h("button.btn.primary", { onclick: () => go("/new") }, "Написать пост") : null, toMsu)
    );
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
      if (segmented) syncThumb(segmented);
      syncPill(chips);
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
