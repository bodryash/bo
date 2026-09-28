/**
 * Всё, что касается Telegram, — в одном месте. Вне Telegram (в обычном
 * браузере при разработке) window.Telegram может не быть совсем: каждый
 * вызов тогда тихо ничего не делает.
 */

export const tg = window.Telegram?.WebApp || null;

// Скрипт Telegram создаёт WebApp и в обычном браузере, но подпись initData
// есть только внутри Telegram — по ней и понимаем, где мы.
export const insideTelegram = !!tg?.initData;

const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);

/**
 * Подпись для API. В Telegram — настоящая; на локальной машине можно
 * открыть адрес вида /#dev=<initData> (его печатает tools/sign.mjs).
 */
export function initData() {
  if (tg?.initData) return tg.initData;
  // Демо-страница подписывает строку сама — см. demo/.
  if (window.POTOK_DEMO) return window.POTOK_DEMO.initData;
  if (!LOCAL) return "";
  const m = /[#&]dev=([^&]+)/.exec(location.hash);
  if (m) {
    try {
      sessionStorage.setItem("devInitData", decodeURIComponent(m[1]));
    } catch {}
    history.replaceState(null, "", location.pathname + "#/");
  }
  try {
    return sessionStorage.getItem("devInitData") || "";
  } catch {
    return "";
  }
}

export function startParam() {
  return tg?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get("tgWebAppStartParam") || "";
}

const supports = (version) => !!tg?.isVersionAtLeast?.(version);

export function setup() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  // Иначе попытка прокрутить ленту вверх у самого начала сворачивает
  // приложение — самая частая жалоба на мини-приложения с лентой.
  if (supports("7.7")) tg.disableVerticalSwipes();
  syncColors();
  tg.onEvent("themeChanged", syncColors);
}

function syncColors() {
  if (!supports("6.1")) return;
  // Шапка и фон Telegram — в цвет ленты, чтобы не было полосы другого тона.
  try {
    tg.setHeaderColor("secondary_bg_color");
    tg.setBackgroundColor("secondary_bg_color");
    if (supports("7.10")) tg.setBottomBarColor("secondary_bg_color");
  } catch {}
}

let backHandler = null;
export function backButton(onClick) {
  if (!insideTelegram || !supports("6.1")) return;
  if (backHandler) tg.BackButton.offClick(backHandler);
  backHandler = onClick;
  if (onClick) {
    tg.BackButton.onClick(onClick);
    tg.BackButton.show();
  } else {
    tg.BackButton.hide();
  }
}

/**
 * Виброотклик Telegram. select — щелчок при выборе (вкладка, рубрика),
 * light/medium/heavy — нажатие и жест, success/error/warning — итог
 * действия. Один жест часто зовёт отклик дважды (кнопка и общий
 * обработчик нажатий) — повтор в течение 60 мс глотаем, кроме итогов.
 */
let lastBuzz = 0;
export function vibrate(kind = "light") {
  if (!insideTelegram || !supports("6.1")) return;
  const outcome = kind === "success" || kind === "error" || kind === "warning";
  const t = performance.now();
  if (!outcome && t - lastBuzz < 60) return;
  lastBuzz = t;
  try {
    if (kind === "select") tg.HapticFeedback.selectionChanged();
    else if (outcome) tg.HapticFeedback.notificationOccurred(kind);
    else tg.HapticFeedback.impactOccurred(kind);
  } catch {}
}

// Отклики заметные: на телефоне «light» и selectionChanged почти не
// чувствуются, поэтому нажатие — medium, выбор — rigid (чёткий щелчок).
export const haptic = {
  tap: () => vibrate("medium"),
  press: () => vibrate("heavy"),
  heavy: () => vibrate("heavy"),
  select: () => vibrate("rigid"),
  success: () => vibrate("success"),
  error: () => vibrate("error"),
  warning: () => vibrate("warning"),
};

export function openLink(url) {
  if (/^https:\/\/t\.me\//.test(url) && tg) return tg.openTelegramLink(url);
  if (tg) return tg.openLink(url);
  window.open(url, "_blank", "noopener");
}
