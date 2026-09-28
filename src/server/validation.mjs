import { addDays, toIsoDate } from '../core.js';

export const PLAN_PAST_DAYS = 364;
export const PLAN_FUTURE_DAYS = 53 * 7;
const MAX_PLAN_ENTRIES = 800;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_]{20,255}$/;
const GITHUB_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;

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

export function validateTokenPayload(body) {
  const token = isPlainObject(body) && typeof body.token === 'string' ? body.token.trim() : '';
  if (!TOKEN_PATTERN.test(token)) {
    throw new ValidationError('This does not look like a GitHub token.');
  }
  return token;
}

export function validateTargetPayload(body) {
  const owner = isPlainObject(body) && typeof body.owner === 'string' ? body.owner : '';
  const repo = isPlainObject(body) && typeof body.repo === 'string' ? body.repo : '';
  if (!GITHUB_NAME_PATTERN.test(owner) || !GITHUB_NAME_PATTERN.test(repo)) {
    throw new ValidationError('Invalid repository owner or name.');
  }
  return { owner, repo };
}

export function validateFlowPayload(body) {
  const flowId = isPlainObject(body) && typeof body.flowId === 'string' ? body.flowId : '';
  if (!/^[0-9a-f-]{36}$/.test(flowId)) {
    throw new ValidationError('Invalid sign-in flow id.');
  }
  return flowId;
}
