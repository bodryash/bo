/**
 * Имитация Bot API Telegram для локальной разработки и тестов: воркер ходит
 * сюда, если в .dev.vars указано TELEGRAM_API=http://127.0.0.1:8790.
 *
 *   node tools/mock-telegram.mjs
 *
 * Умеет то, чем пользуется Поток: sendDocument (хранит файл в памяти),
 * getFile и скачивание файла, sendMessage и прочие вызовы — просто
 * отвечает «ок» и записывает. Записи видны по GET /__calls — ими
 * пользуются тесты, чтобы проверить, что и кому бот отправил.
 */

import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 8790);
const files = new Map();
let calls = [];
let messageId = 100;

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/__calls") return send(res, 200, calls);
  if (url.pathname === "/__reset") {
    calls = [];
    return send(res, 200, { ok: true });
  }

  const file = /^\/file\/bot[^/]+\/(.+)$/.exec(url.pathname);
  if (file) {
    const stored = files.get(file[1]);
    return stored ? send(res, 200, stored.bytes, stored.type) : send(res, 404, "not found", "text/plain");
  }

  const m = /^\/bot([^/]+)\/(\w+)$/.exec(url.pathname);
  if (!m) return send(res, 404, { ok: false, description: "Not Found" });
  const method = m[2];

  const raw = await readBody(req);
  const request = new Request(url, { method: req.method, headers: req.headers, body: req.method === "POST" ? raw : undefined });
  let params = Object.fromEntries(url.searchParams);
  const type = req.headers["content-type"] || "";
  if (type.includes("application/json")) params = { ...params, ...JSON.parse(raw.toString() || "{}") };
  else if (type.includes("multipart/form-data")) {
    const form = await request.formData();
    for (const [k, v] of form) params[k] = v;
  }

  if (method === "sendDocument") {
    const doc = params.document;
    if (!doc || typeof doc === "string") return send(res, 400, { ok: false, description: "no document" });
    const id = `doc${files.size + 1}`;
    const bytes = Buffer.from(await doc.arrayBuffer());
    files.set(`documents/${id}`, { bytes, type: doc.type || "application/octet-stream" });
    calls.push({ method, chat_id: params.chat_id, name: doc.name, size: bytes.length });
    return send(res, 200, {
      ok: true,
      result: { message_id: ++messageId, chat: { id: Number(params.chat_id) }, document: { file_id: id, file_name: doc.name } },
    });
  }

  if (method === "getFile") {
    const path = `documents/${params.file_id}`;
    if (!files.has(path)) return send(res, 400, { ok: false, description: "Bad Request: invalid file_id" });
    return send(res, 200, { ok: true, result: { file_id: params.file_id, file_path: path } });
  }

  calls.push({ method, ...params });
  return send(res, 200, { ok: true, result: { message_id: ++messageId } });
}).listen(PORT, "127.0.0.1", () => console.log(`Имитация Telegram: http://127.0.0.1:${PORT}`));
