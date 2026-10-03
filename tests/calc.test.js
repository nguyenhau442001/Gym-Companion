import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TZ, SLOTS, localDate, addDays, daysBetween, localHour, bmr, activityMultiplier, tdee, calcTargets, isMealLow,
  avg7, weeklyChange, weeklyGoal, weightAdvice, calcWeight, latestWeight, avgSeries,
  sumMacros, macrosBySlot, snapshotFor, topFoods, searchFoods, normalizeText, defaultSlot,
  validateBackup
} from '../js/calc.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const w = (date, kg) => ({ date, kg });

// ---------- dates ----------
test('localDate uses Asia/Ho_Chi_Minh, not UTC', () => {
  assert.equal(TZ, 'Asia/Ho_Chi_Minh');
  // 2026-10-02 18:30 UTC = 2026-10-03 01:30 in VN (toISOString would say 10-02)
  assert.equal(localDate(new Date(Date.UTC(2026, 9, 2, 18, 30))), '2026-10-03');
  assert.equal(localDate(new Date(Date.UTC(2026, 9, 2, 16, 59))), '2026-10-02');
  assert.equal(localDate(new Date(Date.UTC(2026, 9, 2, 17, 0))), '2026-10-03');
});

test('addDays crosses month/year boundaries and handles negatives', () => {
  assert.equal(addDays('2026-10-03', -7), '2026-09-26');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(addDays('2026-10-03', 0), '2026-10-03');
});

test('daysBetween counts calendar days', () => {
  assert.equal(daysBetween('2026-09-26', '2026-10-03'), 7);
  assert.equal(daysBetween('2026-10-03', '2026-10-03'), 0);
  assert.equal(daysBetween('2026-10-03', '2026-09-26'), -7);
  assert.equal(daysBetween('2027-03-01', '2027-03-31'), 30);
});

test('localHour uses Asia/Ho_Chi_Minh', () => {
  assert.equal(localHour(new Date(Date.UTC(2026, 9, 2, 17, 30))), 0);
  assert.equal(localHour(new Date(Date.UTC(2026, 9, 3, 5, 0))), 12);
});

// ---------- energy ----------
test('bmr follows Mifflin-St Jeor (male)', () => {
  close(bmr({ kg: 60, heightCm: 175, age: 24 }), 10 * 60 + 6.25 * 175 - 5 * 24 + 5); // 1578.75
  close(bmr({ kg: 70.5, heightCm: 180, age: 30 }), 705 + 1125 - 150 + 5);
});

test('activityMultiplier buckets', () => {
  assert.equal(activityMultiplier(0), 1.2);
  assert.equal(activityMultiplier(1), 1.2);
  assert.equal(activityMultiplier(2), 1.375);
  assert.equal(activityMultiplier(3), 1.375);
  assert.equal(activityMultiplier(4), 1.55);
  assert.equal(activityMultiplier(5), 1.55);
  assert.equal(activityMultiplier(6), 1.725);
  assert.equal(activityMultiplier(7), 1.725);
  assert.equal(activityMultiplier(-1), 1.2);
  assert.equal(activityMultiplier(NaN), 1.2);
});

test('tdee = bmr * multiplier, full precision', () => {
  close(tdee({ kg: 60, heightCm: 175, age: 24, trainingDays: 4 }), 1578.75 * 1.55);
});

test('calcTargets computes kcal and macros', () => {
  const t = calcTargets({ age: 24, heightCm: 175, trainingDays: 4, surplus: 400 }, 60);
  close(t.bmr, 1578.75);
  close(t.tdee, 2447.0625);
  close(t.kcal, 2847.0625);
  close(t.protein, 108);
  close(t.fat, 54);
  close(t.carb, (2847.0625 - 108 * 4 - 54 * 9) / 4);
  close(t.proteinPerMeal, 27);
  close(t.lowMealProtein, 15);
});

