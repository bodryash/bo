/**
 * Проверка фото нейросетью без сети: подставная Workers AI. Запуск:
 *   node tests/vision.mjs
 */
import assert from "node:assert/strict";
const settings = new Map();
const DB = { prepare: (sql) => ({ bind: (...a) => ({ run: async () => settings.set("vision", a[0]), first: async () => settings.get("vision") ?? null }), first: async () => settings.get("vision") ?? null }) };
const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const calls = [];
// 1: первая модель падает, вторая отвечает «NSFW.»
let mod = await import("../src/vision.js?1");
let env = { DB, AI: { run: async (m, input) => { calls.push(m); if (m.includes("llama-4")) throw new Error("5006: model not found"); return { response: " NSFW." }; } } };
assert.equal(await mod.checkPhoto(env, bytes, "image/jpeg"), "nsfw");
assert.deepEqual(calls, ["@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/google/gemma-3-12b-it"]);
// запомнила рабочую — следующая проверка сразу на ней
calls.length = 0;
env.AI.run = async (m, input) => { calls.push(m); assert.ok(input.messages[0].content[1].image_url.url.startsWith("data:image/jpeg;base64,/9j/")); return { response: "SAFE" }; };
assert.equal(await mod.checkPhoto(env, bytes, "image/jpeg"), "safe");
assert.deepEqual(calls, ["@cf/google/gemma-3-12b-it"]);
assert.match(await mod.visionStatus(env), /работает \(@cf\/google\/gemma-3-12b-it\)/);

// 2: только llama-3.2 и лицензия
mod = await import("../src/vision.js?2");
let agreed = false; calls.length = 0;
env = { DB, AI: { run: async (m, input) => {
  calls.push(m + (input.prompt ? ":" + input.prompt : ""));
  if (!m.includes("3.2")) throw new Error("no such model");
  if (input.prompt === "agree") { agreed = true; return { response: "ok" }; }
  if (!agreed) throw new Error("Prior to using this model, you must submit the prompt 'agree'");
  assert.ok(Array.isArray(input.image) && input.image.length === bytes.length);
  return { response: "safe" };
} } };
assert.equal(await mod.checkPhoto(env, bytes, "image/jpeg"), "safe");
assert.ok(calls.includes("@cf/meta/llama-3.2-11b-vision-instruct:agree"));

// 3: все падают — null, пауза, статус с ошибкой, без исключений
mod = await import("../src/vision.js?3");
let n = 0;
env = { DB, AI: { run: async () => { n++; throw new Error("quota exceeded"); } } };
assert.equal(await mod.checkPhoto(env, bytes, "image/jpeg"), null);
assert.equal(n, 3);
assert.equal(await mod.checkPhoto(env, bytes, "image/jpeg"), null);
assert.equal(n, 3, "десять минут не пробуем снова");
assert.match(await mod.visionStatus(env), /ошибка — .*quota exceeded/);

// 4: непонятный ответ — не вердикт
mod = await import("../src/vision.js?4");
env = { DB, AI: { run: async () => ({ response: "I cannot help with that" }) } };
assert.equal(await mod.checkPhoto(env, bytes, "image/jpeg"), null);
// 5: без привязки — null и понятный статус
assert.equal(await mod.checkPhoto({ DB }, bytes, "image/jpeg"), null);
assert.match(await mod.visionStatus({ DB }), /не подключена/);
// большие фото: base64 без переполнения стека
const big = new Uint8Array(900_000).fill(7);
env = { DB, AI: { run: async (m, input) => ({ response: input.messages[0].content[1].image_url.url.length > 1_000_000 ? "SAFE" : "?" }) } };
mod = await import("../src/vision.js?5");
assert.equal(await mod.checkPhoto(env, big, "image/jpeg"), "safe");
console.log("vision: всё верно");
