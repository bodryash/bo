import { api, imageUrl, store } from "./api.js";
import { myFacultyShort } from "./card.js";
import { LIMITS, RUBRIC, RUBRICS } from "./data.js";
import { prepareImage } from "./image.js";
import { back, go } from "./router.js";
import { haptic } from "./tg.js";
import { autoGrow, h, icon, syncPill, syncThumb, toast, toggle } from "./ui.js";

const DRAFT_KEY = "draft";

const PLACEHOLDERS = {
  talk: "Что происходит?",
  study: "Вопрос по учёбе, конспекты, билеты…",
  confess: "Признайтесь — никто не узнает, что это вы",
  event: "Что за событие и кого зовёте?",
  market: "Что продаёте или отдаёте? Состояние, где забрать",
  lost: "Что потеряли или нашли, где и когда",
  housing: "Кого или что ищете: соседа, комнату, общежитие",
};

/**
 * Новый пост. Черновик сохраняется на телефоне, чтобы случайный свайп
 * назад не стирал длинный текст.
 */
export function composeScreen({ rubric: presetRubric, scope: presetScope } = {}) {
  const draft = loadDraft();
  // Нажали «Написать» в «Учёбе» — форма сразу в «Учёбе» и в том же
  // разделе (факультет или весь МГУ), а не в том, что было в черновике.
  const state = {
    scope: presetScope === "msu" || presetScope === "fac" ? presetScope : draft.scope || "fac",
    rubric: RUBRIC[presetRubric] ? presetRubric : draft.rubric || "talk",
    text: draft.text || "",
    anonymous: !!draft.anonymous,
    price: draft.price ?? "",
    eventDate: draft.eventDate || "",
    place: draft.place || "",
    poll: draft.poll || null,
    photos: [], // { key, w, h, preview, uploading, failed }
  };
  let sending = false;

  const el = h("div.compose");

  // ——— куда ———
  const scopeSeg = h("div.segmented.wide");
  const scopeBtns = [
    ["fac", myFacultyShort()],
    ["msu", "Весь МГУ"],
  ].map(([id, name]) =>
    h("button", { dataset: { id }, onclick: () => ((state.scope = id), haptic.select(), paintScope(), saveDraft()) }, name)
  );
  scopeSeg.append(...scopeBtns);
  function paintScope() {
    for (const b of scopeBtns) b.classList.toggle("on", b.dataset.id === state.scope);
    syncThumb(scopeSeg);
  }

  // ——— рубрика ———
  const rubricRow = h("div.chips.wrap");
  const rubricBtns = RUBRICS.map((r) =>
    h(
      "button.chip",
      {
        dataset: { id: r.id },
        onclick: () => {
          if (state.rubric === r.id) return;
          state.rubric = r.id;
          haptic.select();
          paintRubrics();
          paintExtras();
          saveDraft();
        },
      },
      `${r.emoji} ${r.name}`
    )
  );
  rubricRow.append(...rubricBtns);
  function paintRubrics() {
    for (const b of rubricBtns) b.classList.toggle("on", b.dataset.id === state.rubric);
    syncPill(rubricRow);
    textarea.placeholder = PLACEHOLDERS[state.rubric];
  }

  // ——— текст ———
  const textarea = h("textarea.compose-text", { rows: 5, value: state.text, maxLength: LIMITS.postText * 2 });
  const counter = h("div.counter");
  const grow = autoGrow(textarea, 420);
  textarea.addEventListener("input", () => {
    state.text = textarea.value;
    paintCounter();
    saveDraft();
  });
  function paintCounter() {
    const n = [...state.text].length;
    counter.textContent = n > LIMITS.postText * 0.8 ? `${n} / ${LIMITS.postText}` : "";
    counter.classList.toggle("over", n > LIMITS.postText);
  }

  // ——— поля рубрики ———
  const extras = h("div.extras");
  function paintExtras() {
    extras.replaceChildren();
    if (state.rubric === "market") {
      const price = h("input.field", { type: "number", inputMode: "numeric", min: 0, placeholder: "Цена, ₽ (0 — отдам даром)", value: state.price });
      price.addEventListener("input", () => ((state.price = price.value), saveDraft()));
      extras.append(h("label.field-label", "Цена"), price);
    }
    if (state.rubric === "event") {
      const date = h("input.field", { type: "datetime-local", value: state.eventDate });
      date.addEventListener("input", () => ((state.eventDate = date.value), saveDraft()));
      const place = h("input.field", { type: "text", maxLength: LIMITS.place, placeholder: "Где: аудитория, корпус, адрес", value: state.place });
      place.addEventListener("input", () => ((state.place = place.value), saveDraft()));
      extras.append(h("label.field-label", "Когда"), date, h("label.field-label", "Где"), place);
    }
    anonRow.hidden = false;
    const forced = RUBRIC[state.rubric]?.anonymous;
    anonToggleWrap.replaceChildren(toggle(forced || state.anonymous, (v) => ((state.anonymous = v), saveDraft())));
    anonToggleWrap.querySelector("input").disabled = !!forced;
    anonHint.textContent = forced
      ? "В «Подслушано» всегда анонимно"
      : "Имя не увидит никто, кроме модераторов при жалобе";
  }

  const anonToggleWrap = h("div");
  const anonHint = h("div.row-hint");
  const anonRow = h("div.setting-row", icon("mask"), h("div.row-text", h("div", "Анонимно"), anonHint), anonToggleWrap);

  // ——— опрос ———
  const pollBox = h("div.poll-edit");
  function paintPoll() {
    pollBox.replaceChildren();
    if (!state.poll) return;
    state.poll.forEach((opt, i) => {
      const input = h("input.field", { type: "text", maxLength: LIMITS.pollOption, placeholder: `Вариант ${i + 1}`, value: opt });
      input.addEventListener("input", () => ((state.poll[i] = input.value), saveDraft()));
      pollBox.append(
        h(
          "div.poll-edit-row",
          input,
          state.poll.length > 2 ? h("button.icon-btn.tiny", { onclick: () => (state.poll.splice(i, 1), paintPoll(), saveDraft()) }, icon("close")) : null
        )
      );
    });
    pollBox.append(
      h(
        "div.poll-edit-actions",
        state.poll.length < LIMITS.pollOptions
          ? h("button.link-btn", { onclick: () => (state.poll.push(""), paintPoll(), pollBox.querySelectorAll("input")[state.poll.length - 1]?.focus()) }, "+ вариант")
          : null,
        h("button.link-btn.danger", { onclick: () => ((state.poll = null), paintPoll(), paintTools(), saveDraft()) }, "Убрать опрос")
      )
    );
  }

  // ——— фото ———
  const photoRow = h("div.photo-row");
  const fileInput = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true });
  fileInput.addEventListener("change", () => {
    addPhotos([...fileInput.files]);
    fileInput.value = "";
  });

  function paintPhotos() {
    photoRow.replaceChildren(
      ...state.photos.map((p) =>
        h(
          "div.thumb" + (p.uploading ? ".loading" : "") + (p.failed ? ".failed" : ""),
          h("img", { src: p.preview || imageUrl(p.key), alt: "" }),
          p.uploading ? h("div.thumb-spin") : null,
          p.failed ? h("div.thumb-failed", "Ошибка") : null,
          h("button.thumb-x", { "aria-label": "Убрать", onclick: () => ((state.photos = state.photos.filter((x) => x !== p)), paintPhotos(), paintTools()) }, icon("close"))
        )
      )
    );
    photoRow.hidden = !state.photos.length;
  }

  async function addPhotos(files) {
    const room = LIMITS.photos - state.photos.length;
    if (files.length > room) toast(`Не больше ${LIMITS.photos} фото`);
    for (const file of files.slice(0, room)) {
      const photo = { uploading: true };
      state.photos.push(photo);
      paintPhotos();
      paintTools();
      try {
        const img = await prepareImage(file);
        photo.preview = img.preview;
        paintPhotos();
        const res = await api.upload(img.blob, img.w, img.h);
        Object.assign(photo, { key: res.key, w: res.w, h: res.h, uploading: false });
      } catch (err) {
        Object.assign(photo, { uploading: false, failed: true });
        toast(err.message || "Фото не загрузилось", "error");
      }
      paintPhotos();
    }
  }

  // ——— инструменты ———
  const tools = h("div.tools");
  function paintTools() {
    tools.replaceChildren(
      h("button.tool", { onclick: () => fileInput.click(), disabled: state.photos.length >= LIMITS.photos }, icon("image"), "Фото"),
      h(
        "button.tool",
        {
          disabled: !!state.poll,
          onclick: () => {
            state.poll = ["", ""];
            paintPoll();
            paintTools();
            pollBox.querySelector("input")?.focus();
          },
        },
        icon("poll"),
        "Опрос"
      )
    );
  }

  const submitBtn = h("button.btn.primary.block", { onclick: submit }, "Опубликовать");

  async function submit() {
    if (sending) return;
    if (state.photos.some((p) => p.uploading)) return toast("Подождите, фото ещё загружаются");
    const body = {
      scope: state.scope === "msu" ? "msu" : "fac",
      rubric: state.rubric,
      text: state.text,
      anonymous: state.anonymous,
      media: state.photos.filter((p) => p.key).map((p) => p.key),
    };
    if (state.rubric === "market" && state.price !== "") body.price = Number(state.price);
    if (state.rubric === "event") {
      if (!state.eventDate) return toast("Укажите, когда событие", "error");
      body.event_at = Math.floor(new Date(state.eventDate).getTime() / 1000);
      body.place = state.place;
    }
    if (state.poll) body.poll = state.poll.filter((o) => o.trim());

    sending = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Публикуем…";
    try {
      const res = await api.post("/api/posts", body);
      haptic.success();
      if (res.review) toast("Пост отправлен на проверку модератору", "");
      clearDraft();
      window.dispatchEvent(new CustomEvent("potok:post", { detail: res.post }));
      go(`/p/${res.post.id}`, { replace: true });
    } catch (err) {
      haptic.error();
      toast(err.message, "error");
      if (err.code === "profile") go("/onboarding");
    } finally {
      sending = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "Опубликовать";
    }
  }

  function saveDraft() {
    try {
      const { photos, ...rest } = state;
      localStorage.setItem(DRAFT_KEY, JSON.stringify(rest));
    } catch {}
  }

  el.append(
    h("div.compose-head", h("button.link-btn", { onclick: back }, "Отмена"), h("div.compose-title", "Новый пост"), h("div.head-spacer")),
    h("div.section", h("div.section-label", "Где опубликовать"), scopeSeg),
    h("div.section", h("div.section-label", "Рубрика"), rubricRow),
    h("div.section.editor", textarea, counter, photoRow, pollBox, tools, fileInput),
    h("div.section", extras, anonRow),
    h("div.compose-submit", submitBtn)
  );

  paintScope();
  paintRubrics();
  paintExtras();
  paintCounter();
  paintPhotos();
  paintPoll();
  paintTools();

  return {
    el,
    onShow() {
      if (!store.me?.faculty) return go("/onboarding", { replace: true });
      setTimeout(() => {
        textarea.focus();
        grow();
      }, 250);
    },
  };
}

function loadDraft() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY)) || {};
  } catch {
    return {};
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {}
}
