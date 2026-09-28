/**
 * Битва факультетов: неделя — сезон, очки приносят студенты своими
 * постами, комментариями и лайками. Правила и подсчёт — src/battle.js.
 */

import { api, store } from "./api.js";
import { FACULTY } from "./data.js";
import { errorState } from "./feed.js";
import { reducedMotion } from "./gestures.js";
import { go } from "./router.js";
import { haptic } from "./tg.js";
import { emptyState, h, icon, plural, spinner, syncThumb } from "./ui.js";

let cached = null;
let cachedAt = 0;

/** Результаты недели; в памяти — минуту, чтобы плашка в ленте не дёргала сервер. */
export async function loadBattle(force = false) {
  if (!force && cached && Date.now() - cachedAt < 60_000) return cached;
  cached = await api.get("/api/battle");
  cachedAt = Date.now();
  return cached;
}

const short = (id) => FACULTY[id]?.short || id;

function left(end, now) {
  const s = Math.max(0, end - now);
  const d = Math.floor(s / 86400);
  const hrs = Math.floor((s % 86400) / 3600);
  if (d) return `${d} ${plural(d, "день", "дня", "дней")} ${hrs} ч`;
  const m = Math.floor((s % 3600) / 60);
  return `${hrs} ч ${m} мин`;
}

const pts = (n) => `${n} ${plural(n, "очко", "очка", "очков")}`;

/** Плашка над лентой: место своего факультета, касание — к битве. */
export function battleBanner() {
  const el = h("button.battle-banner", { hidden: true, onclick: () => go("/battle") });
  const refresh = async () => {
    try {
      const b = await loadBattle();
      const mine = b.faculties.find((f) => f.id === store.me?.faculty);
      const leader = b.faculties[0];
      el.replaceChildren(
        h("span.battle-banner-icon", icon("trophy")),
        h(
          "span.battle-banner-text",
          h("b", "Битва факультетов"),
          h(
            "span",
            mine
              ? `${short(mine.id)} — ${mine.rank} место · ${pts(mine.points)}`
              : leader
                ? `Лидирует ${short(leader.id)} · ваш факультет пока без очков`
                : "Неделя началась — первый пост принесёт очки"
          )
        ),
        icon("chevron")
      );
      el.hidden = false;
    } catch {
      el.hidden = true;
    }
  };
  return { el, refresh };
}

export function battleScreen() {
  let mode = "points";
  let data = null;
  const body = h("div.battle-body", h("div.center-pad", spinner()));
  const el = h("div.battle", h("div.topbar", h("div.brand-small", icon("trophy"), "Битва факультетов")), body);

  async function load() {
    try {
      data = await loadBattle(true);
      render();
    } catch (err) {
      body.replaceChildren(errorState(err, load));
    }
  }

  function render() {
    const b = data;
    const me = store.me;
    const list =
      mode === "points"
        ? b.faculties
        : [...b.faculties].filter((f) => f.members >= 5).sort((a, c) => c.per_member - a.per_member);
    const value = (f) => (mode === "points" ? f.points : f.per_member);
    const unit = (f) => (mode === "points" ? pts(f.points) : `${f.per_member} на чел.`);
    const top = list.length ? value(list[0]) : 1;
    const mine = b.faculties.find((f) => f.id === me?.faculty);

    const seg = h(
      "div.segmented.wide",
      [
        ["points", "Очки"],
        ["per", "На человека"],
      ].map(([id, name]) =>
        h("button" + (mode === id ? ".on" : ""), { onclick: () => mode !== id && ((mode = id), haptic.select(), render()) }, name)
      )
    );
    requestAnimationFrame(() => syncThumb(seg));

    const hero = h(
      "div.battle-hero",
      h("div.battle-week", `До конца недели ${left(b.end, b.now)}`),
      h(
        "div.battle-mine",
        mine
          ? [h("b", `${short(mine.id)} — ${mine.rank} место`), h("span", ` из ${b.faculties.length} · ${pts(mine.points)}`)]
          : h("b", "Ваш факультет пока без очков")
      ),
      h("div.battle-contrib", `Ваш вклад: ${pts(b.me.points)}`, h("span", ` (в день — до ${b.rules.cap})`)),
      b.champion ? h("div.battle-champion", "🏆 Чемпион прошлой недели: ", h("b", short(b.champion.id)), ` · ${pts(b.champion.points)}`) : null
    );

    const podium =
      list.length >= 3
        ? h(
            "div.podium",
            [1, 0, 2].map((i) => {
              const f = list[i];
              return h(
                "button.podium-place.p" + (i + 1) + (f.id === me?.faculty ? ".mine" : ""),
                { onclick: () => go(`/f/${f.id}`) },
                h("div.podium-medal", ["🥇", "🥈", "🥉"][i]),
                h("div.podium-name", short(f.id)),
                h("div.podium-points", unit(f)),
                h("div.podium-step", String(i + 1))
              );
            })
          )
        : null;

    const rows = h(
      "div.battle-list",
      list.slice(podium ? 3 : 0).map((f, i) =>
        h(
          "button.battle-row.appear" + (f.id === me?.faculty ? ".mine" : ""),
          { style: { "--i": Math.min(i, 12) }, onclick: () => go(`/f/${f.id}`) },
          h("span.battle-rank", String(list.indexOf(f) + 1)),
          h(
            "span.battle-fac",
            h("b", short(f.id)),
            h("span.battle-meta", `${f.active} ${plural(f.active, "участник", "участника", "участников")} на этой неделе`),
            h("span.battle-bar", h("i", { style: { "--w": `${Math.max(4, (value(f) / top) * 100)}%` } }))
          ),
          h("span.battle-points", unit(f))
        )
      )
    );

    const rules = h(
      "div.battle-rules",
      h("div.section-label", "Как заработать очки"),
      h(
        "ul",
        h("li", h("b", `+${b.rules.post}`), " пост (анонимные тоже — считается только сумма)"),
        h("li", h("b", `+${b.rules.comment}`), " комментарий"),
        h("li", h("b", `+${b.rules.like}`), " лайк от другого человека на ваш пост"),
        h("li", h("b", `+${b.rules.member}`), " новый участник с вашего факультета — зовите однокурсников"),
        h("li", "Один человек приносит не больше ", h("b", String(b.rules.cap)), " очков в день. Свои лайки, удалённое и скрытое жалобами не считаются."),
        h("li", "Каждый понедельник в 00:00 по Москве — новый сезон.")
      )
    );

    body.replaceChildren(
      hero,
      h("div.battle-tabs", seg),
      ...(list.length
        ? [podium, rows]
        : [emptyState("🏁", mode === "points" ? "Неделя только началась" : "Пока мало участников", "Первый пост принесёт вашему факультету очки.")]),
      rules
    );

    if (podium && !reducedMotion()) {
      podium.querySelectorAll(".podium-step").forEach((s, i) => s.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], { duration: 500, delay: 80 * i, easing: "cubic-bezier(.2,.9,.3,1.2)", fill: "backwards" }));
    }
    requestAnimationFrame(() => rows.classList.add("grown"));
  }

  load();
  return { el };
}
