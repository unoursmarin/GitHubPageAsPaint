import { addDays, toIsoDate } from '../core.js';

export const PLAN_PAST_DAYS = 364;
export const PLAN_FUTURE_DAYS = 53 * 7;
const MAX_PLAN_ENTRIES = 800;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_]{20,255}$/;
const GITHUB_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;
const FOLDER_SEGMENT_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_FOLDER_LENGTH = 200;
const MAX_FOLDER_DEPTH = 5;
const RESERVED_ROOT_FOLDERS = new Set(['.git', '.github']);

export class ValidationError extends Error {}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validatePlanPayload(body, now = new Date()) {
  if (!isPlainObject(body) || !isPlainObject(body.plan)) {
    throw new ValidationError('Expected a JSON body with a "plan" object.');
  }

  const entries = Object.entries(body.plan);
  if (entries.length > MAX_PLAN_ENTRIES) {
    throw new ValidationError(`A plan can contain at most ${MAX_PLAN_ENTRIES} days.`);
  }

  const earliest = toIsoDate(addDays(now, -PLAN_PAST_DAYS));
  const latest = toIsoDate(addDays(now, PLAN_FUTURE_DAYS));
  const plan = {};

  for (const [date, level] of entries) {
    if (!DATE_PATTERN.test(date) || toIsoDate(new Date(`${date}T00:00:00Z`)) !== date) {
      throw new ValidationError(`Invalid date "${String(date).slice(0, 20)}".`);
    }
    if (date < earliest || date > latest) {
      throw new ValidationError(`Date ${date} is outside the plannable range.`);
    }
    if (!Number.isInteger(level) || level < 1 || level > 4) {
      throw new ValidationError(`Level for ${date} must be an integer from 1 to 4.`);
    }
    plan[date] = level;
  }

  const futureWeeks = body.futureWeeks ?? 20;
  if (!Number.isInteger(futureWeeks) || futureWeeks < 4 || futureWeeks > 52) {
    throw new ValidationError('futureWeeks must be an integer from 4 to 52.');
  }

  return { plan, futureWeeks };
}

export function validateToken(value) {
  const token = typeof value === 'string' ? value.trim() : '';
  if (!TOKEN_PATTERN.test(token)) {
    throw new ValidationError('This does not look like a GitHub token.');
  }
  return token;
}

/** A relative folder inside the target repository, e.g. "art/2026". Never escapes the repo or touches git/CI config. */
export function validateFolder(value) {
  const folder = typeof value === 'string' ? value.trim().replace(/^\/+|\/+$/g, '') : '';
  if (!folder) {
    throw new ValidationError('Choose a folder for the generated files.');
  }
  if (folder.length > MAX_FOLDER_LENGTH) {
    throw new ValidationError(`The folder path must be at most ${MAX_FOLDER_LENGTH} characters.`);
  }

  const segments = folder.split('/');
  if (segments.length > MAX_FOLDER_DEPTH) {
    throw new ValidationError(`The folder can be at most ${MAX_FOLDER_DEPTH} levels deep.`);
  }
  for (const segment of segments) {
    if (!FOLDER_SEGMENT_PATTERN.test(segment) || segment === '.' || segment === '..') {
      throw new ValidationError('Folder names may only use letters, digits, ".", "_" and "-".');
    }
  }
  if (RESERVED_ROOT_FOLDERS.has(segments[0].toLowerCase())) {
    throw new ValidationError(`"${segments[0]}" is reserved, pick another folder.`);
  }

  return segments.join('/');
}
