/**
 * Картинки для демо-постов рисуются на месте: так демо не тянет файлы
 * со стороны и не выдаёт чужие фото за студенческие.
 */

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")];
}

function wrap(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, y);
  return y;
}

/** Обложка задачника на столе. */
export function drawBook() {
  const [c, ctx] = canvas(1200, 1200);
  const table = ctx.createLinearGradient(0, 0, 1200, 1200);
  table.addColorStop(0, "#c9a57c");
  table.addColorStop(1, "#9c7651");
  ctx.fillStyle = table;
  ctx.fillRect(0, 0, 1200, 1200);
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = `rgba(90, 60, 30, ${0.05 + (i % 3) * 0.03})`;
    ctx.lineWidth = 2 + (i % 4);
    ctx.beginPath();
    ctx.moveTo(0, i * 34);
    ctx.bezierCurveTo(400, i * 34 + 20, 800, i * 34 - 20, 1200, i * 34 + 10);
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(600, 600);
  ctx.rotate(-0.06);
  ctx.shadowColor = "rgba(0,0,0,.35)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 20;
  ctx.fillStyle = "#6e1d27";
  ctx.fillRect(-330, -450, 660, 900);
  ctx.shadowColor = "transparent";
  ctx.fillStyle = "#5a1720";
  ctx.fillRect(-330, -450, 34, 900);
  ctx.strokeStyle = "#d9b56a";
  ctx.lineWidth = 3;
  ctx.strokeRect(-270, -400, 570, 800);

  ctx.fillStyle = "#e8c77e";
  ctx.textAlign = "center";
  ctx.font = "600 34px Georgia, 'Times New Roman', serif";
  ctx.fillText("Б. П. ДЕМИДОВИЧ", 15, -300);
  ctx.font = "700 56px Georgia, 'Times New Roman', serif";
  wrap(ctx, "СБОРНИК ЗАДАЧ И УПРАЖНЕНИЙ", 15, -150, 500, 70);
  ctx.font = "italic 40px Georgia, 'Times New Roman', serif";
  wrap(ctx, "по математическому анализу", 15, 20, 500, 52);
  ctx.font = "56px Georgia, serif";
  ctx.fillText("∫ ∑ ∂", 15, 200);
  ctx.font = "600 28px Georgia, serif";
  ctx.fillText("МОСКВА", 15, 350);
  ctx.restore();

  ctx.save();
  ctx.translate(900, 980);
  ctx.rotate(0.5);
  ctx.fillStyle = "#f3c63f";
  ctx.fillRect(-10, -160, 20, 300);
  ctx.fillStyle = "#e9a7a0";
  ctx.fillRect(-10, 140, 20, 26);
  ctx.fillStyle = "#333";
  ctx.beginPath();
  ctx.moveTo(-10, -160);
  ctx.lineTo(10, -160);
  ctx.lineTo(0, -196);
  ctx.fill();
  ctx.restore();
  return c;
}

/** Афиша квиза. */
export function drawQuiz() {
  const [c, ctx] = canvas(1200, 900);
  const bg = ctx.createRadialGradient(850, 250, 50, 700, 450, 900);
  bg.addColorStop(0, "#3b2a8f");
  bg.addColorStop(1, "#120d2e");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1200, 900);

  for (let i = 0; i < 90; i++) {
    const x = (i * 137) % 1200;
    const y = (i * 251) % 900;
    ctx.fillStyle = `rgba(255,255,255,${0.15 + (i % 5) * 0.12})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.5 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = "rgba(255, 200, 90, 0.9)";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(900, 330, 170, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 6;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(900 + Math.cos(a) * 190, 330 + Math.sin(a) * 190);
    ctx.lineTo(900 + Math.cos(a) * 215, 330 + Math.sin(a) * 215);
    ctx.stroke();
  }
  ctx.fillStyle = "#ffc85a";
  ctx.beginPath();
  ctx.moveTo(900, 330);
  ctx.lineTo(1000, 230);
  ctx.lineTo(912, 342);
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  ctx.font = "800 150px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  ctx.fillText("Что?", 80, 260);
  ctx.fillText("Где?", 80, 420);
  ctx.fillStyle = "#ffc85a";
  ctx.fillText("Когда?", 80, 580);
  ctx.fillStyle = "rgba(255,255,255,.85)";
  ctx.font = "600 44px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  ctx.fillText("Межфакультетский квиз", 84, 700);
  ctx.fillStyle = "rgba(255,255,255,.6)";
  ctx.font = "500 36px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  ctx.fillText("ДК МГУ · команды по 6 человек", 84, 770);
  return c;
}

/** Найденный пропуск на подоконнике. */
export function drawPass() {
  const [c, ctx] = canvas(1200, 900);
  const bg = ctx.createLinearGradient(0, 0, 0, 900);
  bg.addColorStop(0, "#dfe4ea");
  bg.addColorStop(1, "#b9c1cb");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1200, 900);

  ctx.save();
  ctx.translate(600, 460);
  ctx.rotate(0.08);
  ctx.shadowColor = "rgba(0,0,0,.3)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 14;
  const card = new Path2D();
  card.roundRect(-380, -240, 760, 480, 36);
  ctx.fillStyle = "#fff";
  ctx.fill(card);
  ctx.shadowColor = "transparent";
  ctx.save();
  ctx.clip(card);
  ctx.fillStyle = "#1f4e9c";
  ctx.fillRect(-380, -240, 760, 120);
  ctx.restore();

  ctx.fillStyle = "#fff";
  ctx.font = "800 54px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  ctx.fillText("МГУ", -330, -160);
  ctx.font = "600 30px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  ctx.fillText("ПРОПУСК", -170, -164);

  ctx.fillStyle = "#cfd6df";
  const photo = new Path2D();
  photo.roundRect(-330, -80, 190, 240, 16);
  ctx.fill(photo);
  ctx.fillStyle = "#9aa6b5";
  ctx.beginPath();
  ctx.arc(-235, 0, 50, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-235, 130, 80, 60, 0, Math.PI, 0);
  ctx.fill();

  ctx.fillStyle = "#1c2430";
  ctx.font = "700 44px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  ctx.fillText("Кирилл Н.", -100, -30);
  ctx.fillStyle = "#6b7684";
  ctx.font = "500 30px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  ctx.fillText("Исторический факультет", -100, 20);
  ctx.fillText("Студент · 2026–2030", -100, 64);
  ctx.fillStyle = "#1c2430";
  for (let i = 0; i < 26; i++) ctx.fillRect(-100 + i * 16, 120, i % 3 ? 6 : 10, 50);
  ctx.restore();
  return c;
}
