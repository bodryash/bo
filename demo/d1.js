/**
 * Та часть API D1, которой пользуется воркер, — поверх sql.js (SQLite,
 * собранный в JavaScript). Воркер не знает, что он в браузере: запросы
 * те же, база та же SQLite.
 */

const norm = (v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v);

class Statement {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }

  bind(...args) {
    return new Statement(this.db, this.sql, args);
  }

  exec() {
    const st = this.db.prepare(this.sql);
    try {
      if (this.args.length) st.bind(this.args.map(norm));
      const rows = [];
      while (st.step()) rows.push(st.getAsObject());
      return { rows, changes: this.db.getRowsModified() };
    } finally {
      st.free();
    }
  }

  async first(column) {
    const row = this.exec().rows[0];
    if (!row) return null;
    return column ? row[column] : row;
  }

  async all() {
    return { results: this.exec().rows, success: true, meta: {} };
  }

  async run() {
    const { rows, changes } = this.exec();
    return { results: rows, success: true, meta: { changes } };
  }
}

export function createD1(SQL) {
  const db = new SQL.Database();
  return {
    raw: db,
    prepare: (sql) => new Statement(db, sql),
    async batch(statements) {
      const out = [];
      for (const s of statements) out.push(await s.run());
      return out;
    },
    async exec(sql) {
      db.exec(sql);
    },
  };
}

/** Хранилище фото вместо R2: файлы живут в памяти вкладки. */
export function createMedia() {
  const files = new Map();
  const urls = new Map();
  return {
    async put(key, bytes, opts) {
      files.set(key, new Blob([bytes], { type: opts?.httpMetadata?.contentType || "image/jpeg" }));
    },
    async get(key) {
      const blob = files.get(key);
      return blob ? { body: blob, httpMetadata: { contentType: blob.type }, httpEtag: key } : null;
    },
    async delete(keys) {
      for (const key of [].concat(keys)) files.delete(key);
    },
    url(key) {
      if (!urls.has(key) && files.has(key)) urls.set(key, URL.createObjectURL(files.get(key)));
      return urls.get(key) || null;
    },
  };
}
