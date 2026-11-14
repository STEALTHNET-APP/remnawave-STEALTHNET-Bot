// T-list-send (портировано из WolfVPN): парсер списка Telegram ID из текста / .txt / .csv.
// Умеет несколько столбцов: определяет разделитель, заголовок и колонку с ID
// (по имени или по доле «похоже на Telegram ID»), но даёт переопределить вручную.

export interface ParsedTable {
  /** Все строки, разбитые на ячейки (включая заголовок, если он есть). */
  rows: string[][];
  /** Распознан ли заголовок (первая строка с именами колонок). */
  hasHeader: boolean;
  /** Имена колонок, если есть заголовок. */
  header: string[] | null;
  /** Максимальное число столбцов в файле. */
  columnCount: number;
}

// Кандидаты на имя колонки с Telegram ID (нормализованные: без _ - пробелов).
const ID_KEY_CANDIDATES = [
  "telegramid", "tgid", "chatid", "telegram", "tg", "userid", "id",
];

// Определяем разделитель по строке: запятая / точка с запятой / таб / вертикальная черта.
function detectDelimiter(sample: string): string {
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    const count = sample.split(d).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return bestCount === 0 ? "," : best;
}

// Разбор одной строки CSV с поддержкой кавычек ("a,b" → одна ячейка, "" → экранированная кавычка).
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// Telegram ID — 5..15 цифр (отсекаем мелкие индексы 1,2,3 и аномально длинные значения).
function looksLikeId(s: string): boolean {
  return /^\d{5,15}$/.test(s.trim());
}

export function parseTable(text: string): ParsedTable {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { rows: [], hasHeader: false, header: null, columnCount: 0 };
  }
  const delim = detectDelimiter(lines[0]);
  const rows = lines.map((l) => splitLine(l, delim));
  const columnCount = Math.max(...rows.map((r) => r.length));

  // Заголовок: первая строка без «похоже на ID», но с буквами, и есть строки данных ниже.
  const first = rows[0];
  const firstHasId = first.some(looksLikeId);
  const firstHasAlpha = first.some((c) => /[a-zа-яё]/i.test(c));
  const hasHeader = !firstHasId && firstHasAlpha && rows.length > 1;

  return {
    rows,
    hasHeader,
    header: hasHeader ? first.map((c) => c.trim()) : null,
    columnCount,
  };
}

// Авто-выбор колонки с ID: сначала по имени заголовка, затем по доле «похоже на ID».
export function autoDetectIdColumn(table: ParsedTable): number {
  const { rows, hasHeader, header, columnCount } = table;
  if (columnCount <= 1) return 0;

  if (hasHeader && header) {
    const norm = (s: string) => s.toLowerCase().replace(/[\s_-]/g, "");
    // точное совпадение имени
    for (const cand of ID_KEY_CANDIDATES) {
      const idx = header.findIndex((h) => norm(h) === cand);
      if (idx >= 0) return idx;
    }
    // частичное вхождение (например "user_telegram_id")
    for (const cand of ID_KEY_CANDIDATES) {
      const idx = header.findIndex((h) => norm(h).includes(cand));
      if (idx >= 0) return idx;
    }
  }

  // по доле значений, похожих на ID
  const dataRows = hasHeader ? rows.slice(1) : rows;
  let best = 0;
  let bestScore = -1;
  for (let c = 0; c < columnCount; c++) {
    let idCount = 0;
    let total = 0;
    for (const r of dataRows) {
      const v = (r[c] ?? "").trim();
      if (!v) continue;
      total++;
      if (looksLikeId(v)) idCount++;
    }
    const score = total > 0 ? idCount / total : 0;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// Извлечь уникальные ID из выбранной колонки (вытаскивает число даже из «грязной» ячейки).
export function extractIds(table: ParsedTable, columnIndex: number): string[] {
  const { rows, hasHeader, columnCount } = table;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const out: string[] = [];
  for (const r of dataRows) {
    const cell = columnCount <= 1 ? (r[0] ?? "") : (r[columnIndex] ?? "");
    const m = cell.match(/\d{5,15}/);
    if (m) out.push(m[0]);
  }
  return Array.from(new Set(out));
}

// ───── EMAIL (тот же подход, но для адресов) ─────
const EMAIL_RE = /[^@\s]+@[^@\s]+\.[^@\s]+/;
const EMAIL_KEY_CANDIDATES = ["email", "mail", "почта", "емейл", "имейл"];

function looksLikeEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
}

// Авто-выбор колонки с email: по имени заголовка, затем по доле «похоже на email».
export function autoDetectEmailColumn(table: ParsedTable): number {
  const { rows, hasHeader, header, columnCount } = table;
  if (columnCount <= 1) return 0;

  if (hasHeader && header) {
    const norm = (s: string) => s.toLowerCase().replace(/[\s_-]/g, "");
    for (const cand of EMAIL_KEY_CANDIDATES) {
      const idx = header.findIndex((h) => norm(h) === cand);
      if (idx >= 0) return idx;
    }
    for (const cand of EMAIL_KEY_CANDIDATES) {
      const idx = header.findIndex((h) => norm(h).includes(cand));
      if (idx >= 0) return idx;
    }
  }

  const dataRows = hasHeader ? rows.slice(1) : rows;
  let best = 0;
  let bestScore = -1;
  for (let c = 0; c < columnCount; c++) {
    let hit = 0;
    let total = 0;
    for (const r of dataRows) {
      const v = (r[c] ?? "").trim();
      if (!v) continue;
      total++;
      if (looksLikeEmail(v)) hit++;
    }
    const score = total > 0 ? hit / total : 0;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// Извлечь уникальные email из выбранной колонки.
export function extractEmails(table: ParsedTable, columnIndex: number): string[] {
  const { rows, hasHeader, columnCount } = table;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const out: string[] = [];
  for (const r of dataRows) {
    const cell = columnCount <= 1 ? (r[0] ?? "") : (r[columnIndex] ?? "");
    const m = cell.match(EMAIL_RE);
    if (m) out.push(m[0].trim().toLowerCase());
  }
  return Array.from(new Set(out));
}
