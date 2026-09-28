/**
 * Жесты. Пороги — как в расписании: жест засчитан, если палец прошёл
 * заметную долю экрана или сделал быстрый флик; всё, что меньше TAP_SLOP,
 * — это касание, а не жест. Всё на pointer-событиях: одинаково для пальца
 * и мыши. Вертикальную прокрутку не трогаем — горизонтальные жесты
 * начинаются, только когда палец явно пошёл вбок.
 */

import { vibrate } from "./tg.js";

const SWIPE_DISTANCE = 0.22; // доля ширины экрана
const SWIPE_VELOCITY = 0.35; // px/мс — быстрый флик засчитываем без дистанции
const TAP_SLOP = 8; // px
const EDGE = 28; // px от левого края — зона жеста «назад»
const LONG_PRESS = 450; // мс
const DOUBLE_TAP = 260; // мс

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Горизонтальный жест, за которым едет элемент move (по умолчанию el).
 * onSwipe(dir): dir = 1 — влево (дальше), -1 — вправо (назад).
 * Вернуть false из onSwipe — жест не засчитан, элемент пружинит обратно.
 */
export function swipeX(el, { onSwipe, onCancel, canStart = () => true, move = () => el, edgeOnly = false, resist = 0.35 }) {
  let start = null;
  let active = false;
  let target = null;

  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (edgeOnly && e.clientX > EDGE) return;
    if (!canStart(e)) return;
    start = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    active = false;
  });

  el.addEventListener("pointermove", (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!active) {
      if (Math.abs(dx) < TAP_SLOP) return;
      // Палец пошёл вертикально — это прокрутка, не мешаем ей.
      if (Math.abs(dy) > Math.abs(dx) || (edgeOnly && dx < 0)) {
        start = null;
        return;
      }
      active = true;
      target = move();
      target.style.transition = "none";
      el.setPointerCapture?.(e.pointerId);
    }
    const shift = edgeOnly ? Math.max(0, dx) : dx * (1 - resist * Math.min(1, Math.abs(dx) / innerWidth));
    target.style.transform = `translateX(${shift.toFixed(1)}px)`;
    if (edgeOnly) target.style.boxShadow = "-12px 0 30px rgba(0,0,0,.12)";
  });

  const finish = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const speed = Math.abs(dx) / Math.max(1, performance.now() - start.t);
    const wasActive = active;
    start = null;
    active = false;
    if (!wasActive) return;
    // Жест случился — клик после него не нужен.
    const swallow = (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    el.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 50);

    const passed = Math.abs(dx) > innerWidth * SWIPE_DISTANCE || speed > SWIPE_VELOCITY;
    const dir = dx < 0 ? 1 : -1;
    const accepted = passed && !(edgeOnly && dir === 1) && onSwipe(dir, target) !== false;
    if (!accepted) {
      target.style.transition = "transform .28s cubic-bezier(.2,.9,.25,1.2), box-shadow .28s";
      target.style.transform = "translateX(0)";
      target.style.boxShadow = "";
      onCancel?.();
    }
  };
  el.addEventListener("pointerup", finish);
  el.addEventListener("pointercancel", (e) => {
    if (!start) return;
    start = null;
    if (active && target) {
      target.style.transition = "transform .25s ease";
      target.style.transform = "translateX(0)";
      target.style.boxShadow = "";
      onCancel?.();
    }
    active = false;
  });
}

/**
 * Касание, двойное касание и долгое нажатие на одном элементе. Одиночное
 * ждёт DOUBLE_TAP мс, только если есть обработчик двойного.
 */
export function pressable(el, { onTap, onDoubleTap, onLongPress, ignore = "button, a, input, textarea" }) {
  let timer = null;
  let pressTimer = null;
  let startPt = null;
  let longFired = false;

  el.addEventListener("pointerdown", (e) => {
    if (e.target.closest(ignore)) return;
    longFired = false;
    startPt = { x: e.clientX, y: e.clientY };
    if (onLongPress) {
      pressTimer = setTimeout(() => {
        longFired = true;
        vibrate("medium");
        el.classList.add("long-pressed");
        setTimeout(() => el.classList.remove("long-pressed"), 250);
        onLongPress(e);
      }, LONG_PRESS);
    }
  });
  const cancelPress = () => clearTimeout(pressTimer);
  el.addEventListener("pointermove", (e) => {
    if (startPt && Math.hypot(e.clientX - startPt.x, e.clientY - startPt.y) > TAP_SLOP) cancelPress();
  });
  el.addEventListener("pointerup", cancelPress);
  el.addEventListener("pointercancel", cancelPress);
  el.addEventListener("contextmenu", (e) => onLongPress && e.preventDefault());

  el.addEventListener("click", (e) => {
    if (e.target.closest(ignore) || longFired) return;
    if (!onDoubleTap) return onTap?.(e);
    if (timer) {
      clearTimeout(timer);
      timer = null;
      onDoubleTap(e);
    } else {
      timer = setTimeout(() => {
        timer = null;
        onTap?.(e);
      }, DOUBLE_TAP);
    }
  });
}

/** Сердце, вылетающее из точки двойного касания. */
export function heartBurst(container, x, y) {
  const rect = container.getBoundingClientRect();
  const heart = document.createElement("div");
  heart.className = "heart-burst";
  heart.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M12 20s-7.5-4.6-7.5-10.1A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.5 2.3C19.5 15.4 12 20 12 20z"/></svg>';
  heart.style.left = `${x - rect.left}px`;
  heart.style.top = `${y - rect.top}px`;
  container.append(heart);
  setTimeout(() => heart.remove(), 800);
}

/** Смена содержимого со смазом вбок — как листание дней в расписании. */
export function slideSwap(el, dir) {
  if (reducedMotion() || !el.animate) return;
  el.animate(
    [
      { transform: `translateX(${dir * 40}px)`, opacity: 0, filter: "blur(2px)" },
      { transform: "translateX(0)", opacity: 1, filter: "blur(0)" },
    ],
    { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" }
  );
}

/** Подпрыгивание — например, у числа лайков или значка уведомлений. */
export function bump(el) {
  if (reducedMotion() || !el?.animate) return;
  el.animate([{ transform: "scale(1)" }, { transform: "scale(1.25)" }, { transform: "scale(1)" }], {
    duration: 300,
    easing: "cubic-bezier(.3,1.6,.5,1)",
  });
}
