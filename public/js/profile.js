import { api, store } from "./api.js";
import { postCard } from "./card.js";
import { FACULTY, FACULTIES, LEVEL, LEVELS, LIMITS, studentLine } from "./data.js";
import { errorState, skeleton } from "./feed.js";
import { back, go } from "./router.js";
import { haptic, openLink } from "./tg.js";
import { actionSheet, autoGrow, avatar, emptyState, h, icon, plural, sheet, spinner, toast, toggle } from "./ui.js";
import { followButton } from "./people.js";
import { insideTelegram, tg } from "./tg.js";

/** Профиль: свой (вкладка) или чужой (по id). */
export function profileScreen({ id } = {}) {
  const own = !id;
  // Содержимое — во внутреннем блоке: сам экран перерисовывать нельзя,
  // в нём живёт полоса «Назад», которую добавляет роутер вне Telegram.
  const content = h("div");
  const el = h("div.profile", content);
  const posts = h("div.list");
  const sentinel = h("div.sentinel");
  let next = null;
  let loading = false;
  let userId = own ? null : Number(id);

  async function load() {
    content.replaceChildren(h("div.profile-card.loading", spinner()));
    try {
      if (own) userId = store.me.id;
      const data = await api.get(`/api/users/${userId}`);
      render(data);
      next = null;
      posts.replaceChildren(skeleton());
      await loadPosts(true);
    } catch (err) {
      content.replaceChildren(errorState(err, load));
    }
  }

  function render({ user, stats, self, following, follows_me, mod }) {
    const f = FACULTY[user.faculty];
    const followers = h("b", String(stats.followers));
    const stat = (value, one, few, many, onclick) =>
      h(onclick ? "button.stat" : "div.stat", { onclick }, h("b", String(value)), plural(value, one, few, many));
    const followersStat = h(
      "button.stat",
      { onclick: () => go(`/u/${user.id}/followers`) },
      followers,
      plural(stats.followers, "подписчик", "подписчика", "подписчиков")
    );
    const me = store.me;

    const actions = self
      ? h(
          "div.profile-actions",
          h("button.btn.block", { onclick: () => go("/settings") }, icon("settings"), "Настройки профиля"),
          me?.admin ? h("button.btn.block.mod-btn", { onclick: () => go("/mod") }, icon("shield"), "Модерация") : null,
          homeScreenButton()
        )
      : h(
          "div.profile-actions.row",
          followButton(
            { id: user.id, following },
            {
              onChange: (on, n) => {
                followers.textContent = String(n);
                followersStat.lastChild.textContent = plural(n, "подписчик", "подписчика", "подписчиков");
              },
            }
          ),
          user.username
            ? h("button.btn", { onclick: () => openLink(`https://t.me/${user.username}`) }, icon("telegram"), "Написать")
            : null
        );

    const card = h(
      "div.profile-card",
      avatar(user, 88),
      h("div.profile-name", user.name, self && me?.admin ? h("span.mod-tag", icon("shield"), "модератор") : null),
      h("div.profile-line", studentLine(user) || "Профиль не заполнен"),
      follows_me && !self ? h("div.follows-me", "подписан(а) на вас") : null,
      f ? h("button.profile-fac", { onclick: () => go(`/f/${f.id}`) }, f.name, icon("chevron")) : null,
      user.bio ? h("div.profile-bio", user.bio) : null,
      h(
        "div.profile-stats",
        stat(stats.posts, "пост", "поста", "постов"),
        followersStat,
        stat(stats.following, "подписка", "подписки", "подписок", () => go(`/u/${user.id}/following`)),
        stat(stats.likes, "лайк", "лайка", "лайков")
      ),
      actions,
      !self && !user.username ? h("div.row-hint.center", "Ник в Telegram скрыт") : null,
      mod && !self ? modPanel(user, mod) : null
    );
    content.replaceChildren(card, h("div.section-label.pad", self ? "Мои посты" : "Посты"), posts, sentinel);
  }

  /** Для модератора на чужом профиле: скрытый ник, бан, разбан. */
  function modPanel(user, mod) {
    const status = h("div.mod-status");
    const paint = (until, reason) => {
      status.replaceChildren(
        h("div", icon("shield"), mod.username ? `@${mod.username}` : "без ника", mod.admin ? " · модератор" : ""),
        until
          ? h(
              "div.mod-banned",
              until > Date.now() / 1000 + 50 * 365 * 86400 ? "Забанен навсегда" : `Забанен до ${new Date(until * 1000).toLocaleDateString("ru-RU")}`,
              reason ? ` · ${reason}` : ""
            )
          : "",
        h(
          "div.mod-actions",
          until
            ? h("button.btn", { onclick: () => ban(false) }, "Снять бан")
            : h("button.btn.danger-btn", { onclick: () => banSheet(user, (days, r) => ban(true, days, r)) }, "Забанить")
        )
      );
    };
    async function ban(on, days, reason) {
      try {
        const res = await api.post(`/api/admin/users/${user.id}/ban`, { on, days, reason });
        haptic[on ? "warning" : "success"]();
        toast(on ? "Забанен" : "Бан снят");
        paint(res.banned_until, on ? reason : null);
      } catch (err) {
        toast(err.message, "error");
      }
    }
    paint(mod.banned_until, mod.ban_reason);
    return h("div.mod-panel", status);
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

/** Выбор срока бана — общий для профиля и меню поста. */
export function banSheet(user, onPick) {
  const options = [
    [1, "На сутки"],
    [7, "На неделю"],
    [30, "На месяц"],
    [0, "Навсегда"],
  ];
  actionSheet(
    options.map(([days, label]) => ({
      label,
      icon: "shield",
      danger: days === 0,
      onClick: () => onPick(days, "нарушение правил"),
    })),
    { title: user?.name ? `Бан: ${user.name}` : "Бан автора" }
  );
}

/**
 * «На экран Домой»: значок Потока на телефоне, открывается сразу, без
 * Telegram-чата. Кнопка видна, только если Telegram это умеет и значка ещё нет.
 */
function homeScreenButton() {
  if (!insideTelegram || !tg.isVersionAtLeast?.("8.0")) return null;
  const btn = h("button.btn.block", { hidden: true, onclick: () => tg.addToHomeScreen() }, icon("plus"), "На экран «Домой»");
  try {
    tg.checkHomeScreenStatus((status) => (btn.hidden = status === "added" || status === "unsupported"));
  } catch {}
  tg.onEvent?.("homeScreenAdded", () => {
    btn.hidden = true;
    toast("Поток теперь на экране «Домой»");
  });
  return btn;
}