test('calcTargets defaults surplus to 400 and returns null without weight', () => {
  const t = calcTargets({ age: 24, heightCm: 175, trainingDays: 4 }, 60);
  close(t.kcal - t.tdee, 400);
  assert.equal(calcTargets({ age: 24, heightCm: 175, trainingDays: 4 }, null), null);
  assert.equal(calcTargets({ age: 24, heightCm: 175, trainingDays: 4 }, 0), null);
  assert.equal(calcTargets(null, 60), null);
});

test('calcTargets never returns negative carbs', () => {
  const t = calcTargets({ age: 90, heightCm: 100, trainingDays: 0, surplus: 300 }, 200);
  assert.equal(t.carb, 0);
});

test('isMealLow flags < 0.25 g/kg', () => {
  assert.equal(isMealLow(14.9, 60), true);
  assert.equal(isMealLow(15, 60), false);
  assert.equal(isMealLow(0, 60), true);
  assert.equal(isMealLow(10, null), false);
});

// ---------- weight ----------
test('avg7 returns null with no data or fewer than 3 entries', () => {
  assert.equal(avg7([], '2026-10-03'), null);
  assert.equal(avg7([w('2026-10-03', 60)], '2026-10-03'), null);
  assert.equal(avg7([w('2026-10-03', 60), w('2026-10-02', 61)], '2026-10-03'), null);
});

test('avg7 averages only the trailing 7 calendar days, skipping gaps', () => {
  const ws = [
    w('2026-09-26', 99),   // 7 days before -> outside window
    w('2026-09-27', 60),   // first day of window
    w('2026-09-30', 61),
    w('2026-10-03', 62),   // today
    w('2026-10-04', 99)    // future -> ignored
  ];
  close(avg7(ws, '2026-10-03'), 61);
});

test('avg7 ignores input order', () => {
  const ws = [w('2026-10-03', 62), w('2026-09-27', 60), w('2026-09-30', 61)];
  close(avg7(ws, '2026-10-03'), 61);
});

test('weeklyChange = avg7(today) - avg7(today-7)', () => {
  const ws = [];
  for (let i = 0; i < 14; i++) ws.push(w(addDays('2026-10-03', -i), 60 + (13 - i) * 0.1));
  // this week: days -6..0 → 60.7..61.3 mean 61.0 ; last week: -13..-7 → 60.0..60.6 mean 60.3
  close(weeklyChange(ws, '2026-10-03'), 0.7);
});

test('weeklyChange is null when either window lacks data', () => {
  const ws = [w('2026-10-03', 61), w('2026-10-02', 61), w('2026-10-01', 61)];
  assert.equal(weeklyChange(ws, '2026-10-03'), null);
  assert.equal(weeklyChange([], '2026-10-03'), null);
});

test('weeklyGoal = avg * rate, default 0.5%, clamped 0.25–0.75%', () => {
  close(weeklyGoal(60), 0.3);
  close(weeklyGoal(60, 0.0025), 0.15);
  close(weeklyGoal(60, 0.0075), 0.45);
  close(weeklyGoal(60, 0.01), 0.45);
  close(weeklyGoal(60, 0.001), 0.15);
  assert.equal(weeklyGoal(null), null);
});

test('weightAdvice compares weekly change with goal', () => {
  assert.equal(weightAdvice(null, 0.3), null);
  assert.equal(weightAdvice(0.3, null), null);
  assert.equal(weightAdvice(0.3, 0.3), 'ok');
  assert.equal(weightAdvice(0.15, 0.3), 'ok');
  assert.equal(weightAdvice(0.45, 0.3), 'ok');
  assert.equal(weightAdvice(0.1, 0.3), 'slow');
  assert.equal(weightAdvice(-0.2, 0.3), 'slow');
  assert.equal(weightAdvice(0.5, 0.3), 'fast');
});

test('latestWeight and calcWeight fallback chain', () => {
  assert.equal(latestWeight([], '2026-10-03'), null);
  assert.deepEqual(latestWeight([w('2026-09-01', 58), w('2026-09-20', 59), w('2026-10-05', 70)], '2026-10-03'), w('2026-09-20', 59));
  assert.equal(calcWeight([], '2026-10-03'), null);
  assert.equal(calcWeight([w('2026-09-01', 58)], '2026-10-03'), 58);
  const ws = [w('2026-10-01', 60), w('2026-10-02', 61), w('2026-10-03', 62)];
  close(calcWeight(ws, '2026-10-03'), 61);
});

