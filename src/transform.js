const MS_DAY = 86400000;
const DAYS_PER_YEAR = 365.2425;
const MAX_TABLE_AGE = 100;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseDateOnly(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function birthdayInYear(dob, year) {
  const month = dob.getUTCMonth();
  const day = dob.getUTCDate();
  if (month === 1 && day === 29) {
    const leap = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1;
    return new Date(Date.UTC(year, 1, leap ? 29 : 28));
  }
  return new Date(Date.UTC(year, month, day));
}

function exactAgeYears(dob, nowMs) {
  const now = new Date(nowMs);
  let whole = now.getUTCFullYear() - dob.getUTCFullYear();
  let last = birthdayInYear(dob, now.getUTCFullYear());
  if (nowMs < last.getTime()) {
    whole -= 1;
    last = birthdayInYear(dob, now.getUTCFullYear() - 1);
  }
  const next = birthdayInYear(dob, last.getUTCFullYear() + 1);
  const fraction = clamp((nowMs - last.getTime()) / (next.getTime() - last.getTime()), 0, 0.999999999);
  return whole + fraction;
}

function lifeTablePoints(table) {
  if (!table || typeof table !== 'object') return [];
  return Object.entries(table)
    .map(([a, e]) => ({ age: Number(a), remaining: Number(e) }))
    .filter(p => Number.isFinite(p.age) && Number.isFinite(p.remaining) && p.remaining >= 0)
    .sort((a, b) => a.age - b.age);
}

function interpolateLifeTable(table, age) {
  const points = lifeTablePoints(table);
  if (!points.length || !Number.isFinite(age)) return null;
  if (age < points[0].age || age > points[points.length - 1].age) return null;
  if (age === points[points.length - 1].age) return points[points.length - 1].remaining;
  for (let i = 1; i < points.length; i++) {
    if (age <= points[i].age) {
      const low = points[i - 1];
      const high = points[i];
      const t = (age - low.age) / (high.age - low.age);
      return low.remaining + (high.remaining - low.remaining) * t;
    }
  }
  return null;
}

function clockMinutes(progress) {
  return Math.round(clamp(progress, 0, 1) * 24 * 60);
}

function formatLifeClock(progress) {
  const totalMinutes = clockMinutes(progress);
  if (totalMinutes >= 1440) return '24:00';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatClockRemaining(progress) {
  const minutesLeft = Math.max(0, 1440 - clockMinutes(progress));
  const hours = Math.floor(minutesLeft / 60);
  const minutes = minutesLeft % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

function horizonYear(nowMs, remainingYears) {
  const date = new Date(nowMs + remainingYears * DAYS_PER_YEAR * MS_DAY);
  return date.getUTCFullYear();
}

function userLocalNowMs(input, nowMs) {
  const offset = Number(input?.trmnl?.user?.utc_offset);
  return nowMs + (Number.isFinite(offset) ? offset * 1000 : 0);
}

function booleanField(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() !== 'false';
}

function run(input, nowMs = Date.now()) {
  input = input || {};
  const fields = input.trmnl?.plugin_settings?.custom_fields_values || input.custom_fields || {};
  const localNowMs = userLocalNowMs(input, nowMs);
  const birthDate = parseDateOnly(fields.birth_date);
  const sex = String(fields.sex || '').toLowerCase();
  const countryCode = String(fields.country_code || '').toUpperCase();
  const bundledCountry = input.countries?.[countryCode];
  const directCountry = input.country && String(input.country.code || '').toUpperCase() === countryCode ? input.country : null;
  const country = directCountry || bundledCountry;
  const table = country?.[sex];

  const base = {
    state: 'error',
    headline: 'Life Clock unavailable',
    detail: 'Check your plugin settings and data source.',
    source_label: input.meta?.source_label || 'Life expectancy data',
    source_note: input.meta?.source_note || '',
    prototype: Boolean(input.meta?.prototype),
    release_ready: input.meta?.release_ready === true,
    coverage: input.meta?.coverage || '',
    country_code: countryCode,
    country_name: country?.name || countryCode,
    sex,
    sex_label: sex === 'female' ? 'Female' : sex === 'male' ? 'Male' : sex,
    show_remaining: booleanField(fields.show_remaining, true),
    show_horizon: booleanField(fields.show_horizon, false)
  };

  if (!birthDate) {
    base.detail = 'Enter a valid date of birth.';
    return base;
  }
  if (birthDate.getTime() > localNowMs) {
    base.detail = 'Date of birth cannot be in the future.';
    return base;
  }
  if (!['male', 'female'].includes(sex)) {
    base.detail = 'Select a supported life-table sex category.';
    return base;
  }
  if (!country) {
    base.detail = `No life table is available for ${countryCode}.`;
    return base;
  }
  if (!table) {
    base.detail = `No ${sex} life table is available for ${country.name}.`;
    return base;
  }

  const age = exactAgeYears(birthDate, localNowMs);
  if (age < 0) {
    base.detail = 'Date of birth cannot be in the future.';
    return base;
  }
  if (age > MAX_TABLE_AGE) {
    base.detail = `The current WPP table used by Life Clock supports exact ages through ${MAX_TABLE_AGE}.`;
    return base;
  }

  const remaining = interpolateLifeTable(table, age);
  if (!Number.isFinite(remaining)) {
    base.detail = 'The life table does not contain a usable remaining-life value for this age.';
    return base;
  }

  const expectedAge = age + remaining;
  const progress = expectedAge > 0 ? clamp(age / expectedAge, 0, 1) : 0;
  const percent = progress * 100;
  const remainingWeeks = remaining * 52.1775;
  const dataYear = Number(country.year || input.meta?.year) || null;
  const currentYear = new Date(localNowMs).getUTCFullYear();

  return {
    ...base,
    state: 'ok',
    headline: 'Your lifetime in 24 hours',
    detail: 'Population estimate, not an individual prediction.',
    age: Number(age.toFixed(2)),
    age_display: age.toFixed(1),
    remaining_years: Number(remaining.toFixed(2)),
    remaining_display: remaining.toFixed(1),
    remaining_weeks: Math.max(0, Math.round(remainingWeeks)),
    expected_age: Number(expectedAge.toFixed(2)),
    expected_age_display: expectedAge.toFixed(1),
    progress: Number(progress.toFixed(6)),
    progress_percent: Number(percent.toFixed(1)),
    remaining_percent: Number((100 - percent).toFixed(1)),
    hand_angle: Number((progress * 360).toFixed(2)),
    life_clock: formatLifeClock(progress),
    clock_remaining: formatClockRemaining(progress),
    horizon_year: horizonYear(localNowMs, remaining),
    data_year: dataYear,
    data_age_years: dataYear ? Math.max(0, currentYear - dataYear) : null,
    data_stale: dataYear ? currentYear - dataYear > 2 : false,
    max_supported_age: MAX_TABLE_AGE
  };
}

if (typeof module !== 'undefined') module.exports = {
  run,
  parseDateOnly,
  exactAgeYears,
  interpolateLifeTable,
  formatLifeClock,
  formatClockRemaining,
  clockMinutes,
  userLocalNowMs
};
