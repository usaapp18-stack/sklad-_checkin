/**
 * Utility functions for local browser Time, TimeZone, and date calculations
 */

export function getLocalDate(): Date {
  return new Date();
}

// Backward-compatible alias
export const getMoscowDate = getLocalDate;

export function getBrowserTimeZoneLabel(): string {
  try {
    if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const offsetMinutes = -new Date().getTimezoneOffset();
      const sign = offsetMinutes >= 0 ? '+' : '-';
      const hours = Math.floor(Math.abs(offsetMinutes) / 60);
      const mins = Math.abs(offsetMinutes) % 60;
      const offsetStr = `UTC${sign}${hours}${mins > 0 ? `:${mins.toString().padStart(2, '0')}` : ''}`;

      if (tz) {
        const rawCity = tz.split('/').pop()?.replace(/_/g, ' ');
        const cityMap: Record<string, string> = {
          Moscow: 'Москва',
          Samara: 'Самара',
          Yekaterinburg: 'Екатеринбург',
          Omsk: 'Омск',
          Novosibirsk: 'Новосибирск',
          Krasnoyarsk: 'Красноярск',
          Irkutsk: 'Иркутск',
          Yakutsk: 'Якутск',
          Vladivostok: 'Владивосток',
          Magadan: 'Магадан',
          Kamchatka: 'Камчатка',
          Kaliningrad: 'Калининград',
          Volgograd: 'Волгоград',
          Saratov: 'Саратов',
          Ulyanovsk: 'Ульяновск',
          Astrakhan: 'Астрахань',
          Barnaul: 'Барнаул',
          Tomsk: 'Томск',
          Novokuznetsk: 'Новокузнецк',
          Chita: 'Чита',
          Sakhalin: 'Сахалин',
          Anadyr: 'Анадырь',
          Minsk: 'Минск',
          Kiev: 'Киев',
          Kyiv: 'Киев',
          Almaty: 'Алматы',
          Tashkent: 'Ташкент',
          Bishkek: 'Бишкек',
          Yerevan: 'Ереван',
          Baku: 'Баку',
          Tbilisi: 'Тбилиси',
        };
        const localizedCity = rawCity ? (cityMap[rawCity] || rawCity) : '';
        return localizedCity ? `${localizedCity}, ${offsetStr}` : offsetStr;
      }
      return offsetStr;
    }
  } catch {}

  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const hours = Math.floor(Math.abs(offsetMinutes) / 60);
  return `UTC${sign}${hours}`;
}

export function formatLocalDate(d: Date = getLocalDate()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatMoscowDate(d: Date = getLocalDate()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {}
  return formatLocalDate(d);
}

export function formatLocalTime(d: Date = getLocalDate()): string {
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

export function formatMoscowTime(d: Date = getLocalDate()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const hour = parts.find(p => p.type === 'hour')?.value;
    const minute = parts.find(p => p.type === 'minute')?.value;
    const second = parts.find(p => p.type === 'second')?.value;
    if (hour && minute && second) return `${hour}:${minute}:${second}`;
  } catch {}
  return formatLocalTime(d);
}

/**
 * Cross-browser safe Date parser for Safari, Chrome, Edge, Firefox, and Yandex.
 * Handles ISO strings with or without 'T', YYYY-MM-DD, timestamps, etc.
 */
export function parseDateSafe(input?: string | number | Date | null): Date {
  if (!input) return new Date();
  if (input instanceof Date) return isNaN(input.getTime()) ? new Date() : input;
  if (typeof input === 'number') return new Date(input);

  const str = String(input).trim();
  // If YYYY-MM-DD format (no time), parse explicitly with local parts to avoid UTC timezone day-shift in Safari
  const ymdMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdMatch) {
    const y = parseInt(ymdMatch[1], 10);
    const m = parseInt(ymdMatch[2], 10) - 1;
    const d = parseInt(ymdMatch[3], 10);
    return new Date(y, m, d, 12, 0, 0); // 12:00 avoids daylight saving boundary shifts
  }

  // If date string contains space instead of 'T' (e.g. SQLite / Postgres "2026-10-08 14:30:00"),
  // Safari WebKit fails on space. Replace space with 'T':
  const normalized = str.includes(' ') && !str.includes('T') ? str.replace(' ', 'T') : str;
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? new Date() : d;
}

export function formatSafeTimeString(input?: string | number | Date | null): string {
  try {
    const d = parseDateSafe(input);
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  const monthsRu = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
  ];
  const mIndex = parseInt(month, 10) - 1;
  return `${parseInt(day, 10)} ${monthsRu[mIndex] || ''} ${year}`;
}

/**
 * Formats YYYY-MM-DD into DD.MM.YYYY (дд.мм.гггг)
 */
export function formatDateRuDMY(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('T')[0].split('-');
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      return `${parts[2]}.${parts[1]}.${parts[0]}`;
    }
    return dateStr;
  }
  return dateStr;
}

export const formatDateDDMMYYYY = formatDateRuDMY;

export function getAllAvailableMonths(
  records: { date: string }[] = [],
  countPastMonths: number = 12
): { key: string; label: string; isCurrent: boolean }[] {
  const msk = getMoscowDate();
  const currentKey = `${msk.getFullYear()}-${String(msk.getMonth() + 1).padStart(2, '0')}`;

  const monthSet = new Set<string>();
  monthSet.add(currentKey);

  for (let i = 0; i < countPastMonths; i++) {
    const d = new Date(msk.getFullYear(), msk.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthSet.add(key);
  }

  for (const r of records) {
    if (r.date && r.date.length >= 7) {
      monthSet.add(r.date.slice(0, 7));
    }
  }

  return Array.from(monthSet)
    .sort((a, b) => b.localeCompare(a))
    .map(key => ({
      key,
      label: formatMonthName(key),
      isCurrent: key === currentKey,
    }));
}

export function formatMonthName(yearMonth: string): string {
  if (!yearMonth) return '';
  const [year, month] = yearMonth.split('-');
  const monthsRu = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
  ];
  const mIndex = parseInt(month, 10) - 1;
  return `${monthsRu[mIndex] || ''} ${year}`;
}

export function getCurrentMonthKey(): string {
  const msk = getMoscowDate();
  const year = msk.getFullYear();
  const month = String(msk.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function getCurrentAndPreviousMonth(): { current: string; previous: string; previous2: string } {
  const msk = getMoscowDate();
  const curYear = msk.getFullYear();
  const curMonth = msk.getMonth() + 1; // 1-12

  const curStr = `${curYear}-${String(curMonth).padStart(2, '0')}`;

  let prevYear = curYear;
  let prevMonth = curMonth - 1;
  if (prevMonth === 0) {
    prevMonth = 12;
    prevYear -= 1;
  }
  const prevStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

  let prev2Year = prevYear;
  let prev2Month = prevMonth - 1;
  if (prev2Month === 0) {
    prev2Month = 12;
    prev2Year -= 1;
  }
  const prev2Str = `${prev2Year}-${String(prev2Month).padStart(2, '0')}`;

  return { current: curStr, previous: prevStr, previous2: prev2Str };
}
