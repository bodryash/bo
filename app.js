const app = document.getElementById("app");

app.innerHTML = "<p>⏳ Загружаем расписание...</p>";

fetch("data/schedule.json")
  .then((res) => {
    if (!res.ok) {
      throw new Error("Не удалось загрузить schedule.json");
    }
    return res.json();
  })
  .then((data) => {
    console.log("schedule.json загружен:", data);

    if (Object.keys(data).length === 0) {
      app.innerHTML = "<p>⚠️ Расписание пустое</p>";
      return;
    }

    app.innerHTML = `
      <div class="card">
        <h2>📚 1 курс · Группа 101</h2>
        <h4>Понедельник</h4>
        <div class="lesson">
          <div class="time">09:00–10:30</div>
          <div class="subject">История</div>
          <div class="meta">лекция · Ауд. 101</div>
        </div>
      </div>
    `;
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

