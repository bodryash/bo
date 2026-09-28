/**
 * Жесты. Жест засчитан, если палец прошёл заметную долю экрана или сделал
 * быстрый флик; всё, что меньше TAP_SLOP, — касание, а не жест.
 *
 * На телефоне — touch-события, а не pointer: встроенный браузер Telegram,
 * едва почуяв прокрутку, обрывает pointer-жест (pointercancel), и свайп
 * засчитывался, только если дотянуть палец почти до края. Здесь, как только
 * палец явно пошёл вбок, мы забираем касание себе (preventDefault), и
 * прокрутка его уже не отнимет. Мышь — отдельной веткой, для компьютера.
 */

import { vibrate } from "./tg.js";

const SWIPE_DISTANCE = 0.12; // доля ширины экрана: ~45 px на телефоне
const SWIPE_VELOCITY = 0.3; // px/мс — быстрый флик засчитываем без дистанции
const TAP_SLOP = 8; // px
export const EDGE = 36; // px от левого края
const LONG_PRESS = 450; // мс
const DOUBLE_TAP = 260; // мс

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Касание пальцем и мышью — в одни и те же start/move/end. */
export function track(el, h) {
  el.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return h.cancel();
      const t = e.touches[0];
      h.start(t.clientX, t.clientY, e.target);
    },
    { passive: true }
  );
  el.addEventListener(
    "touchmove",
    (e) => {
      const t = e.touches[0];
      if (t && h.move(t.clientX, t.clientY)) e.preventDefault();
    },
    { passive: false }
  );
  el.addEventListener("touchend", (e) => {
    const t = e.changedTouches[0];
    h.end(t.clientX, t.clientY);
  });
  el.addEventListener("touchcancel", () => h.cancel());

  let touchedAt = 0;
  el.addEventListener("touchstart", () => (touchedAt = Date.now()), { passive: true });
  el.addEventListener("mousedown", (e) => {
    // После касания браузер присылает ещё и мышиные события — их пропускаем.
    if (e.button !== 0 || Date.now() - touchedAt < 800) return;
    h.start(e.clientX, e.clientY, e.target);
    const mm = (ev) => h.move(ev.clientX, ev.clientY);
    const mu = (ev) => {
      window.removeEventListener("mousemove", mm);
      h.end(ev.clientX, ev.clientY);
    };
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu, { once: true });
  });
}

/**
 * Горизонтальный жест, за которым едет элемент move() (по умолчанию el).
 * direction: "both", "right" (только вправо — «назад») или "left".
 * onSwipe(dir): dir = 1 — палец ушёл влево (дальше), -1 — вправо (назад).
 * Вернуть false из onSwipe — жест не засчитан, элемент пружинит обратно.
 * onProgress(dx) — для подсказок по ходу жеста.
 */
export function swipeX(el, { onSwipe, onCancel, onProgress, canStart = () => true, move = () => el, direction = "both", resist = 0.35, follow = true }) {
  let g = null;

  const springBack = () => {
    if (g?.target && follow) {
      g.target.style.transition = "transform .3s cubic-bezier(.2,.9,.25,1.15), box-shadow .3s";
      g.target.style.transform = "";
      g.target.style.boxShadow = "";
    }
    onProgress?.(0);
    onCancel?.();
  };

  track(el, {
    start(x, y, target) {
      g = canStart(x, target) ? { x, y, t: performance.now(), active: false, dead: false, lx: x, lt: performance.now(), v: 0 } : null;
    },
    move(x, y) {
      if (!g || g.dead) return false;
      const dx = x - g.x;
      const dy = y - g.y;
      if (!g.active) {
        if (Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP) return false;
        const horizontal = Math.abs(dx) > Math.abs(dy) * 1.2;
        const allowed = direction === "both" || (direction === "right" ? dx > 0 : dx < 0);
        if (!horizontal || !allowed) {
          g.dead = true;
          return false;
        }
        g.active = true;
        g.target = move();
        if (follow) g.target.style.transition = "none";
      }
      const now = performance.now();
      g.v = (x - g.lx) / Math.max(1, now - g.lt);
      g.lx = x;
      g.lt = now;
      let shift = direction === "right" ? Math.max(0, dx) : direction === "left" ? Math.min(0, dx) : dx;
      if (direction === "both") shift *= 1 - resist * Math.min(1, Math.abs(dx) / innerWidth);
      if (follow) {
        g.target.style.transform = `translateX(${shift.toFixed(1)}px)`;
        if (direction === "right") g.target.style.boxShadow = "-12px 0 30px rgba(0,0,0,.14)";
      }
      onProgress?.(shift);
      return true;
    },
    end(x) {
      if (!g) return;
      const was = g;
      g = null;
      if (!was.active) return;
      const dx = x - was.x;
      // Жест случился — клик после него не нужен.
      const swallow = (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      el.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 60);

      // Флик засчитываем по скорости в самом конце, а не по средней:
      // короткий резкий взмах после паузы — тоже жест.
      const fast = Math.abs(was.v) > SWIPE_VELOCITY && Math.sign(was.v) === Math.sign(dx);
      const passed = Math.abs(dx) > innerWidth * SWIPE_DISTANCE || fast;
      const dir = dx < 0 ? 1 : -1;
      g = { target: was.target };
      if (passed && onSwipe(dir, was.target) !== false) {
        onProgress?.(0);
        g = null;
        return;
      }
      springBack();
      g = null;
    },
    cancel() {
      if (g?.active) springBack();
      g = null;
    },
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
        vibrate("heavy");
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
