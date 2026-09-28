/**
 * Справочники, общие для приложения и воркера: воркер импортирует этот же
 * файл, поэтому проверка «такой факультет существует» и список на экране
 * не могут разойтись.
 */

// Код — то, что хранится в базе; менять его нельзя, иначе посты факультета
// потеряют свою ленту. Название и сокращение можно править свободно.
export const FACULTIES = [
  { id: "mech", short: "Мехмат", name: "Механико-математический факультет" },
  { id: "cmc", short: "ВМК", name: "Факультет вычислительной математики и кибернетики" },
  { id: "phys", short: "Физфак", name: "Физический факультет" },
  { id: "chem", short: "Химфак", name: "Химический факультет" },
  { id: "fnm", short: "ФНМ", name: "Факультет наук о материалах" },
  { id: "ffhi", short: "ФФФХИ", name: "Факультет фундаментальной физико-химической инженерии" },
  { id: "cosmos", short: "ФКИ", name: "Факультет космических исследований" },
  { id: "bio", short: "Биофак", name: "Биологический факультет" },
  { id: "fbb", short: "ФББ", name: "Факультет биоинженерии и биоинформатики" },
  { id: "biotech", short: "Биотех", name: "Биотехнологический факультет" },
  { id: "ffm", short: "ФФМ", name: "Факультет фундаментальной медицины" },
  { id: "soil", short: "Почвенный", name: "Факультет почвоведения" },
  { id: "geol", short: "Геологический", name: "Геологический факультет" },
  { id: "geo", short: "Геофак", name: "Географический факультет" },
  { id: "hist", short: "Истфак", name: "Исторический факультет" },
  { id: "philol", short: "Филфак", name: "Филологический факультет" },
  { id: "philos", short: "Философский", name: "Философский факультет" },
  { id: "econ", short: "Экономфак", name: "Экономический факультет" },
  { id: "law", short: "Юрфак", name: "Юридический факультет" },
  { id: "journ", short: "Журфак", name: "Факультет журналистики" },
  { id: "psy", short: "Психфак", name: "Факультет психологии" },
  { id: "soc", short: "Социофак", name: "Социологический факультет" },
  { id: "polit", short: "Политфак", name: "Факультет политологии" },
  { id: "iaas", short: "ИСАА", name: "Институт стран Азии и Африки" },
  { id: "fflas", short: "ФИЯР", name: "Факультет иностранных языков и регионоведения" },
  { id: "fgp", short: "ФГП", name: "Факультет глобальных процессов" },
  { id: "fmp", short: "ФМП", name: "Факультет мировой политики" },
  { id: "spa", short: "ФГУ", name: "Факультет государственного управления" },
  { id: "fpo", short: "ФПО", name: "Факультет педагогического образования" },
  { id: "arts", short: "Факультет искусств", name: "Факультет искусств" },
  { id: "hsb", short: "ВШБ", name: "Высшая школа бизнеса" },
  { id: "hsga", short: "ВШГАуд", name: "Высшая школа государственного аудита" },
  { id: "hspa", short: "ВШГАдм", name: "Высшая школа государственного администрирования" },
  { id: "hsmi", short: "ВШУИ", name: "Высшая школа управления и инноваций" },
  { id: "hsib", short: "ВШИБ", name: "Высшая школа инновационного бизнеса" },
  { id: "hst", short: "ВШП", name: "Высшая школа перевода" },
  { id: "hsss", short: "ВШСН", name: "Высшая школа современных социальных наук" },
  { id: "hstv", short: "ВШТ", name: "Высшая школа телевидения" },
  { id: "hscp", short: "ВШКП", name: "Высшая школа культурной политики и управления в гуманитарной сфере" },
  { id: "mse", short: "МШЭ", name: "Московская школа экономики" },
  { id: "other", short: "МГУ", name: "Другое подразделение" },
];

export const FACULTY = Object.fromEntries(FACULTIES.map((f) => [f.id, f]));

// Сколько лет длится ступень: курсом больше выбрать нельзя.
export const LEVELS = [
  { id: "bach", name: "Бакалавриат", short: "", years: 4 },
  { id: "spec", name: "Специалитет", short: "спец.", years: 6 },
  { id: "mag", name: "Магистратура", short: "маг.", years: 2 },
  { id: "phd", name: "Аспирантура", short: "асп.", years: 4 },
  { id: "alum", name: "Выпускник", short: "", years: 0 },
];

export const LEVEL = Object.fromEntries(LEVELS.map((l) => [l.id, l]));

// Рубрика решает, какие поля есть у поста: у барахолки цена, у события —
// дата и место. «Подслушано» всегда анонимно — ради этого туда и пишут.
export const RUBRICS = [
  { id: "talk", name: "Общее", emoji: "💬" },
  { id: "study", name: "Учёба", emoji: "📚" },
  { id: "confess", name: "Подслушано", emoji: "🤫", anonymous: true },
  { id: "event", name: "События", emoji: "📅" },
  { id: "market", name: "Барахолка", emoji: "🛍" },
  { id: "lost", name: "Бюро находок", emoji: "🔎" },
  { id: "housing", name: "Жильё", emoji: "🏠" },
];

export const RUBRIC = Object.fromEntries(RUBRICS.map((r) => [r.id, r]));

export const REPORT_REASONS = [
  { id: "spam", name: "Спам или реклама" },
  { id: "abuse", name: "Оскорбления, травля" },
  { id: "personal", name: "Чужие личные данные" },
  { id: "nsfw", name: "Порно, 18+" },
  { id: "fraud", name: "Мошенничество" },
  { id: "other", name: "Другое" },
];

export const LIMITS = {
  postText: 3000,
  commentText: 1000,
  bio: 200,
  photos: 6,
  pollOptions: 6,
  pollOption: 80,
  place: 120,
};

/** Подпись под именем: «ФГП · 3 курс», «ВМК · 1 курс маг.» — коротко, в одну строку. */
export function studentLine(u) {
  if (!u) return "";
  const parts = [];
  const f = FACULTY[u.faculty];
  if (f) parts.push(f.short);
  const level = LEVEL[u.level];
  if (level?.id === "alum") parts.push("выпускник");
  else if (u.course) parts.push([`${u.course} курс`, level?.short].filter(Boolean).join(" "));
  return parts.join(" · ");
}
