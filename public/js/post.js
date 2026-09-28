import { api, postCache, store } from "./api.js";
import { modAuthor, postCard, reportSheet } from "./card.js";
import { editSheet, editedMark, historySheet, modActions, removalText } from "./modtools.js";
import { LIMITS, studentLine } from "./data.js";
import { errorState, skeleton } from "./feed.js";
import { back, go } from "./router.js";
import { pressable, swipeX } from "./gestures.js";
import { haptic, vibrate } from "./tg.js";
import { actionSheet, ago, autoGrow, avatar, confirmDialog, emptyState, h, icon, richText, tick, toast } from "./ui.js";

/** Экран поста: сам пост, комментарии и поле ответа снизу. */
export function postScreen({ id, comment }) {
  const postId = Number(id);
  const focusComment = comment ? Number(String(comment).replace(/^c/, "")) : null;

  const scroller = h("div.post-scroll");
  const el = h("div.post-screen", scroller);
  scroller.append(skeleton());

  let post = null;
  let comments = [];
  let replyTo = null;
  const byId = new Map();

  const list = h("div.comments");
  const title = h("div.comments-title", "Комментарии");
  // Модератору приходят и удалённые комментарии — в счётчик их не берём.
  const countTitle = (loading = false) => {
    const visible = loading ? 0 : comments.filter((c) => !c.removed).length;
    title.textContent = visible ? `Комментарии · ${visible}` : "Комментарии";
  };
  const composer = buildComposer();

  let shownCard = null;
  let loaded = false;

  async function load() {
    // Пост уже был в ленте — показываем его сразу, комментарии догрузятся.
    if (!loaded && !post && postCache.has(postId)) {
      post = postCache.get(postId);
      render({ commentsLoading: true });
    }
    try {
      const data = await api.get(`/api/posts/${postId}`);
      const cardChanged = !post || JSON.stringify(post) !== JSON.stringify(data.post);
      post = data.post;
      postCache.set(postId, post);
      comments = data.comments;
      byId.clear();
      comments.forEach((c) => byId.set(c.id, c));
      loaded = true;
      render({ keepCard: !cardChanged });
    } catch (err) {
      scroller.replaceChildren(
        err.status === 404 ? emptyState("🕳", "Поста нет", err.message, h("button.btn", { onclick: back }, "Назад")) : errorState(err, load)
      );
    }
  }

  function render({ commentsLoading = false, keepCard = false } = {}) {
    const onChange = (next, card) => {
      post = next;
      shownCard = card;
    };
    if (!keepCard || !shownCard) shownCard = postCard(post, { full: true, showScope: true, onRemove: back, onChange, appear: !shownCard });
    scroller.replaceChildren(shownCard, title, list);
    countTitle(commentsLoading);
    list.replaceChildren(
      ...(commentsLoading
        ? [h("div.comment-skeleton", h("div.sk-circle"), h("div.sk-lines", h("div.sk-line.w40"), h("div.sk-line.w90")))]
        : comments.length
          ? comments.map((c, i) => commentEl(c, i))
          : [h("div.comments-empty", "Будьте первым — напишите, что думаете")])
    );
    if (post.hidden === 0) el.append(composer.el);
    composer.sync();

    if (focusComment) {
      const target = list.querySelector(`[data-id="${focusComment}"]`);
      if (target) {
        requestAnimationFrame(() => target.scrollIntoView({ block: "center" }));
        target.classList.add("flash");
      }
    }
  }

  function commentEl(c, index = 0) {
    const name = nameOf(c);
    const parent = c.reply_to ? byId.get(c.reply_to) : null;
    const node = h(
      "div.comment.appear" + (c.mine ? ".mine" : "") + (c.removed ? ".removed" : ""),
      { dataset: { id: c.id }, style: { "--i": Math.min(index, 10) } },
      h("div.reply-hint", icon("reply")),
      h("button.comment-avatar", { onclick: () => c.author && go(`/u/${c.author.id}`), disabled: !c.author }, avatar(c.author, 34)),
      h(
        "div.comment-body",
        h(
          "div.comment-head",
          h("span.comment-name", name),
          tick(c.author),
          c.is_op ? h("span.op-tag", "автор") : null,
          c.author ? h("span.comment-sub", studentLine(c.author)) : null
        ),
        c.removed ? removedTag(c) : null,
        c.mod_author ? modAuthor(c.mod_author) : null,
        c.reply_to
          ? h(
              "button.quote",
              {
                onclick: () => {
                  const target = list.querySelector(`[data-id="${c.reply_to}"]`);
                  if (target) {
                    target.scrollIntoView({ block: "center", behavior: "smooth" });
                    target.classList.remove("flash");
                    void target.offsetWidth;
                    target.classList.add("flash");
                  }
                },
              },
              parent ? h("b", nameOf(parent)) : null,
              h("span", parent ? parent.text.slice(0, 90) : "Комментарий удалён")
            )
          : null,
        h("div.comment-text", richText(c.text)),
        h(
          "div.comment-foot",
          h("span.comment-time", ago(c.created_at)),
          c.edited ? editedMark(`c:${c.id}`) : null,
          post.hidden === 0 && !c.removed ? h("button.link-btn", { onclick: () => setReply(c) }, "Ответить") : null,
          h("button.icon-btn.tiny", { "aria-label": "Ещё", onclick: () => commentMenu(c, node) }, icon("more"))
        )
      )
    );
    pressable(node, { onLongPress: () => commentMenu(c, node) });
    if (post.hidden === 0 && !c.removed) swipeToReply(node, () => setReply(c));
    return node;
  }

  /** Модератору: комментарий удалён или скрыт — кем и почему. */
  function removedTag(c) {
    return h(
      "button.removed-tag",
      { onclick: (e) => (e.stopPropagation(), historySheet(`c:${c.id}`)) },
      icon(c.removed.kind === "hide" ? "flag" : "trash"),
      `${removalText(c.removed.kind, c.removed.note)} · видно только модераторам`
    );
  }

  /** Заменить строку комментария свежей — после правки, удаления, возврата. */
  function replaceComment(c, node, patch) {
    Object.assign(c, patch);
    const fresh = commentEl(c);
    fresh.classList.remove("appear");
    node.replaceWith(fresh);
    countTitle();
    return fresh;
  }

  /**
   * Свайп комментария влево — ответить на него, как в Telegram: строка
   * едет за пальцем, справа проступает стрелка, на пороге — щелчок.
   */
  function swipeToReply(node, onReply) {
    const hint = node.querySelector(".reply-hint");
    let armed = false;
    swipeX(node, {
      direction: "left",
      resist: 0,
      canStart: (x, target) => !target.closest("button, a"),
      onProgress: (dx) => {
        const p = Math.min(1, -dx / 60);
        hint.style.opacity = String(p);
        hint.style.transform = `scale(${0.5 + p / 2})`;
        const ready = p >= 1;
        if (ready && !armed) vibrate("rigid");
        armed = ready;
      },
      onSwipe: () => {
        onReply();
        return false; // строка возвращается на место
      },
    });
  }

  const nameOf = (c) =>
    c.anonymous ? (c.anon_no === 0 ? "Автор поста" : c.anon_no == null ? "Вы, анонимно" : `Аноним ${c.anon_no}`) : c.author.name;

  function commentMenu(c, node) {
    const admin = store.me?.admin;
    actionSheet([
      post.hidden === 0 && !c.removed && { label: "Ответить", icon: "reply", onClick: () => setReply(c) },
      {
        label: "Скопировать текст",
        icon: "edit",
        onClick: () => navigator.clipboard?.writeText(c.text).then(() => toast("Скопировано"), () => {}),
      },
      c.mine &&
        !c.removed &&
        typeof c.id === "number" && {
          label: "Редактировать",
          icon: "edit",
          onClick: () =>
            editSheet({
              title: "Правка комментария",
              text: c.text,
              max: LIMITS.commentText,
              onSave: async (text) => {
                const res = await api.post(`/api/comments/${c.id}/edit`, { text });
                replaceComment(c, node, { text: res.text, edited: res.edited });
              },
            }),
        },
      !c.mine && !c.removed && { label: "Пожаловаться", icon: "flag", onClick: () => reportSheet(`c:${c.id}`) },
      admin &&
        !c.mine && {
          label: "Модерация…",
          icon: "shield",
          onClick: () =>
            modActions({
              target: `c:${c.id}`,
              author: c.author || c.mod_author,
              edited: c.edited,
              hidden: c.removed ? (c.removed.kind === "hide" ? 1 : 2) : 0,
              // Модератор остаётся на экране и видит, что комментарий
              // теперь удалён, — строка серая, с пометкой.
              onRemoved: () => {
                if (!c.removed) post.comments = Math.max(0, post.comments - 1);
                replaceComment(c, node, { removed: { kind: "delete", note: "модератором" } });
              },
              onRestored: () => {
                post.comments++;
                replaceComment(c, node, { removed: undefined });
              },
            }),
        },
      c.edited && admin && { label: "История правок", icon: "edit", onClick: () => historySheet(`c:${c.id}`) },
      c.mine &&
        !c.removed && {
          label: "Удалить",
          icon: "trash",
          danger: true,
          onClick: async () => {
            if (!(await confirmDialog("Удалить комментарий?"))) return;
            try {
              await api.post(`/api/comments/${c.id}/delete`);
              comments = comments.filter((x) => x.id !== c.id);
              post.comments = Math.max(0, post.comments - 1);
              node.remove();
              countTitle();
              if (!comments.length) list.replaceChildren(h("div.comments-empty", "Комментариев больше нет"));
            } catch (err) {
              toast(err.message, "error");
            }
          },
        },
    ]);
  }

  function setReply(c) {
    replyTo = c;
    composer.sync();
    composer.focus();
  }

  function buildComposer() {
    const input = h("textarea", { rows: 1, maxLength: LIMITS.commentText * 2, placeholder: "Комментарий…" });
    const grow = autoGrow(input, 140);
    const replyBar = h("div.reply-bar");
    let anonymous = false;
    const anonBtn = h(
      "button.icon-btn.anon-toggle",
      {
        "aria-label": "Анонимно",
        onclick: () => {
          anonymous = !anonymous;
          haptic.select();
          sync();
          toast(anonymous ? "Комментарий будет анонимным" : "Комментарий от вашего имени");
        },
      },
      icon("mask")
    );
    const send = h("button.send", { "aria-label": "Отправить", onclick: () => submit() }, icon("send"));

    input.addEventListener("input", sync);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
    });

    let initialized = false;
    function sync() {
      // В своём анонимном посте по умолчанию отвечаем тоже анонимно — иначе
      // автор раскрыл бы себя первым же комментарием.
      if (post && !initialized) {
        anonymous = post.anonymous && post.mine;
        initialized = true;
      }
      anonBtn.classList.toggle("on", anonymous);
      input.placeholder = anonymous ? "Анонимный комментарий…" : "Комментарий…";
      send.disabled = !input.value.trim();
      replyBar.replaceChildren();
      replyBar.hidden = !replyTo;
      if (replyTo) {
        replyBar.append(
          icon("reply"),
          h("div.reply-info", h("b", "Ответ: " + nameOf(replyTo)), h("span", replyTo.text.slice(0, 80))),
          h("button.icon-btn.tiny", { "aria-label": "Отменить ответ", onclick: () => ((replyTo = null), sync()) }, icon("close"))
        );
      }
    }

    /**
     * Комментарий появляется сразу — полупрозрачным, пока сервер его не
     * принял. Не принял — строка краснеет, касание отправляет заново.
     */
    function submit(retry) {
      const text = retry?.text ?? input.value.trim();
      if (!text) return;
      if (!store.me?.faculty) return go("/onboarding");
      const draft = retry || {
        id: `tmp${Date.now()}`,
        author: anonymous ? null : store.me,
        anonymous,
        anon_no: null,
        is_op: false,
        mine: true,
        reply_to: replyTo?.id || null,
        text,
        created_at: Math.floor(Date.now() / 1000),
        can_delete: false,
      };
      let node = retry?.node;
      if (!retry) {
        list.querySelector(".comments-empty")?.remove();
        node = commentEl(draft);
        list.append(node);
        requestAnimationFrame(() => node.scrollIntoView({ block: "end", behavior: "smooth" }));
        input.value = "";
        replyTo = null;
        grow();
        sync();
        haptic.tap();
      }
      node.classList.add("pending");
      node.classList.remove("failed");
      node.querySelector(".comment-time").textContent = "отправляется…";

      api
        .post(`/api/posts/${postId}/comments`, { text, anonymous: draft.anonymous, reply_to: draft.reply_to })
        .then((res) => {
          haptic.success();
          const c = res.comment;
          byId.set(c.id, c);
          comments.push(c);
          post.comments++;
          countTitle();
          const real = commentEl(c);
          real.classList.remove("appear");
          node.replaceWith(real);
        })
        .catch((err) => {
          haptic.error();
          toast(err.message, "error");
          node.classList.remove("pending");
          node.classList.add("failed");
          node.querySelector(".comment-time").textContent = "не отправлено — коснитесь, чтобы повторить";
          node.addEventListener("click", () => submit({ ...draft, node }), { once: true });
        });
    }

    const el = h("div.composer", replyBar, h("div.composer-row", anonBtn, input, send));
    return { el, sync, focus: () => input.focus() };
  }

  // Кто-то ответил в этом посте, пока он открыт, — показываем сразу.
  const onActivity = (e) => e.detail?.postId === postId && load();
  window.addEventListener("potok:activity", onActivity);

  load();
  return {
    el,
    destroy() {
      window.removeEventListener("potok:activity", onActivity);
    },
  };
}
