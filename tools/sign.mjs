/**
 * Подписанный initData для локальной разработки: воркер проверяет подпись
 * настоящим алгоритмом Telegram, поэтому для `wrangler dev` строку надо
 * подписать тем же токеном, что лежит в .dev.vars.
 *
 *   node tools/sign.mjs 1001 "Аня"   → печатает строку initData
 *
 * В браузере её подставляет dev.html — открыть http://localhost:8787/dev.html.
 */

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

export function signInitData(token, user, extra = {}) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "dev",
    user: JSON.stringify(user),
    ...extra,
  });
  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(checkString).digest("hex"));
  return params.toString();
}

export function devToken() {
  const vars = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
  return /^BOT_TOKEN=(.*)$/m.exec(vars)?.[1]?.trim();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const id = Number(process.argv[2] || 1001);
  const name = process.argv[3] || "Студент";
  console.log(signInitData(devToken(), { id, first_name: name, username: `user${id}`, language_code: "ru" }));
}
