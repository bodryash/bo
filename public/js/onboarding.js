import { api, store } from "./api.js";
import { FACULTY, LEVEL } from "./data.js";
import { courseChips, levelChips, pickFaculty } from "./profile.js";
import { go } from "./router.js";
import { haptic } from "./tg.js";
import { avatar, h, icon, toast } from "./ui.js";

/**
 * Первый вход: факультет, ступень, курс. Без этого не понять, какую ленту
 * показывать, поэтому экран обязательный — но короткий: три касания.
 */
export function onboardingScreen() {
  const me = store.me || {};
  const state = { faculty: me.faculty || null, level: me.level || "bach", course: me.course || null };
  const el = h("div.onboarding");

  const facultyBtn = h("button.select-row.big", { onclick: choose });
  const levelRow = h("div.chips.wrap");
  const courseRow = h("div.chips.wrap");
  const done = h("button.btn.primary.block", { onclick: submit }, "Готово");

  async function choose() {
    const f = await pickFaculty(state.faculty);
    if (f) {
      state.faculty = f;
      paint();
    }
  }

  function paint() {
    const f = FACULTY[state.faculty];
    facultyBtn.replaceChildren(
      f ? h("div", h("div.fac-short", f.short), h("div.fac-name", f.name)) : h("span.placeholder", "Выберите факультет"),
      icon("chevron")
    );
    levelRow.replaceChildren(...levelChips(state, paint));
    courseRow.replaceChildren(...courseChips(state, paint));
    courseRow.hidden = !LEVEL[state.level]?.years;
    const ready = state.faculty && state.level && (!LEVEL[state.level]?.years || state.course);
    done.disabled = !ready;
  }

  async function submit() {
    done.disabled = true;
    try {
      const res = await api.post("/api/me", state);
      store.set({ me: res.me });
      haptic.success();
      go("/", { replace: true });
    } catch (err) {
      toast(err.message, "error");
      done.disabled = false;
    }
  }

  el.append(
    h(
      "div.onb-hero",
      h("div.onb-logo", "П"),
      h("h1", "Поток"),
      h("p", "Студенческая соцсеть МГУ: лента факультета, «Подслушано», барахолка, события и жильё.")
    ),
    h(
      "div.onb-me",
      avatar(me, 40),
      h("div", h("div.onb-name", me.name ? `Привет, ${me.name.split(" ")[0]}!` : "Привет!"), h("div.row-hint", "Имя и фото — из Telegram"))
    ),
    h("div.section", h("div.section-label", "Где вы учитесь"), facultyBtn),
    h("div.section", h("div.section-label", "Ступень"), levelRow, courseRow),
    h("div.compose-submit", done, h("div.row-hint.center", "Поменять можно в любой момент в профиле"))
  );
  paint();
  return { el };
}