test('avgSeries returns avg7 at each weigh-in within range, skipping nulls', () => {
  const ws = [w('2026-09-28', 60), w('2026-09-29', 61), w('2026-09-30', 62), w('2026-10-01', 63)];
  const s = avgSeries(ws, '2026-09-29', '2026-10-03');
  assert.deepEqual(s.map(p => p.date), ['2026-09-30', '2026-10-01']);
  close(s[0].kg, 61);
  close(s[1].kg, 61.5);
  assert.deepEqual(avgSeries([], '2026-09-01', '2026-10-03'), []);
});

// ---------- food logs ----------
const food = { id: 'f1', name: 'Phở bò', servingLabel: '1 tô', kcal: 450, protein: 25, carb: 60, fat: 12 };

test('snapshotFor multiplies by servings and copies name', () => {
  assert.deepEqual(snapshotFor(food, 1.5), { name: 'Phở bò', servingLabel: '1 tô', kcal: 675, protein: 37.5, carb: 90, fat: 18 });
});

test('sumMacros sums logs, empty → zeros', () => {
  assert.deepEqual(sumMacros([]), { kcal: 0, protein: 0, carb: 0, fat: 0 });
  const logs = [{ kcal: 100, protein: 10, carb: 5, fat: 1 }, { kcal: 50.5, protein: 2, carb: 3, fat: 4 }];
  assert.deepEqual(sumMacros(logs), { kcal: 150.5, protein: 12, carb: 8, fat: 5 });
});

test('macrosBySlot groups into all four slots', () => {
  const r = macrosBySlot([{ mealSlot: 'sang', kcal: 100, protein: 10, carb: 0, fat: 0 }, { mealSlot: 'toi', kcal: 1, protein: 1, carb: 1, fat: 1 }]);
  assert.deepEqual(Object.keys(r), SLOTS.map(s => s.id));
  assert.equal(r.sang.protein, 10);
  assert.equal(r.trua.kcal, 0);
  assert.equal(r.toi.fat, 1);
});

test('topFoods ranks by log count within last 30 days', () => {
  const logs = [
    { foodId: 'a', date: '2026-10-03' }, { foodId: 'a', date: '2026-09-10' },
    { foodId: 'b', date: '2026-10-01' }, { foodId: 'b', date: '2026-10-02' }, { foodId: 'b', date: '2026-10-02' },
    { foodId: 'c', date: '2026-09-03' }, // 30 days ago → outside
    { foodId: 'c', date: '2026-09-01' }
  ];
  assert.deepEqual(topFoods(logs, '2026-10-03'), ['b', 'a']);
  assert.deepEqual(topFoods([], '2026-10-03'), []);
  const many = 'abcdefghij'.split('').map(id => ({ foodId: id, date: '2026-10-03' }));
  assert.equal(topFoods(many, '2026-10-03').length, 8);
});

test('normalizeText strips Vietnamese diacritics and đ', () => {
  assert.equal(normalizeText('Phở Bò'), 'pho bo');
  assert.equal(normalizeText('Đậu phộng'), 'dau phong');
});

test('searchFoods is diacritic-insensitive; empty query returns all', () => {
  const foods = [{ name: 'Phở bò' }, { name: 'Đậu phộng' }, { name: 'Bánh mì trứng' }];
  assert.equal(searchFoods(foods, '').length, 3);
  assert.deepEqual(searchFoods(foods, 'pho b').map(f => f.name), ['Phở bò']);
  assert.deepEqual(searchFoods(foods, 'dau').map(f => f.name), ['Đậu phộng']);
  assert.deepEqual(searchFoods(foods, 'mi tr').map(f => f.name), ['Bánh mì trứng']);
  assert.deepEqual(searchFoods(foods, 'xyz'), []);
});

