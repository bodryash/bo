/**
 * Инструменты модератора и автора: меню со щитом на карточке, история
 * правок, окно правки текста.
 */

import { api, store } from "./api.js";
import { banSheet } from "./profile.js";
import { go } from "./router.js";
import { haptic } from "./tg.js";
import { actionSheet, ago, autoGrow, confirmDialog, h, icon, sheet, spinner, toast } from "./ui.js";

/**
 * Меню модератора прямо из ленты: кто автор (и за анонимкой), бан без
 * удаления, удалить, удалить и забанить, история правок.
 * target — "p:12" или "c:34"; author — автор (для анонимки — mod_author).
 */
export function modActions({ target, author, edited, hidden = 0, onRemoved, onRestored }) {
  if (!store.me?.admin) return;
  const self = author?.id === store.me.id;
  const what = target.startsWith("p") ? "пост" : "комментарий";
  actionSheet(
    [
      author && { label: `Профиль автора: ${author.name}`, icon: "user", onClick: () => go(`/u/${author.id}`) },
      edited && { label: "История правок", icon: "edit", onClick: () => historySheet(target) },
      author &&
        !self && {
          label: `Забанить автора, ${what} оставить`,
          icon: "shield",
          onClick: () =>
            banSheet(author, async (days) => {
              try {
                await api.post(`/api/admin/users/${author.id}/ban`, { on: true, days });
                haptic.warning();
                toast(days ? `${author.name} забанен на ${days} дн.` : `${author.name} забанен навсегда`);
              } catch (err) {
                toast(err.message, "error");
              }
            }),
        },
      hidden > 0 && { label: hidden === 2 ? "Восстановить" : "Вернуть — жалобы напрасные", icon: "check", onClick: () => act("ok") },
      hidden !== 2 && {
        label: "Удалить",
        icon: "trash",
        danger: true,
        onClick: async () => {
          if (!(await confirmDialog(`Удалить ${what}? В журнале останется, что было.`))) return;
          act("del");
        },
      },
      hidden !== 2 &&
        author &&
        !self && {
          label: "Удалить и забанить автора",
          icon: "shield",
          danger: true,
          onClick: () => banSheet(author, (days) => act("ban", days)),
        },
    ],
    { title: "Модерация" }
  );

  async function act(action, days) {
    try {
      const res = await api.post("/api/admin/act", { target, action, days });
      haptic[action === "ok" ? "success" : "warning"]();
      toast(res.result);
      (action === "ok" ? onRestored : onRemoved)?.();
    } catch (err) {
      toast(err.message, "error");
    }
  }
}

/** История правок и удаления — только модератору. */
export function historySheet(target) {
  const box = h("div.history", h("div.center-pad", spinner()));
  sheet(box, { title: "История" });
  api
    .get(`/api/admin/history?target=${encodeURIComponent(target)}`)
    .then(({ current, events }) => {
      const versions = [];
      for (const e of events) {
        if (e.kind === "edit") versions.push(h("div.history-item", h("div.history-meta", `было до правки · ${ago(e.created_at)}`), h("div.history-text", e.old_text)));
        else
          versions.push(
            h(
              "div.history-item.event",
              h("div.history-meta", `${e.label}${e.actor ? " · " + e.actor.name : ""}${e.note ? " · " + e.note : ""} · ${ago(e.created_at)}`)
            )
          );
      }
      box.replaceChildren(
        ...(versions.length ? versions : [h("div.row-hint.center", "Правок не было")]),
        current ? h("div.history-item.current", h("div.history-meta", current.hidden === 2 ? "последний текст (удалено)" : "сейчас"), h("div.history-text", current.text)) : ""
      );
    })
    .catch((err) => box.replaceChildren(h("div.row-hint.center", err.message)));
}

/** Окно правки текста. onSave(text) → Promise; закрывается после успеха. */
export function editSheet({ title, text, max, onSave }) {
  sheet(
    (close) => {
      const input = h("textarea.field.edit-field", { rows: 4, maxLength: max * 2 });
      input.value = text || "";
      const grow = autoGrow(input, 320);
      const save = h(
        "button.btn.primary.block",
        {
          onclick: async () => {
            const value = input.value.trim();
            if (!value) return toast("Пустой текст", "error");
            save.disabled = true;
            try {
              await onSave(value);
              haptic.success();
              toast("Изменено");
              close();
            } catch (err) {
              toast(err.message, "error");
              save.disabled = false;
            }
          },
        },
        "Сохранить"
      );
      setTimeout(() => {
        input.focus();
        grow();
      }, 250);
      return h("div.edit-box", input, h("div.row-hint", "Модераторы видят прежние версии текста."), save);
    },
    { title }
  );
}

/** «Удалён модератором», «Удалён автором», «Скрыт — три жалобы». */
export function removalText(kind, note) {
  if (kind === "hide") return note ? `Скрыт — ${note}` : "Скрыт жалобами";
  return note ? `Удалён ${note}` : "Удалён";
}

/** Пометка «изменено»: модератору — касание открывает историю. */
export function editedMark(target) {
  const admin = store.me?.admin;
  return h(
    admin ? "button.edited-mark.link" : "span.edited-mark",
    admin ? { onclick: (e) => (e.stopPropagation(), historySheet(target)) } : null,
    "изменено"
  );
}

export const shieldButton = (onclick) => h("button.icon-btn.shield-btn", { "aria-label": "Модерация", onclick: (e) => (e.stopPropagation(), onclick()) }, icon("shield"));
