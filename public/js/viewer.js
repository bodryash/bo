import { imageUrl } from "./api.js";
import { refreshBackButton } from "./router.js";
import { backButton } from "./tg.js";
import { h, icon } from "./ui.js";

/** Просмотр фото на весь экран: листание свайпом, закрытие свайпом вниз. */
export function openViewer(media, index = 0) {
  let i = index;
  const img = h("img", { alt: "" });
  const counter = h("div.viewer-count");
  const el = h(
    "div.viewer",
    img,
    counter,
    h("button.viewer-close", { "aria-label": "Закрыть", onclick: close }, icon("close"))
  );

  function show() {
    img.src = imageUrl(media[i].key);
    counter.textContent = media.length > 1 ? `${i + 1} из ${media.length}` : "";
  }

  function step(d) {
    const n = i + d;
    if (n < 0 || n >= media.length) return;
    i = n;
    show();
  }

  let x0 = null;
  let y0 = null;
  el.addEventListener("touchstart", (e) => ((x0 = e.touches[0].clientX), (y0 = e.touches[0].clientY)), { passive: true });
  el.addEventListener(
    "touchmove",
    (e) => {
      if (y0 === null) return;
      const dy = e.touches[0].clientY - y0;
      if (dy > 0 && Math.abs(dy) > Math.abs(e.touches[0].clientX - x0)) {
        img.style.transform = `translateY(${dy}px)`;
        el.style.backgroundColor = `rgba(0,0,0,${Math.max(0.3, 0.95 - dy / 400)})`;
      }
    },
    { passive: true }
  );
  el.addEventListener("touchend", (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    img.style.transform = "";
    el.style.backgroundColor = "";
    if (dy > 110 && Math.abs(dy) > Math.abs(dx)) close();
    else if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
    x0 = y0 = null;
  });
  el.addEventListener("click", (e) => {
    if (e.target === el) close();
    else if (e.target === img && media.length > 1) step(e.offsetX > img.clientWidth / 2 ? 1 : -1);
  });
  const onKey = (e) => {
    if (e.key === "Escape") close();
    if (e.key === "ArrowRight") step(1);
    if (e.key === "ArrowLeft") step(-1);
  };
  document.addEventListener("keydown", onKey);

  // Кнопка «назад» Telegram закрывает просмотр, а не уходит с экрана.
  backButton(close);

  function close() {
    document.removeEventListener("keydown", onKey);
    el.classList.remove("open");
    setTimeout(() => el.remove(), 180);
    refreshBackButton();
  }

  show();
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add("open"));
}
