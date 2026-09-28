import { api, store } from "./api.js";
import { postCard, reportSheet } from "./card.js";
import { LIMITS, studentLine } from "./data.js";
import { errorState, skeleton } from "./feed.js";
import { back, go } from "./router.js";
import { pressable, swipeX } from "./gestures.js";
import { haptic, vibrate } from "./tg.js";
import { actionSheet, ago, autoGrow, avatar, confirmDialog, emptyState, h, icon, richText, toast } from "./ui.js";

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
  const composer = buildComposer();

  async function load() {
    try {
      const data = await api.get(`/api/posts/${postId}`);
      post = data.post;
      comments = data.comments;
      comments.forEach((c) => byId.set(c.id, c));
      render();
    } catch (err) {
      scroller.replaceChildren(
        err.status === 404 ? emptyState("🕳", "Поста нет", err.message, h("button.btn", { onclick: back }, "Назад")) : errorState(err, load)
      );
    }
  }

  function render() {
    scroller.replaceChildren(
      postCard(post, { full: true, showScope: true, onRemove: back }),
      h("div.comments-title", comments.length ? `Комментарии · ${comments.length}` : "Комментарии"),
      list
    );
    list.replaceChildren(
      ...(comments.length ? comments.map((c, i) => commentEl(c, i)) : [h("div.comments-empty", "Будьте первым — напишите, что думаете")])
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
    const name = c.anonymous ? (c.anon_no === 0 ? "Автор поста" : `Аноним ${c.anon_no}`) : c.author.name;
    const parent = c.reply_to ? byId.get(c.reply_to) : null;
    const node = h(
      "div.comment.appear" + (c.mine ? ".mine" : ""),
      { dataset: { id: c.id }, style: { "--i": Math.min(index, 10) } },
      h("div.reply-hint", icon("reply")),
      h("button.comment-avatar", { onclick: () => c.author && go(`/u/${c.author.id}`), disabled: !c.author }, avatar(c.author, 34)),
      h(
        "div.comment-body",
        h(
          "div.comment-head",
          h("span.comment-name", name),
          c.is_op ? h("span.op-tag", "автор") : null,
          c.author ? h("span.comment-sub", studentLine(c.author)) : null
        ),
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
          h("span", ago(c.created_at)),
          post.hidden === 0 ? h("button.link-btn", { onclick: () => setReply(c) }, "Ответить") : null,
          h("button.icon-btn.tiny", { "aria-label": "Ещё", onclick: () => commentMenu(c, node) }, icon("more"))
        )
      )
    );
    pressable(node, { onLongPress: () => commentMenu(c, node) });
    if (post.hidden === 0) swipeToReply(node, () => setReply(c));
    return node;
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

  const nameOf = (c) => (c.anonymous ? (c.anon_no === 0 ? "Автор поста" : `Аноним ${c.anon_no}`) : c.author.name);

  function commentMenu(c, node) {
    actionSheet([
      post.hidden === 0 && { label: "Ответить", icon: "reply", onClick: () => setReply(c) },
      {
        label: "Скопировать текст",
        icon: "edit",
        onClick: () => navigator.clipboard?.writeText(c.text).then(() => toast("Скопировано"), () => {}),
      },
      !c.mine && { label: "Пожаловаться", icon: "flag", onClick: () => reportSheet(`c:${c.id}`) },
      c.can_delete && {
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
    const send = h("button.send", { "aria-label": "Отправить", onclick: submit }, icon("send"));
    let sending = false;

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
      send.disabled = sending || !input.value.trim();
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

    async function submit() {
      const text = input.value.trim();
      if (!text || sending) return;
      if (!store.me?.faculty) return go("/onboarding");
      sending = true;
      sync();
      try {
        const res = await api.post(`/api/posts/${postId}/comments`, { text, anonymous, reply_to: replyTo?.id || null });
        haptic.success();
        const c = res.comment;
        byId.set(c.id, c);
        comments.push(c);
        post.comments++;
        list.querySelector(".comments-empty")?.remove();
        const node = commentEl(c);
        list.append(node);
        node.scrollIntoView({ block: "end", behavior: "smooth" });
        input.value = "";
        replyTo = null;
        grow();
      } catch (err) {
        haptic.error();
        toast(err.message, "error");
      } finally {
        sending = false;
        sync();
      }
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