test('defaultSlot by hour', () => {
  assert.equal(defaultSlot(6), 'sang');
  assert.equal(defaultSlot(10), 'trua');
  assert.equal(defaultSlot(14), 'chieu');
  assert.equal(defaultSlot(18), 'toi');
  assert.equal(defaultSlot(23), 'toi');
});

// ---------- backup ----------
const goodBackup = () => ({
  schemaVersion: 1, exportedAt: '2026-10-03T10:00:00.000Z',
  profile: { age: 24, heightCm: 175, trainingDays: 4, surplus: 400, goalRate: 0.005 },
  weights: [{ date: '2026-10-03', kg: 60.5 }],
  foods: [{ id: 'c1', name: 'Món tự tạo', servingLabel: '1 phần', kcal: 300, protein: 20, carb: 30, fat: 10, isCustom: true }],
  foodLogs: [{ id: 'l1', date: '2026-10-03', mealSlot: 'sang', foodId: 'c1', servings: 1, kcal: 300, protein: 20, carb: 30, fat: 10 }]
});

test('validateBackup accepts a valid file and counts records', () => {
  const r = validateBackup(goodBackup());
  assert.equal(r.ok, true);
  assert.deepEqual(r.counts, { weights: 1, foods: 1, foodLogs: 1, profile: true });
});

test('validateBackup rejects wrong shapes', () => {
  assert.equal(validateBackup(null).ok, false);
  assert.equal(validateBackup('x').ok, false);
  assert.equal(validateBackup({ ...goodBackup(), schemaVersion: 3 }).ok, false);
  assert.equal(validateBackup({ ...goodBackup(), schemaVersion: 2, workouts: 'x' }).ok, false);
  assert.equal(validateBackup({ ...goodBackup(), schemaVersion: 2, workouts: [{ id: 'w', date: '2026-10-03', status: 'done', exercises: [{ exerciseId: 'b', sets: [{ kg: 'x', reps: 5 }] }] }] }).ok, false);
  assert.equal(validateBackup({ ...goodBackup(), schemaVersion: 2, exercises: [{ id: 'e', name: '', muscle: 'chest' }] }).ok, false);
  assert.equal(validateBackup({ ...goodBackup(), weights: 'no' }).ok, false);
  assert.equal(validateBackup({ ...goodBackup(), weights: [{ date: '3/10/2026', kg: 60 }] }).ok, false);
  assert.equal(validateBackup({ ...goodBackup(), weights: [{ date: '2026-10-03', kg: -1 }] }).ok, false);
  assert.equal(validateBackup({ ...goodBackup(), foodLogs: [{ id: 'x', date: '2026-10-03', mealSlot: 'brunch', servings: 1, kcal: 1, protein: 1, carb: 1, fat: 1 }] }).ok, false);
  assert.equal(validateBackup({ ...goodBackup(), foods: [{ id: 'x', name: '' }] }).ok, false);
});

test('validateBackup v2 counts training data; missing arrays allowed', () => {
  const r = validateBackup({
    ...goodBackup(), schemaVersion: 2,
    workouts: [{ id: 'w1', date: '2026-10-03', status: 'done', startedAt: 0, endedAt: 1, exercises: [{ exerciseId: 'bench-press', sets: [{ kg: 60, reps: 8, done: true }, { kg: null, reps: null, done: false }] }] }],
    exercises: [{ id: 'x1', name: 'Bài tự tạo', muscle: 'chest', repMin: 8, repMax: 12 }],
    templates: [{ id: 't1', name: 'Upper', exercises: [{ exerciseId: 'bench-press', sets: 3 }] }]
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.counts, { weights: 1, foods: 1, foodLogs: 1, profile: true, workouts: 1, exercises: 1, templates: 1 });
  const r2 = validateBackup({ ...goodBackup(), schemaVersion: 2 });
  assert.equal(r2.ok, true);
  assert.equal(r2.counts.workouts, 0);
});

test('validateBackup allows null profile and empty arrays', () => {
  const r = validateBackup({ schemaVersion: 1, profile: null, weights: [], foods: [], foodLogs: [] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.counts, { weights: 0, foods: 0, foodLogs: 0, profile: false });
});
