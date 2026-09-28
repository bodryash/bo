/**
 * Фото с телефона весят 3–10 МБ — через мобильный интернет это долго и
 * дорого. Перед отправкой уменьшаем до 1600 точек по длинной стороне и
 * пережимаем в JPEG: 200–600 КБ, на экране телефона разницы не видно.
 */

const MAX_SIDE = 1600;
const QUALITY = 0.82;

export async function prepareImage(file) {
  if (!file.type.startsWith("image/")) throw new Error("Это не изображение");
  const source = await decode(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  // У PNG с прозрачностью фон стал бы чёрным — подкладываем белый.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source.image, 0, 0, w, h);
  source.close?.();

  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Не удалось обработать фото"))), "image/jpeg", QUALITY)
  );
  return { blob, w, h, preview: URL.createObjectURL(blob) };
}

async function decode(file) {
  // createImageBitmap сам учитывает поворот из EXIF — иначе фото с
  // айфона ложились бы на бок.
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // старые WebView — ниже запасной путь через <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Этот формат фото не открывается — попробуйте JPEG"));
      el.src = url;
    });
    return { image: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}
