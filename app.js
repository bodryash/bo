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

const parseCourseOrder = (name) => {
  const lower = name.toLowerCase();
  const isMaster = /магист/.test(lower);
  const isBachelor = /бакалав/.test(lower);
  const numberMatch = lower.match(/\d+/);
  const number = numberMatch ? Number(numberMatch[0]) : 999;

  if (isMaster) {
    return 100 + number;
  }

  if (isBachelor || numberMatch) {
    return number;
  }

  return 200 + number;
};

const createCourseNav = (courses) => {
  const nav = createElement("nav", "course-nav");
  const list = createElement("div", "course-nav__list");

  courses.forEach((course, index) => {
    const button = createElement("button", "course-pill", course.label);
    button.type = "button";
    button.dataset.target = course.id;
    if (index === 0) {
      button.classList.add("course-pill--active");
    }
    list.append(button);
  });

  nav.append(list);
  return nav;
};

const setupCourseNav = (nav, sections) => {
  if (!nav || sections.length === 0) {
    return;
  }

  const pills = Array.from(nav.querySelectorAll(".course-pill"));
  const pillById = new Map(pills.map((pill) => [pill.dataset.target, pill]));

  nav.addEventListener("click", (event) => {
    const button = event.target.closest(".course-pill");
    if (!button) {
      return;
    }
    const targetId = button.dataset.target;
    const section = document.getElementById(targetId);
    if (section) {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }
        const active = pillById.get(entry.target.id);
        if (!active) {
          return;
        }
        pills.forEach((pill) => pill.classList.remove("course-pill--active"));
        active.classList.add("course-pill--active");
      });
    },
    { threshold: 0.4 }
  );

  sections.forEach((section) => observer.observe(section));
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

const sanitizeJson = (raw) => {
  const withoutBom = raw.replace(/^\uFEFF/, "").trim();
  const firstBrace = withoutBom.search(/[\[{]/);
  const lastBrace = Math.max(
    withoutBom.lastIndexOf("}"),
    withoutBom.lastIndexOf("]")
  );

  if (firstBrace === -1 || lastBrace === -1) {
    return withoutBom;
  }

  const sliced = withoutBom.slice(firstBrace, lastBrace + 1);
  const withoutComments = sliced
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  return withoutComments.replace(/,\s*([}\]])/g, "$1");
};

const getJsonErrorLocation = (text, error) => {
  const match = /position\s+(\d+)/i.exec(error.message || "");
  if (!match) {
    return "";
  }

  const index = Number(match[1]);
  if (Number.isNaN(index)) {
    return "";
  }

  const upToIndex = text.slice(0, index);
  const lines = upToIndex.split("\n");
  const line = lines.length;
  const column = lines[lines.length - 1].length + 1;

  return ` Ошибка на строке ${line}, столбце ${column}.`;
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

  const courses = Object.keys(schedule)
    .sort((a, b) => parseCourseOrder(a) - parseCourseOrder(b))
    .map((courseName, index) => ({
      name: courseName,
      id: `course-${index + 1}`,
      label: courseName,
    }));
  if (courses.length === 0) {
    container.append(
      createElement("p", "empty", "Пока нет данных по расписанию.")
    );
    app.append(container);
    return;
  }

  const nav = createCourseNav(courses);
  container.append(nav);

  const sections = [];

  courses.forEach((course, index) => {
    const courseSection = createElement("section", "course");
    courseSection.id = course.id;
    if (index === 0) {
      courseSection.classList.add("course--active");
    }
    courseSection.append(createElement("h2", "course-title", course.name));

    const groups = schedule[course.name];
    const groupNames = Object.keys(groups).sort((a, b) =>
      a.localeCompare(b, "ru", { numeric: true })
    );

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
    sections.push(courseSection);
  });

  app.append(container);
  setupCourseNav(nav, sections);
};

app.innerHTML = "<p class='loading'>⏳ Загружаем расписание...</p>";

fetch("data/schedule.json", { cache: "no-store" })
  .then((res) => {
    if (!res.ok) {
      throw new Error("schedule.json не найден");
    }
    return res.text();
  })
  .then((rawText) => {
    const sanitized = sanitizeJson(rawText);
    let parsed;

    try {
      parsed = JSON.parse(sanitized);
    } catch (error) {
      const details = getJsonErrorLocation(sanitized, error);
      throw new Error(
        `Некорректный формат расписания.${details} Проверьте JSON в data/schedule.json.`
      );
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Некорректный формат расписания");
    }

    renderSchedule(parsed);
  })
  .catch((err) => {
    app.innerHTML = `<p class="error">❌ ${err.message}</p>`;
  });
