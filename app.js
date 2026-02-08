const app = document.getElementById("app");

app.innerHTML = "<p>⏳ Загружаем расписание...</p>";

let schedule = {};
const selectedCourse = "1 курс";
const selectedGroup = "101";

fetch("data/schedule.json")
  .then((res) => {
    if (!res.ok) {
      throw new Error("Не удалось загрузить schedule.json");
    }
    return res.json();
  })
  .then((data) => {
    schedule = data;

    if (!schedule[selectedCourse] || !schedule[selectedCourse][selectedGroup]) {
      app.innerHTML = "<p>⚠️ Нет данных для выбранной группы</p>";
      return;
    }

    render();
  })
  .catch((err) => {
    console.error(err);
    app.innerHTML = `
      <p style="color:red;">
        ❌ Ошибка загрузки данных<br>
        ${err.message}
      </p>
    `;
  });

function render() {
  app.innerHTML = `
    <div class="card">
      <h2>📚 ${selectedCourse}</h2>
      <h3>👥 Группа ${selectedGroup}</h3>
      ${renderDay("Понедельник")}
      ${renderDay("Вторник")}
    </div>
  `;
}

function renderDay(day) {
  const lessons =
    schedule[selectedCourse][selectedGroup][day] || [];

  if (lessons.length === 0) {
    return `<p><b>${day}</b>: занятий нет</p>`;
  }

  return `
    <h4>${day}</h4>
    ${lessons
      .map(
        (l) => `
        <div class="lesson">
          <div class="time">${l.time}</div>
          <div class="subject">${l.subject}</div>
          <div class="meta">${l.type} • ${l.room}</div>
        </div>
      `
      )
      .join("")}
  `;
}

