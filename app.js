const app = document.getElementById("app");

app.innerHTML = "<p>⏳ Загружаем расписание...</p>";

fetch("data/schedule.json")
  .then((res) => {
    if (!res.ok) {
      throw new Error("schedule.json не найден");
    }
    return res.json();
  })
  .then((schedule) => {
    const course = "1 курс";
    const group = "101";

    if (!schedule[course] || !schedule[course][group]) {
      app.innerHTML = "<p>❌ Нет данных для 1 курса, группы 101</p>";
      return;
    }

    let html = `
      <div class="card">
        <h2>📚 ${course}</h2>
        <h3>👥 Группа ${group}</h3>
    `;

    const days = schedule[course][group];

    for (const day in days) {
      html += `<h4>${day}</h4>`;

      if (days[day].length === 0) {
        html += `<p>занятий нет</p>`;
        continue;
      }

      days[day].forEach((lesson) => {
        html += `
          <div class="lesson">
            <div class="time">${lesson.time}</div>
            <div class="subject">${lesson.subject}</div>
            <div class="meta">${lesson.type} • ${lesson.room}</div>
          </div>
        `;
      });
    }

    html += `</div>`;
    app.innerHTML = html;
  })
  .catch((err) => {
    app.innerHTML = `<p style="color:red">❌ ${err.message}</p>`;
  });

