// Pure functions only: no DOM, no storage, no Date.now(). Full precision; round at display time.

export const TZ = 'Asia/Ho_Chi_Minh';
export const SCHEMA_VERSION = 2; // backup file format; v1 files (no training data) still import
export const SLOTS = [
  { id: 'sang', label: 'Sáng' },
  { id: 'trua', label: 'Trưa' },
  { id: 'chieu', label: 'Chiều' },
  { id: 'toi', label: 'Tối' }
];
export const SERVINGS = [0.5, 1, 1.5, 2];
export const SURPLUS_OPTIONS = [300, 400, 500];
export const GOAL_RATES = [0.0025, 0.005, 0.0075];
export const DEFAULT_PROFILE = { age: 22, heightCm: 170, trainingDays: 4, surplus: 400, goalRate: 0.005, restSec: 90, increment: 2.5 };

const PROTEIN_PER_KG = 1.8;
const FAT_PER_KG = 0.9;
const LOW_MEAL_PER_KG = 0.25;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- dates ----------
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** 'YYYY-MM-DD' of the instant in Asia/Ho_Chi_Minh (never toISOString: that is UTC). */
export function localDate(date) {
  const p = Object.fromEntries(dateFmt.formatToParts(date).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Calendar arithmetic on 'YYYY-MM-DD' strings, timezone-free. */
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** Whole days from a to b ('YYYY-MM-DD'). */
export function daysBetween(a, b) {
  const t = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400000);
}

/** Hour (0–23) in Asia/Ho_Chi_Minh. */
export function localHour(date) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(date));
}

// ---------- energy ----------
export function bmr({ kg, heightCm, age }) {
  return 10 * kg + 6.25 * heightCm - 5 * age + 5;
}

export function activityMultiplier(trainingDays) {
  const d = Number(trainingDays) || 0;
  if (d >= 6) return 1.725;
  if (d >= 4) return 1.55;
  if (d >= 2) return 1.375;
  return 1.2;
}

export function tdee({ kg, heightCm, age, trainingDays }) {
  return bmr({ kg, heightCm, age }) * activityMultiplier(trainingDays);
}

/** Daily targets for a profile at bodyweight kg; null when inputs are missing. */
export function calcTargets(profile, kg) {
  if (!profile || !(kg > 0)) return null;
  const { age, heightCm, trainingDays } = profile;
  const surplus = profile.surplus ?? 400;
  const b = bmr({ kg, heightCm, age });
  const t = b * activityMultiplier(trainingDays);
  const kcal = t + surplus;
  const protein = PROTEIN_PER_KG * kg;
  const fat = FAT_PER_KG * kg;
  const carb = Math.max(0, (kcal - protein * 4 - fat * 9) / 4);
  return { bmr: b, tdee: t, kcal, protein, fat, carb, proteinPerMeal: protein / SLOTS.length, lowMealProtein: LOW_MEAL_PER_KG * kg };
}

export function isMealLow(proteinG, kg) {
  if (!(kg > 0)) return false;
  return proteinG < LOW_MEAL_PER_KG * kg;
}

// ---------- weight ----------
/** Mean of weigh-ins in the 7 calendar days ending at dateStr (inclusive); null if < 3 entries. */
export function avg7(weights, dateStr) {
  const from = addDays(dateStr, -6);
  const win = weights.filter(x => x.date >= from && x.date <= dateStr);
  if (win.length < 3) return null;
  return win.reduce((a, x) => a + x.kg, 0) / win.length;
}

export function weeklyChange(weights, dateStr) {
  const now = avg7(weights, dateStr);
  const prev = avg7(weights, addDays(dateStr, -7));
  return now == null || prev == null ? null : now - prev;
}

export function weeklyGoal(avgKg, goalRate = 0.005) {
  if (avgKg == null) return null;
  const r = Math.min(0.0075, Math.max(0.0025, goalRate));
  return avgKg * r;
}

/** 'ok' within 50–150 % of goal, 'slow' below, 'fast' above; null if unknown. */
export function weightAdvice(weekly, goal) {
  if (weekly == null || goal == null) return null;
  const eps = 1e-9;
  if (weekly < goal * 0.5 - eps) return 'slow';
  if (weekly > goal * 1.5 + eps) return 'fast';
  return 'ok';
}

export function latestWeight(weights, dateStr) {
  let best = null;
  for (const x of weights) if (x.date <= dateStr && (!best || x.date > best.date)) best = x;
  return best;
}

/** Bodyweight used for targets: 7-day average, else latest weigh-in, else null. */
export function calcWeight(weights, dateStr) {
  const a = avg7(weights, dateStr);
  if (a != null) return a;
  const l = latestWeight(weights, dateStr);
  return l ? l.kg : null;
}

