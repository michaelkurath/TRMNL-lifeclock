const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  run,
  parseDateOnly,
  exactAgeYears,
  interpolateLifeTable,
  formatLifeClock,
  formatClockRemaining,
  userLocalNowMs,
} = require('../src/transform.js');

const che = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'countries', 'CHE.json'), 'utf8')
);

function input(fields, utcOffset = 0) {
  return {
    ...che,
    custom_fields: {
      birth_date: '1980-01-15',
      sex: 'male',
      country_code: 'CHE',
      show_remaining: true,
      show_horizon: false,
      ...fields,
    },
    trmnl: { user: { utc_offset: utcOffset } },
  };
}

const now = Date.UTC(2026, 8, 24, 12, 0, 0);
const result = run(input({}), now);

assert.equal(result.state, 'ok');
assert.equal(result.country_code, 'CHE');
assert.equal(result.country_name, 'Switzerland');
assert.equal(result.sex, 'male');
assert.equal(result.data_year, 2026);
assert.equal(result.release_ready, true);
assert.equal(result.prototype, false);
assert.equal(result.show_horizon, false);
assert(result.age > 46.6 && result.age < 46.8);
assert(result.remaining_years > 36 && result.remaining_years < 38);
assert(result.expected_age > 83 && result.expected_age < 85);
assert(result.progress > 0.55 && result.progress < 0.57);
assert(/^\d{2}:\d{2}$/.test(result.life_clock));
assert(/^\d+h \d{2}m$/.test(result.clock_remaining));
assert.equal(result.life_clock, formatLifeClock(result.progress));
assert.equal(result.clock_remaining, formatClockRemaining(result.progress));

const male = che.country.male;
const halfway = interpolateLifeTable(male, 46.5);
assert(Math.abs(halfway - (male[46] + male[47]) / 2) < 1e-9);

const leap = parseDateOnly('2000-02-29');
assert(leap);
assert.equal(exactAgeYears(leap, Date.UTC(2024, 1, 29)), 24);
assert.equal(parseDateOnly('2025-02-29'), null);

const future = run(input({ birth_date: '2030-01-01' }), now);
assert.equal(future.state, 'error');
assert(/future/i.test(future.detail));

const missingSex = run(input({ sex: '' }), now);
assert.equal(missingSex.state, 'error');
assert(/sex/i.test(missingSex.detail));

const tooOld = run(input({ birth_date: '1900-01-01' }), now);
assert.equal(tooOld.state, 'error');
assert(/100/.test(tooOld.detail));

const beforeLocalBirthday = Date.UTC(2026, 0, 14, 23, 30, 0);
const dob = parseDateOnly('1980-01-15');
const utcNow = userLocalNowMs(input({}, 0), beforeLocalBirthday);
const zurichNow = userLocalNowMs(input({}, 3600), beforeLocalBirthday);
assert(exactAgeYears(dob, utcNow) < 46);
assert(exactAgeYears(dob, zurichNow) >= 46);

console.log(
  'PASS: transform calculation, interpolation, leap-day, local-date, and error-state tests'
);
