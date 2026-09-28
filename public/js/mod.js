/**
 * Модерация в приложении: что скрыто жалобами и что ждёт решения, кто в
 * бане, журнал правок и удалений. То же, что в боте, — но видно автора и текст целиком, а решения
 * принимаются одним касанием. Только для модераторов (ADMIN_IDS).
 */

import { api } from "./api.js";
import { errorState } from "./feed.js";
import { banSheet } from "./profile.js";
import { go } from "./router.js";
import { haptic } from "./tg.js";
import { ago, avatar, emptyState, h, icon, spinner, syncThumb, syncPill, tick, toast } from "./ui.js";
import { historySheet } from "./modtools.js";
import { studentLine } from "./data.js";

export function modScreen() {
  let tab = "queue";
  const seg = h("div.segmented.wide");
  const tabs = [
    ["queue", "Жалобы"],
    ["log", "Журнал"],
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
      if (tab === "log") return await journal();
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
        h("button.mod-author", { onclick: () => go(`/u/${item.author.id}`) }, avatar(item.author, 32), h("div", h("b", item.author.name, tick(item.author)), h("span", studentLine(item.author)))),
        h("span.mod-kind" + (item.hidden ? ".hidden" : ""), item.target.startsWith("p") ? "пост" : "коммент", item.hidden ? " · скрыт" : "")
      ),
      item.anonymous ? h("div.mod-anon", icon("mask"), "писал(а) анонимно") : null,
      h("button.mod-text", { onclick: () => go(`/p/${item.post_id}`) }, item.text),
      h("div.mod-reasons", [item.reports ? `🚩 ${item.reports}` : "", ...item.reasons, ago(item.created_at)].filter(Boolean).join(" · ")),
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
        h("button.mod-author", { onclick: () => go(`/u/${u.id}`) }, avatar(u, 32), h("div", h("b", u.name, tick(u)), h("span", u.username ? `@${u.username}` : studentLine(u))))
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

  // ——— журнал ———

  let group = "";
  const GROUPS = [
    ["", "Всё"],
    ["edit", "Правки"],
    ["delete", "Удаления"],
    ["spam", "Спам"],
    ["people", "Баны и галочки"],
  ];

  // Фильтры создаются один раз: подсветка переезжает, а не появляется.
  const chipBtns = GROUPS.map(([id, name]) =>
    h(
      "button.chip",
      {
        dataset: { id },
        onclick: () => {
          if (group === id) return;
          group = id;
          haptic.select();
          journal();
        },
      },
      name
    )
  );
  const chips = h("div.chips.log-chips", chipBtns);
  const logList = h("div.log-list");

  async function journal() {
    for (const b of chipBtns) b.classList.toggle("on", b.dataset.id === group);
    if (chips.parentNode !== body) body.replaceChildren(chips, logList);
    logList.replaceChildren(h("div.center-pad", spinner()));
    requestAnimationFrame(() => syncPill(chips));
    await page(logList, null, true);
  }

  async function page(listEl, before, reset) {
    const p = new URLSearchParams();
    if (group) p.set("kind", group);
    if (before) p.set("before", before);
    try {
      const { events, next } = await api.get("/api/admin/log?" + p);
      if (reset) listEl.replaceChildren();
      listEl.querySelector(".log-more")?.remove();
      if (reset && !events.length) listEl.append(emptyState("📭", "Журнал пуст", "Здесь появятся правки, удаления, баны и галочки."));
      events.forEach((e, i) => listEl.append(logItem(e, i)));
      if (next) {
        const more = h("button.btn.block.log-more", { onclick: () => ((more.disabled = true), page(listEl, next, false)) }, "Показать ещё");
        listEl.append(more);
      }
    } catch (err) {
      if (reset) listEl.replaceChildren(errorState(err, load));
      else toast(err.message, "error");
    }
  }

  const KIND_ICON = { edit: "edit", delete: "trash", hide: "flag", restore: "check", ban: "lock", unban: "lock", verify: "check", unverify: "close", blocked: "shield", wipe: "trash" };
  const TARGET = { p: "пост", c: "комментарий", u: "" };

  function logItem(e, i) {
    const [t] = e.target.split(":");
    const who = e.actor ? e.actor.name : "система";
    const open = () => (e.post_id ? go(e.post_id && t === "c" ? `/p/${e.post_id}/c${e.target.slice(2)}` : `/p/${e.post_id}`) : e.target_user && go(`/u/${e.target_user.id}`));
    return h(
      "div.log-item.appear.kind-" + e.kind,
      { style: { "--i": Math.min(i, 10) } },
      h("span.log-icon", icon(KIND_ICON[e.kind] || "shield")),
      h(
        "div.log-main",
        h(
          "div.log-head",
          h("b", e.label),
          TARGET[t] ? ` · ${TARGET[t]}` : "",
          e.target_user ? [" · ", h("button.link-btn", { onclick: open }, e.target_user.name), tick(e.target_user)] : "",
          h("span.log-time", ago(e.created_at))
        ),
        h("div.log-who", e.actor ? h("button.link-btn", { onclick: () => go(`/u/${e.actor.id}`) }, who) : who, e.note ? ` · ${e.note}` : ""),
        e.kind === "edit" && e.old_text ? h("div.log-text.old", h("span.log-label", "было"), e.old_text) : null,
        e.kind === "blocked" && e.old_text ? h("div.log-text", h("span.log-label", "текст"), e.old_text) : null,
        e.target_text != null ? h("button.log-text", { onclick: open }, e.kind === "edit" ? h("span.log-label", "сейчас") : null, e.target_text) : null,
        t !== "u" ? h("button.link-btn.log-history", { onclick: () => historySheet(e.target) }, "вся история") : null
      )
    );
  }

  paint();
  load();
  return { el };
}
