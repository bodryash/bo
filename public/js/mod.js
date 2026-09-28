/**
 * Модерация в приложении: что скрыто жалобами и что ждёт решения, кто в
 * бане. То же, что в боте, — но видно автора и текст целиком, а решения
 * принимаются одним касанием. Только для модераторов (ADMIN_IDS).
 */

import { api } from "./api.js";
import { errorState } from "./feed.js";
import { banSheet } from "./profile.js";
import { go } from "./router.js";
import { haptic } from "./tg.js";
import { ago, avatar, emptyState, h, icon, spinner, syncThumb, toast } from "./ui.js";
import { studentLine } from "./data.js";

export function modScreen() {
  let tab = "queue";
  const seg = h("div.segmented.wide");
  const tabs = [
    ["queue", "Жалобы"],
    ["bans", "Баны"],
  ].map(([id, name]) => h("button", { dataset: { id }, onclick: () => (tab !== id ? ((tab = id), haptic.select(), paint(), load()) : null) }, name));
  seg.append(...tabs);
  const body = h("div.mod-body");
  const el = h("div.mod", h("div.topbar", h("div.brand-small", icon("shield"), "Модерация")), h("div.mod-tabs", seg), body);

  function paint() {
    for (const b of tabs) b.classList.toggle("on", b.dataset.id === tab);
    syncThumb(seg);
  }

  async function load() {
    body.replaceChildren(h("div.center-pad", spinner()));
    try {
      if (tab === "queue") {
        const { items } = await api.get("/api/admin/queue");
        body.replaceChildren(
          ...(items.length ? items.map(queueItem) : [emptyState("👌", "Жалоб нет", "Всё спокойно — хулиганов не видно.")])
        );
      } else {
        const { users } = await api.get("/api/admin/bans");
        body.replaceChildren(...(users.length ? users.map(banItem) : [emptyState("🕊", "Никто не забанен", "")]));
      }
    } catch (err) {
      body.replaceChildren(errorState(err, load));
    }
  }

  function queueItem(item, i) {
    const node = h(
      "div.mod-item.appear",
      { style: { "--i": Math.min(i, 10) } },
      h(
        "div.mod-item-head",
        h("button.mod-author", { onclick: () => go(`/u/${item.author.id}`) }, avatar(item.author, 32), h("div", h("b", item.author.name), h("span", studentLine(item.author)))),
        h("span.mod-kind" + (item.hidden ? ".hidden" : ""), item.target.startsWith("p") ? "пост" : "коммент", item.hidden ? " · скрыт" : "")
      ),
      item.anonymous ? h("div.mod-anon", icon("mask"), "писал(а) анонимно") : null,
      h("button.mod-text", { onclick: () => go(`/p/${item.post_id}`) }, item.text),
      h("div.mod-reasons", `🚩 ${item.reports} · ${item.reasons.join(", ")} · ${ago(item.created_at)}`),
      h(
        "div.mod-actions",
        h("button.btn", { onclick: () => decide(item, "ok", node) }, "Вернуть"),
        h("button.btn", { onclick: () => decide(item, "del", node) }, "Удалить"),
        h("button.btn.danger-btn", { onclick: () => banSheet(item.author, (days) => decide(item, "ban", node, days)) }, "Бан")
      )
    );
    return node;
  }

  async function decide(item, action, node, days) {
    try {
      const res = await api.post("/api/admin/act", { target: item.target, action, days });
      haptic[action === "ok" ? "success" : "warning"]();
      toast(res.result);
      node.classList.add("done");
      setTimeout(() => node.remove(), 250);
    } catch (err) {
      toast(err.message, "error");
    }
  }

  function banItem(u, i) {
    const node = h(
      "div.mod-item.appear",
      { style: { "--i": Math.min(i, 10) } },
      h(
        "div.mod-item-head",
        h("button.mod-author", { onclick: () => go(`/u/${u.id}`) }, avatar(u, 32), h("div", h("b", u.name), h("span", u.username ? `@${u.username}` : studentLine(u))))
      ),
      h("div.mod-reasons", u.forever ? "навсегда" : `до ${new Date(u.banned_until * 1000).toLocaleDateString("ru-RU")}`, u.ban_reason ? ` · ${u.ban_reason}` : ""),
      h(
        "div.mod-actions",
        h(
          "button.btn",
          {
            onclick: async () => {
              try {
                await api.post(`/api/admin/users/${u.id}/ban`, { on: false });
                haptic.success();
                toast("Бан снят");
                node.classList.add("done");
                setTimeout(() => node.remove(), 250);
              } catch (err) {
                toast(err.message, "error");
              }
            },
          },
          "Снять бан"
        )
      )
    );
    return node;
  }

  paint();
  load();
  return { el };
}
