import { api, store } from "./api.js";
import { errorState } from "./feed.js";
import { go } from "./router.js";
import { ago, avatar, emptyState, h, icon, spinner, tick } from "./ui.js";

const TEXT = {
  comment: "прокомментировал(а) ваш пост",
  reply: "ответил(а) на ваш комментарий",
  follow: "подписался(ась) на вас",
};

export function notificationsScreen() {
  const el = h("div.notifications", h("div.topbar", h("div.brand", "Уведомления")));
  const list = h("div.notif-list");
  el.append(list);

  async function load() {
    if (!list.children.length) list.append(h("div.center-pad", spinner()));
    try {
      const data = await api.get("/api/notifications");
      store.set({ unread: 0 });
      list.replaceChildren(
        ...(data.items.length
          ? data.items.map((n, i) => item(n, i))
          : [emptyState("🔔", "Пока тихо", "Когда вам ответят или поставят лайк, это появится здесь.")])
      );
    } catch (err) {
      list.replaceChildren(errorState(err, load));
    }
  }

  function item(n, index = 0) {
    let who;
    let what;
    if (n.kind === "like") {
      // Имя не склонить в дательный («Ане понравилось»), поэтому глагол
      // с именительным: «Аня и ещё 3 оценили ваш пост».
      const others = n.count - 1;
      who = n.actor ? n.actor.name : "Кто-то";
      what = others > 0 ? `и ещё ${others} оценили ваш пост` : "оценил(а) ваш пост";
    } else {
      who = n.actor ? n.actor.name : "Аноним";
      what = TEXT[n.kind] || "";
    }
    const badge = n.kind === "like" ? "heart" : n.kind === "reply" ? "reply" : n.kind === "follow" ? "user" : "comment";
    const follow = n.kind === "follow";
    return h(
      "button.notif.appear" + (n.unread ? ".unread" : ""),
      {
        style: { "--i": Math.min(index, 10) },
        onclick: () => go(follow ? `/u/${n.actor?.id}` : `/p/${n.post_id}${n.comment_id ? `/c${n.comment_id}` : ""}`),
      },
      h("div.notif-avatar", avatar(n.actor, 44), h("span.notif-badge.kind-" + n.kind, icon(badge))),
      h(
        "div.notif-body",
        h("div.notif-title", h("b", who), tick(n.actor), " ", what),
        n.comment_text ? h("div.notif-comment", n.comment_text) : null,
        follow ? null : h("div.notif-post", n.post_text || "Пост с фото"),
        h("div.notif-time", ago(n.created_at))
      )
    );
  }

  return {
    el,
    onShow: load,
    onReselect() {
      el.scrollTo({ top: 0, behavior: "smooth" });
      load();
    },
  };
}
