import { api, store } from "./api.js";
import { postCard } from "./card.js";
import { FACULTY, FACULTIES, LEVEL, LEVELS, LIMITS, studentLine } from "./data.js";
import { errorState, skeleton } from "./feed.js";
import { back, go } from "./router.js";
import { haptic, openLink } from "./tg.js";
import { autoGrow, avatar, emptyState, h, icon, plural, sheet, spinner, toast, toggle } from "./ui.js";

/** Профиль: свой (вкладка) или чужой (по id). */
export function profileScreen({ id } = {}) {
  const own = !id;
  const el = h("div.profile");
  const posts = h("div.list");
  const sentinel = h("div.sentinel");
  let next = null;
  let loading = false;
  let userId = own ? null : Number(id);

  async function load() {
    el.replaceChildren(h("div.profile-card.loading", spinner()));
    try {
      if (own) userId = store.me.id;
      const data = await api.get(`/api/users/${userId}`);
      render(data);
      next = null;
      posts.replaceChildren(skeleton());
      await loadPosts(true);
    } catch (err) {
      el.replaceChildren(errorState(err, load));
    }
  }

  function render({ user, stats, self }) {
    const f = FACULTY[user.faculty];
    const card = h(
      "div.profile-card",
      avatar(user, 88),
      h("div.profile-name", user.name),
      h("div.profile-line", studentLine(user) || "Профиль не заполнен"),
      f ? h("button.profile-fac", { onclick: () => go(`/f/${f.id}`) }, f.name, icon("chevron")) : null,
      user.bio ? h("div.profile-bio", user.bio) : null,
      h(
        "div.profile-stats",
        h("div", h("b", String(stats.posts)), plural(stats.posts, "пост", "поста", "постов")),
        h("div", h("b", String(stats.likes)), plural(stats.likes, "лайк", "лайка", "лайков"))
      ),
      self
        ? h("button.btn.block", { onclick: () => go("/settings") }, icon("settings"), "Настройки профиля")
        : user.username
          ? h("button.btn.primary.block", { onclick: () => openLink(`https://t.me/${user.username}`) }, icon("telegram"), "Написать в Telegram")
          : h("div.row-hint.center", "Человек скрыл свой ник в Telegram")
    );
    el.replaceChildren(card, h("div.section-label.pad", self ? "Мои посты" : "Посты"), posts, sentinel);
  }

  async function loadPosts(reset) {
    if (loading) return;
    loading = true;
    try {
      const p = new URLSearchParams({ author: userId });
      if (!reset && next) p.set("before", next);
      const data = await api.get("/api/feed?" + p);
      if (reset) posts.replaceChildren();
      for (const post of data.posts) posts.append(postCard(post, { showScope: true }));
      next = data.next;
      if (reset && !data.posts.length) {
        posts.append(
          own
            ? emptyState("✍️", "Вы ещё ничего не написали", "Анонимные посты видны здесь только вам.", h("button.btn", { onclick: () => go("/new") }, "Написать пост"))
            : emptyState("🫥", "Постов пока нет", "")
        );
      }
    } catch (err) {
      toast(err.message, "error");
    } finally {
      loading = false;
    }
  }

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && next && !loading) loadPosts(false);
    },
    { root: el, rootMargin: "600px 0px" }
  );
  observer.observe(sentinel);

  let loadedOnce = false;
  return {
    el,
    onShow() {
      // Свой профиль обновляем при каждом входе на вкладку: могли написать
      // пост или поменять настройки.
      if (!loadedOnce || own) {
        loadedOnce = true;
        load();
      }
    },
    onReselect() {
      el.scrollTo({ top: 0, behavior: "smooth" });
      load();
    },
    destroy() {
      observer.disconnect();
    },
  };
}

