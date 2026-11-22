"use strict";
// Strict date-of-birth and age rules. Pure functions, no dependencies.
//
// THIS FILE IS DUPLICATED, BYTE FOR BYTE, as mobile/lib/age.js (the Render backend and the Expo app
// cannot share a file). backend/test/age.test.js fails if the two copies differ and runs the same shared
// test vectors (backend/test/fixtures/age-vectors.json) against this implementation.
//
// Rules
//  - A date of birth is exactly "YYYY-MM-DD" and a REAL calendar date (2008-02-30, 2007-02-29, month 13,
//    day 00 and non-ISO shapes such as "1999-1-1" or "2000-10-10T00:00:00Z" are rejected, not "corrected").
//  - Year 1900 or later, not in the future, and not older than MAX_AGE_YEARS.
//  - Age is computed from the whole date (not the year) against TODAY IN UTC. Someone whose birthday has not
//    yet arrived in UTC is not yet that age, so people east of UTC (for example Sri Lanka, UTC+5:30) can be
//    held back for a few hours on the day they turn 18. That is the safe direction.
//  - 29 February: the birthday is reached on 1 March in a common year (and on 29 February in a leap year).
//  - A date of birth only proves what the user typed. It is a gate, not an identity check.

const MIN_ADULT_AGE = 18;
const MAX_AGE_YEARS = 120;
const EARLIEST_YEAR = 1900;

/** @param {number} year */
function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** @param {number} year @param {number} month 1-12 */
function daysInMonth(year, month) {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/**
 * Parses a strict YYYY-MM-DD string that is a real calendar date.
 * @param {unknown} value
 * @returns {{year:number, month:number, day:number} | null}
 */
function parseIsoDate(value) {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** Today's calendar date in UTC. @param {Date} [now] */
function todayUtc(now = new Date()) {
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
}

const compare = (a, b) => a.year - b.year || a.month - b.month || a.day - b.day;

/** Whole years between `dob` and `today` (birthday not yet reached => one less). */
function ageOn(dob, today) {
  let age = today.year - dob.year;
  if (today.month < dob.month || (today.month === dob.month && today.day < dob.day)) age -= 1;
  return age;
}

const MESSAGES = {
  required: "Please enter your date of birth.",
  invalid_format: "Use the format YYYY-MM-DD.",
  invalid_date: "That date does not exist.",
  out_of_range: "Please enter a valid date of birth.",
  future: "Your date of birth cannot be in the future.",
  underage: "You must be at least 18 years old to use Dateza.",
};

/**
 * Validates a date of birth for use on Dateza.
 * @param {unknown} value
 * @param {{ now?: Date, minAge?: number }} [options]
 * @returns {{ ok: true, birthdate: string, age: number } | { ok: false, code: string, message: string }}
 */
function validateBirthdate(value, { now = new Date(), minAge = MIN_ADULT_AGE } = {}) {
  const fail = (code) => ({ ok: false, code, message: MESSAGES[code] });
  if (value === undefined || value === null || value === "") return fail("required");
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fail("invalid_format");
  const dob = parseIsoDate(value);
  if (!dob) return fail("invalid_date");
  if (dob.year < EARLIEST_YEAR) return fail("out_of_range");
  const today = todayUtc(now);
  if (compare(dob, today) > 0) return fail("future");
  const age = ageOn(dob, today);
  if (age > MAX_AGE_YEARS) return fail("out_of_range");
  if (age < minAge) return fail("underage");
  return { ok: true, birthdate: value, age };
}

/** True when `value` is a valid date of birth of someone who is at least `minAge` today (UTC). */
function isAdult(value, options) {
  return validateBirthdate(value, options).ok;
}

module.exports = {
  MIN_ADULT_AGE,
  MAX_AGE_YEARS,
  EARLIEST_YEAR,
  isLeapYear,
  daysInMonth,
  parseIsoDate,
  todayUtc,
  ageOn,
  validateBirthdate,
  isAdult,
};
