const app = document.getElementById("app");

const WEEKDAY_ORDER = [
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
  "Воскресенье",
];

const createElement = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) {
    el.className = className;
  }
  if (text) {
    el.textContent = text;
  }
  return el;
};

const createBadge = (text) => {
  const badge = createElement("span", "badge", text);
  const normalized = text.toLowerCase();

  if (normalized.includes("лекц")) {
    badge.classList.add("badge--lecture");
  } else if (normalized.includes("сем")) {
    badge.classList.add("badge--seminar");
  } else if (normalized.includes("лаб")) {
    badge.classList.add("badge--lab");
  }

  return badge;
};

const buildDayList = (days) => {
  const orderedDays = [
    ...WEEKDAY_ORDER.filter((day) => day in days),
    ...Object.keys(days).filter((day) => !WEEKDAY_ORDER.includes(day)),
  ];

  const dayList = createElement("div", "day-list");

  orderedDays.forEach((dayName) => {
    const dayCard = createElement("div", "day-card");
    dayCard.append(createElement("h4", "day-title", dayName));

    const lessons = days[dayName];
    if (!lessons || lessons.length === 0) {
      dayCard.append(createElement("p", "day-empty", "Занятий нет"));
      dayList.append(dayCard);
      return;
    }

    lessons.forEach((lesson) => {
      const lessonRow = createElement("div", "lesson");
      const time = createElement("div", "lesson-time", lesson.time);
      const subject = createElement("div", "lesson-subject", lesson.subject);

      const meta = createElement("div", "lesson-meta");
      if (lesson.type) {
        meta.append(createBadge(lesson.type));
      }
      if (lesson.room) {
        meta.append(createElement("span", "lesson-room", lesson.room));
      }

      lessonRow.append(time, subject, meta);
      dayCard.append(lessonRow);
    });

    dayList.append(dayCard);
  });

  return dayList;
};

const renderSchedule = (schedule) => {
  app.innerHTML = "";

  const header = createElement("header", "header");
  header.append(createElement("h1", "title", "Расписание занятий"));
  header.append(
    createElement(
      "p",
      "subtitle",
      "Выберите группу и смотрите актуальные пары для каждого курса."
    )
  );

  const container = createElement("div", "container");
  container.append(header);

  const courses = Object.keys(schedule);
  if (courses.length === 0) {
    container.append(
      createElement("p", "empty", "Пока нет данных по расписанию.")
    );
    app.append(container);
    return;
  }

  courses.forEach((courseName) => {
    const courseSection = createElement("section", "course");
    courseSection.append(createElement("h2", "course-title", courseName));

    const groups = schedule[courseName];
    const groupNames = Object.keys(groups);

    if (groupNames.length === 0) {
      courseSection.append(
        createElement(
          "p",
          "empty",
          "Нет групп для этого курса. Проверьте данные."
        )
      );
      container.append(courseSection);
      return;
    }

    const groupGrid = createElement("div", "group-grid");

    groupNames.forEach((groupName) => {
      const groupCard = createElement("article", "group-card");
      groupCard.append(
        createElement("div", "group-title", `Группа ${groupName}`)
      );

      const days = groups[groupName];
      groupCard.append(buildDayList(days));
      groupGrid.append(groupCard);
    });

    courseSection.append(groupGrid);
    container.append(courseSection);
  });

  app.append(container);
};

app.innerHTML = "<p class='loading'>⏳ Загружаем расписание...</p>";

fetch("data/schedule.json")
  .then((res) => {
    if (!res.ok) {
      throw new Error("schedule.json не найден");
    }
    return res.json();
  })
  .then((schedule) => {
    if (!schedule || typeof schedule !== "object") {
      throw new Error("Некорректный формат расписания");
    }
    renderSchedule(schedule);
  })
  .catch((err) => {
    app.innerHTML = `<p class="error">❌ ${err.message}</p>`;
  });