/** Настройки: учёба, о себе, приватность, уведомления. */
export function settingsScreen() {
  const me = store.me;
  const state = { faculty: me.faculty, level: me.level, course: me.course, bio: me.bio, show_username: me.show_username, notify: me.notify };
  const el = h("div.settings");

  const facultyBtn = h("button.select-row", { onclick: () => pickFaculty(state.faculty).then((f) => f && ((state.faculty = f), paint())) });
  const levelSeg = h("div.chips.wrap");
  const courseSeg = h("div.chips.wrap");
  const bio = h("textarea.field", { rows: 2, maxLength: LIMITS.bio, placeholder: "Пара слов о себе: чем занимаетесь, что ищете", value: state.bio || "" });
  autoGrow(bio, 120);
  bio.addEventListener("input", () => (state.bio = bio.value));

  function paint() {
    const f = FACULTY[state.faculty];
    facultyBtn.replaceChildren(h("span", f ? f.name : "Выберите факультет"), icon("chevron"));
    levelSeg.replaceChildren(...levelChips(state, paint));
    courseSeg.replaceChildren(...courseChips(state, paint));
    courseSeg.hidden = !LEVEL[state.level]?.years;
  }

  const save = h("button.btn.primary.block", { onclick: submit }, "Сохранить");
  async function submit() {
    save.disabled = true;
    try {
      const res = await api.post("/api/me", state);
      store.set({ me: res.me });
      haptic.success();
      toast("Сохранено");
      back();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      save.disabled = false;
    }
  }

  const botLink = store.config.bot ? `https://t.me/${store.config.bot}?start=notify` : null;

  el.append(
    h("div.compose-head", h("button.link-btn", { onclick: back }, "Отмена"), h("div.compose-title", "Профиль"), h("div.head-spacer")),
    h("div.section", h("div.section-label", "Факультет"), facultyBtn, h("div.section-label", "Ступень"), levelSeg, courseSeg),
    h("div.section", h("div.section-label", "О себе"), bio),
    h(
      "div.section",
      h(
        "div.setting-row",
        icon("telegram"),
        h("div.row-text", h("div", "Показывать мой ник"), h("div.row-hint", me.username ? `@${me.username} — чтобы вам могли написать` : "У вас нет ника в Telegram")),
        toggle(state.show_username, (v) => (state.show_username = v))
      ),
      h(
        "div.setting-row",
        icon("bell"),
        h(
          "div.row-text",
          h("div", "Уведомления в боте"),
          h("div.row-hint", me.can_dm ? "Ответы на ваши посты и комментарии" : "Сначала нажмите «Запустить» в боте")
        ),
        toggle(state.notify, (v) => (state.notify = v))
      ),
      !me.can_dm && botLink ? h("button.link-btn.pad", { onclick: () => openLink(botLink) }, "Открыть бота") : null
    ),
    h("div.compose-submit", save)
  );
  paint();
  return { el };
}

export function levelChips(state, onChange) {
  return LEVELS.map((l) =>
    h(
      "button.chip" + (state.level === l.id ? ".on" : ""),
      {
        onclick: () => {
          haptic.select();
          state.level = l.id;
          if (!l.years) state.course = null;
          else if (state.course > l.years) state.course = null;
          onChange();
        },
      },
      l.name
    )
  );
}

export function courseChips(state, onChange) {
  const years = LEVEL[state.level]?.years || 0;
  return Array.from({ length: years }, (_, i) => i + 1).map((n) =>
    h(
      "button.chip.round" + (state.course === n ? ".on" : ""),
      {
        onclick: () => {
          haptic.select();
          state.course = n;
          onChange();
        },
      },
      `${n} курс`
    )
  );
}

/** Выбор факультета с поиском — их больше сорока. */
export function pickFaculty(current) {
  return new Promise((resolve) => {
    let chosen = null;
    const input = h("input.field.search-field", { type: "search", placeholder: "Поиск: ВМК, журфак, биология…" });
    const list = h("div.fac-list");
    const norm = (s) => s.toLowerCase().replace(/ё/g, "е");
    const paint = () => {
      const q = norm(input.value.trim());
      const items = FACULTIES.filter((f) => !q || norm(f.name + " " + f.short).includes(q));
      list.replaceChildren(
        ...items.map((f) =>
          h(
            "button.fac-item" + (f.id === current ? ".on" : ""),
            { onclick: () => ((chosen = f.id), close()) },
            h("div.fac-short", f.short),
            h("div.fac-name", f.name),
            f.id === current ? icon("check") : null
          )
        ),
        ...(items.length ? [] : [h("div.row-hint.center", "Ничего не нашлось")])
      );
    };
    input.addEventListener("input", paint);
    paint();
    const close = sheet(h("div.fac-picker", input, list), { title: "Факультет", onClose: () => resolve(chosen) });
  });
}
