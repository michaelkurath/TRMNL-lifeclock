const MS_DAY = 86400000;
const DAYS_PER_YEAR = 365.2425;
const MAX_TABLE_AGE = 100;

const TEXT = {
  en: {
    unavailable: 'Life Clock unavailable',
    check_settings: 'Check your plugin settings and data source.',
    valid_birth_date: 'Enter a valid date of birth.',
    future_birth_date: 'Date of birth cannot be in the future.',
    select_sex: 'Select a supported life-table sex category.',
    no_table_country: 'No life table is available for',
    no_table_sex: 'life table is available for',
    age_limit: 'The current WPP table used by Life Clock supports exact ages through',
    unusable_age: 'The life table does not contain a usable remaining-life value for this age.',
    headline: 'Your lifetime in 24 hours',
    disclaimer: 'Population estimate, not an individual prediction.',
    lifetime_24h: 'Lifetime in 24 hours',
    lived: 'lived',
    remains_day: 'remains on the statistical 24-hour day.',
    age_now: 'Age now',
    stat_years_left: 'Stat. years left',
    stat_lifetime: 'Statistical lifetime',
    stat_horizon: 'Statistical horizon',
    life_table_year: 'Life-table reference year',
    prototype_warning: 'Prototype data — not for release.',
    left: 'left',
    left_day: 'left on the statistical day',
    stat_years: 'stat. years',
    stat_years_left_short: 'stat. years left',
  },
  de: {
    unavailable: 'Life Clock nicht verfügbar',
    check_settings: 'Bitte Plugin-Einstellungen und Datenquelle prüfen.',
    valid_birth_date: 'Bitte ein gültiges Geburtsdatum eingeben.',
    future_birth_date: 'Das Geburtsdatum darf nicht in der Zukunft liegen.',
    select_sex: 'Bitte eine unterstützte Geschlechtskategorie der Sterbetafel wählen.',
    no_table_country: 'Keine Sterbetafel verfügbar für',
    no_table_sex: 'Sterbetafel verfügbar für',
    age_limit: 'Die von Life Clock verwendete WPP-Tabelle unterstützt exakte Alter bis',
    unusable_age: 'Für dieses Alter enthält die Sterbetafel keinen nutzbaren Wert zur Restlebenserwartung.',
    headline: 'Lebenszeit in 24 Stunden',
    disclaimer: 'Bevölkerungsstatistik, keine individuelle Prognose.',
    lifetime_24h: 'Lebenszeit in 24 Stunden',
    lived: 'gelebt',
    remains_day: 'verbleiben am statistischen 24-Stunden-Tag.',
    age_now: 'Aktuelles Alter',
    stat_years_left: 'Stat. Jahre übrig',
    stat_lifetime: 'Statistische Lebensdauer',
    stat_horizon: 'Stat. Horizont',
    life_table_year: 'Referenzjahr der Sterbetafel',
    prototype_warning: 'Prototypdaten — nicht zur Veröffentlichung.',
    left: 'übrig',
    left_day: 'übrig am statistischen Tag',
    stat_years: 'stat. Jahre',
    stat_years_left_short: 'stat. Jahre übrig',
  }
};

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

function normalizeLanguage(value) {
  const language = String(value || '').toLowerCase();
  return language === 'de' ? 'de' : 'en';
}

function formatDecimal(value, language, digits = 1) {
  const result = Number(value).toFixed(digits);
  return language === 'de' ? result.replace('.', ',') : result;
}

function localizedCountryName(country, language) {
  const fallback = country?.name || '';
  if (language !== 'de') return fallback;
  const iso2 = String(country?.iso2 || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso2)) return fallback;
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
      return new Intl.DisplayNames(['de'], { type: 'region' }).of(iso2) || fallback;
    }
  } catch (_) {
    // Production runtimes without Intl.DisplayNames safely keep the UN name.
  }
  return fallback;
}

function run(input, nowMs = Date.now()) {
  input = input || {};
  const fields = input.trmnl?.plugin_settings?.custom_fields_values || input.custom_fields || {};
  const language = normalizeLanguage(fields.language);
  const labels = TEXT[language];
  const localNowMs = userLocalNowMs(input, nowMs);
  const birthDate = parseDateOnly(fields.birth_date);
  const sex = String(fields.sex || '').toLowerCase();
  const countryCode = String(fields.country_code || '').toUpperCase();
  const bundledCountry = input.countries?.[countryCode];
  const directCountry = input.country && String(input.country.code || '').toUpperCase() === countryCode ? input.country : null;
  const country = directCountry || bundledCountry;
  const table = country?.[sex];
  const countryName = localizedCountryName(country, language) || countryCode;

  const base = {
    state: 'error',
    headline: labels.unavailable,
    detail: labels.check_settings,
    labels,
    language,
    source_label: input.meta?.source_label || 'Life expectancy data',
    source_note: input.meta?.source_note || '',
    prototype: Boolean(input.meta?.prototype),
    release_ready: input.meta?.release_ready === true,
    coverage: input.meta?.coverage || '',
    country_code: countryCode,
    country_name: countryName,
    sex,
    sex_label: sex === 'female'
      ? (language === 'de' ? 'Weiblich' : 'Female')
      : sex === 'male'
        ? (language === 'de' ? 'Männlich' : 'Male')
        : sex,
    show_remaining: booleanField(fields.show_remaining, true),
    show_horizon: booleanField(fields.show_horizon, false)
  };

  if (!birthDate) {
    base.detail = labels.valid_birth_date;
    return base;
  }
  if (birthDate.getTime() > localNowMs) {
    base.detail = labels.future_birth_date;
    return base;
  }
  if (!['male', 'female'].includes(sex)) {
    base.detail = labels.select_sex;
    return base;
  }
  if (!country) {
    base.detail = `${labels.no_table_country} ${countryCode}.`;
    return base;
  }
  if (!table) {
    base.detail = language === 'de'
      ? `Keine ${sex === 'female' ? 'weibliche' : 'männliche'} ${labels.no_table_sex} ${countryName}.`
      : `No ${sex} ${labels.no_table_sex} ${countryName}.`;
    return base;
  }

  const age = exactAgeYears(birthDate, localNowMs);
  if (age < 0) {
    base.detail = labels.future_birth_date;
    return base;
  }
  if (age > MAX_TABLE_AGE) {
    base.detail = `${labels.age_limit} ${MAX_TABLE_AGE}.`;
    return base;
  }

  const remaining = interpolateLifeTable(table, age);
  if (!Number.isFinite(remaining)) {
    base.detail = labels.unusable_age;
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
    headline: labels.headline,
    detail: labels.disclaimer,
    age: Number(age.toFixed(2)),
    age_display: formatDecimal(age, language),
    remaining_years: Number(remaining.toFixed(2)),
    remaining_display: formatDecimal(remaining, language),
    remaining_weeks: Math.max(0, Math.round(remainingWeeks)),
    expected_age: Number(expectedAge.toFixed(2)),
    expected_age_display: formatDecimal(expectedAge, language),
    progress: Number(progress.toFixed(6)),
    progress_percent: Number(percent.toFixed(1)),
    progress_display: formatDecimal(percent, language),
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
  userLocalNowMs,
  normalizeLanguage,
  formatDecimal,
  localizedCountryName
};