/** avg7 evaluated at each weigh-in date within [from, to]; points with null avg are skipped. */
export function avgSeries(weights, from, to) {
  return weights
    .filter(x => x.date >= from && x.date <= to)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map(x => ({ date: x.date, kg: avg7(weights, x.date) }))
    .filter(p => p.kg != null);
}

// ---------- food ----------
export function snapshotFor(food, servings) {
  return {
    name: food.name, servingLabel: food.servingLabel,
    kcal: food.kcal * servings, protein: food.protein * servings, carb: food.carb * servings, fat: food.fat * servings
  };
}

export function sumMacros(logs) {
  const s = { kcal: 0, protein: 0, carb: 0, fat: 0 };
  for (const l of logs) { s.kcal += l.kcal; s.protein += l.protein; s.carb += l.carb; s.fat += l.fat; }
  return s;
}

export function macrosBySlot(logs) {
  return Object.fromEntries(SLOTS.map(s => [s.id, sumMacros(logs.filter(l => l.mealSlot === s.id))]));
}

/** foodIds ordered by log count in the 30 days ending at dateStr. */
export function topFoods(logs, dateStr, n = 8) {
  const from = addDays(dateStr, -29);
  const counts = new Map();
  for (const l of logs) if (l.date >= from && l.date <= dateStr) counts.set(l.foodId, (counts.get(l.foodId) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);
}

export function normalizeText(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
}

export function searchFoods(foods, query) {
  const q = normalizeText(query);
  if (!q) return foods;
  return foods.filter(f => normalizeText(f.name).includes(q));
}

export function defaultSlot(hour) {
  return hour < 10 ? 'sang' : hour < 14 ? 'trua' : hour < 18 ? 'chieu' : 'toi';
}

// ---------- backup ----------
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isMacro = o => ['kcal', 'protein', 'carb', 'fat'].every(k => isNum(o[k]) && o[k] >= 0);

export function validateBackup(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, errors: ['Không phải file JSON hợp lệ'] };
  if (data.schemaVersion !== 1 && data.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion phải là 1 hoặc ${SCHEMA_VERSION}`);
  const v2 = data.schemaVersion === 2;
  if (v2) for (const k of ['workouts', 'exercises', 'templates']) if (data[k] != null && !Array.isArray(data[k])) errors.push(`${k} phải là danh sách`);
  for (const k of ['weights', 'foods', 'foodLogs']) if (!Array.isArray(data[k])) errors.push(`Thiếu danh sách ${k}`);
  if (data.profile != null) {
    const p = data.profile;
    if (typeof p !== 'object' || !['age', 'heightCm', 'trainingDays'].every(k => isNum(p[k]))) errors.push('Hồ sơ không hợp lệ');
  }
  if (errors.length) return { ok: false, errors };
  if (!data.weights.every(x => x && DATE_RE.test(x.date) && isNum(x.kg) && x.kg > 0)) errors.push('Dữ liệu cân nặng không hợp lệ');
  if (!data.foods.every(f => f && typeof f.id === 'string' && f.id && typeof f.name === 'string' && f.name.trim() && isMacro(f))) errors.push('Danh sách món không hợp lệ');
  const slotIds = SLOTS.map(s => s.id);
  if (!data.foodLogs.every(l => l && typeof l.id === 'string' && DATE_RE.test(l.date) && slotIds.includes(l.mealSlot) && isNum(l.servings) && l.servings > 0 && isMacro(l))) errors.push('Nhật ký ăn không hợp lệ');
  if (v2) {
    const ws = data.workouts || [], es = data.exercises || [], ts = data.templates || [];
    const okSet = st => st && (st.kg == null || isNum(st.kg)) && (st.reps == null || isNum(st.reps));
    if (!ws.every(w => w && typeof w.id === 'string' && DATE_RE.test(w.date) && (w.status === 'done' || w.status === 'active') && Array.isArray(w.exercises)
      && w.exercises.every(e => e && typeof e.exerciseId === 'string' && Array.isArray(e.sets) && e.sets.every(okSet)))) errors.push('Lịch sử tập không hợp lệ');
    if (!es.every(e => e && typeof e.id === 'string' && typeof e.name === 'string' && e.name.trim() && typeof e.muscle === 'string')) errors.push('Danh sách bài tập không hợp lệ');
    if (!ts.every(t => t && typeof t.id === 'string' && typeof t.name === 'string' && Array.isArray(t.exercises))) errors.push('Danh sách mẫu không hợp lệ');
  }
  if (errors.length) return { ok: false, errors };
  const counts = { weights: data.weights.length, foods: data.foods.length, foodLogs: data.foodLogs.length, profile: data.profile != null };
  if (v2) Object.assign(counts, { workouts: (data.workouts || []).length, exercises: (data.exercises || []).length, templates: (data.templates || []).length });
  return { ok: true, errors: [], counts };
}
