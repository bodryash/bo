import { api } from "./api.js";
import { postCard } from "./card.js";
import { errorState, skeleton } from "./feed.js";
import { go } from "./router.js";
import { avatar, emptyState, h, icon, spinner, tick } from "./ui.js";
import { studentLine } from "./data.js";

/**
 * Поиск людей и постов. Пока запроса нет — ближайшие события всего МГУ:
 * вкладка сразу полезна, даже если искать нечего.
 */
export function searchScreen() {
  const input = h("input.field.search-field", { type: "search", placeholder: "Люди, объявления, конспекты…", enterKeyHint: "search" });
  const results = h("div.search-results");
  // «Отмена» — как в поиске iOS: очистить и убрать клавиатуру. Без неё с
  // открытой клавиатурой было непонятно, как уйти с экрана.
  const cancel = h(
    "button.search-cancel",
    {
      onclick: () => {
        input.value = "";
        input.blur();
        paintCancel();
        upcoming();
      },
    },
    "Отмена"
  );
  const paintCancel = () => box.classList.toggle("active", document.activeElement === input || !!input.value);
  const box = h("div.search-row", h("div.search-box", icon("search"), input), cancel);
  input.addEventListener("focus", paintCancel);
  input.addEventListener("blur", () => setTimeout(paintCancel, 0));
  const el = h("div.search", h("div.topbar", h("div.brand", "Поиск")), box, results);
  // Потянул результаты — клавиатура уходит, видно больше.
  results.addEventListener("touchmove", () => document.activeElement === input && input.blur(), { passive: true });

  let timer;
  let seq = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(run, 300);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(timer);
      run();
      input.blur();
    }
  });

  async function run() {
    const q = input.value.trim();
    const my = ++seq;
    if (q.length < 2) return upcoming();
    results.replaceChildren(h("div.center-pad", spinner()));
    try {
      const data = await api.get("/api/search?q=" + encodeURIComponent(q));
      if (my !== seq) return;
      results.replaceChildren();
      if (data.users.length) {
        results.append(
          h("div.section-label.pad", "Люди"),
          h(
            "div.people",
            data.users.map((u) =>
              h("button.person.appear", { onclick: () => go(`/u/${u.id}`) }, avatar(u, 44), h("div.person-text", h("div.person-name", h("span.name-text", u.name), tick(u)), h("div.person-sub", studentLine(u))))
            )
          )
        );
      }
      if (data.posts.length) {
        results.append(h("div.section-label.pad", "Посты"), ...data.posts.map((p, i) => postCard(p, { showScope: true, index: i })));
      }
      if (!data.users.length && !data.posts.length) results.append(emptyState("🔍", "Ничего не нашлось", "Попробуйте другое слово."));
    } catch (err) {
      if (my === seq) results.replaceChildren(errorState(err, run));
    }
  }

  async function upcoming() {
    const my = ++seq;
    if (!results.querySelector(".post")) results.replaceChildren(h("div.section-label.pad", "Ближайшие события МГУ"), skeleton(), skeleton());
    try {
      const data = await api.get("/api/feed?scope=msu&rubric=event&sort=soon");
      if (my !== seq) return;
      results.replaceChildren(
        h("div.section-label.pad", "Ближайшие события МГУ"),
        ...(data.posts.length
          ? data.posts.map((p) => postCard(p, { showScope: true }))
          : [emptyState("📅", "Событий пока нет", "Знаете, куда сходить? Расскажите всем.", h("button.btn", { onclick: () => go("/new") }, "Добавить событие"))])
      );
    } catch (err) {
      if (my === seq) results.replaceChildren(errorState(err, upcoming));
    }
  }

  let first = true;
  return {
    el,
    onShow() {
      if (first) {
        first = false;
        upcoming();
      }
    },
    onReselect() {
      input.focus();
    },
  };
}
