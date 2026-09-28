import { api, store } from "./api.js";
import { studentLine } from "./data.js";
import { errorState } from "./feed.js";
import { bump } from "./gestures.js";
import { go } from "./router.js";
import { haptic } from "./tg.js";
import { avatar, emptyState, h, spinner, tick, toast } from "./ui.js";

/**
 * Кнопка «Подписаться / Вы подписаны». Нажатие видно сразу, запрос —
 * следом; ошибка — откат. onChange(following, followers).
 */
export function followButton(user, { onChange, small = false } = {}) {
  let following = !!user.following;
  const btn = h("button.follow-btn" + (small ? ".small" : ""), {
    onclick: async (e) => {
      e.stopPropagation();
      const on = !following;
      following = on;
      paint();
      haptic[on ? "success" : "tap"]();
      bump(btn);
      try {
        const res = await api.post(`/api/users/${user.id}/follow`, { on });
        onChange?.(on, res.followers);
      } catch (err) {
        following = !on;
        paint();
        toast(err.message, "error");
      }
    },
  });
  const paint = () => {
    btn.classList.toggle("on", following);
    btn.textContent = following ? "Вы подписаны" : "Подписаться";
  };
  paint();
  return btn;
}

/** Список людей: аватар, имя, учёба и кнопка подписки. */
export function peopleList(users, { onFollow } = {}) {
  return h(
    "div.people",
    users.map((u, i) =>
      h(
        "div.person.appear",
        { style: { "--i": Math.min(i, 10) }, onclick: () => go(`/u/${u.id}`) },
        avatar(u, 44),
        h("div.person-text", h("div.person-name", h("span.name-text", u.name), tick(u)), h("div.person-sub", studentLine(u))),
        u.self || u.id === store.me?.id ? null : followButton(u, { small: true, onChange: onFollow })
      )
    )
  );
}

/** Экран «Подписчики» или «Подписки» человека. */
export function peopleScreen({ id, list }) {
  const kind = list === "following" ? "following" : "followers";
  const el = h("div.people-screen", h("div.topbar", h("div.brand-small", kind === "followers" ? "Подписчики" : "Подписки")));
  const body = h("div", h("div.center-pad", spinner()));
  el.append(body);

  async function load() {
    try {
      const { users } = await api.get(`/api/users/${id}/${kind}`);
      body.replaceChildren(
        users.length
          ? peopleList(users)
          : emptyState("👥", kind === "followers" ? "Подписчиков пока нет" : "Ни на кого не подписан", "")
      );
    } catch (err) {
      body.replaceChildren(errorState(err, load));
    }
  }
  load();
  return { el };
}
