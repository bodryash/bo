let schedule = {};
let selectedCourse = "1 курс";
let selectedGroup = "101";

async function loadSchedule() {
  const res = await fetch("data/schedule.json");
  schedule = await res.json();
  render();
}

function render() {
  document.getElementById("app").innerHTML = `
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
    schedule?.[selectedCourse]?.[selectedGroup]?.[day] || [];

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

loadSchedule();
