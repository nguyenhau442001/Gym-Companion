import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  e1rm, doneSets, workoutStats, weekStart, weekDays, doneWorkouts, workoutsBetween, setsByMuscle,
  lastPerformance, suggestNext, exerciseHistory, personalRecords, newRecords, formatDuration,
  workoutFromTemplate, templateFromWorkout, finalizeWorkout
} from '../js/training.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const set = (kg, reps, done = true) => ({ kg, reps, done });
const ex = (exerciseId, sets, extra = {}) => ({ exerciseId, name: exerciseId, muscle: 'chest', repMin: 6, repMax: 10, isBodyweight: false, sets, ...extra });
const wk = (id, date, exercises, extra = {}) => ({ id, date, name: id, status: 'done', startedAt: 0, endedAt: 3600000, exercises, ...extra });

test('e1rm uses Epley; 1 rep = weight; invalid → 0', () => {
  close(e1rm(100, 1), 100);
  close(e1rm(60, 10), 80);
  close(e1rm(80, 5), 80 * (1 + 5 / 30));
  assert.equal(e1rm(0, 10), 0);
  assert.equal(e1rm(60, 0), 0);
  assert.equal(e1rm(null, 5), 0);
});

test('doneSets ignores unfinished or empty sets', () => {
  const w = wk('a', '2026-10-03', [ex('bench', [set(60, 8), set(60, 8, false), set(null, 8), set(60, null)])]);
  assert.equal(doneSets(w).length, 1);
});

test('workoutStats counts sets, volume, duration', () => {
  const w = wk('a', '2026-10-03', [ex('bench', [set(60, 8), set(60, 6)]), ex('pullup', [set(0, 10)], { isBodyweight: true })], { startedAt: 0, endedAt: 52 * 60000 });
  assert.deepEqual(workoutStats(w), { sets: 3, volume: 840, durationMs: 52 * 60000 });
  assert.deepEqual(workoutStats(wk('b', '2026-10-03', [])), { sets: 0, volume: 0, durationMs: 3600000 });
});

test('weekStart is Monday; weekDays has 7 dates', () => {
  assert.equal(weekStart('2026-10-03'), '2026-09-28'); // Saturday → Monday
  assert.equal(weekStart('2026-09-28'), '2026-09-28'); // Monday
  assert.equal(weekStart('2026-10-04'), '2026-09-28'); // Sunday
  assert.deepEqual(weekDays('2026-10-03'), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
});

test('doneWorkouts / workoutsBetween skip active ones and filter by date', () => {
  const ws = [wk('a', '2026-09-27', []), wk('b', '2026-09-28', []), wk('c', '2026-10-03', [], { status: 'active' })];
  assert.deepEqual(doneWorkouts(ws).map(w => w.id), ['b', 'a']); // newest first
  assert.deepEqual(workoutsBetween(ws, '2026-09-28', '2026-10-04').map(w => w.id), ['b']);
  assert.deepEqual(workoutsBetween([], '2026-09-28', '2026-10-04'), []);
});

test('setsByMuscle counts done sets per muscle in range', () => {
  const ws = [
    wk('a', '2026-09-29', [ex('bench', [set(60, 8), set(60, 8)]), ex('row', [set(50, 10)], { muscle: 'back' })]),
    wk('b', '2026-09-20', [ex('bench', [set(60, 8)])])
  ];
  assert.deepEqual(setsByMuscle(ws, '2026-09-28', '2026-10-04'), { chest: 2, back: 1 });
  assert.deepEqual(setsByMuscle([], '2026-09-28', '2026-10-04'), {});
});

test('lastPerformance returns done sets from the most recent previous workout', () => {
  const ws = [
    wk('a', '2026-09-20', [ex('bench', [set(55, 8)])]),
    wk('b', '2026-09-27', [ex('bench', [set(60, 8), set(60, 7), set(60, 5, false)])]),
    wk('c', '2026-10-03', [ex('bench', [set(62.5, 8)])], { status: 'active' })
  ];
  assert.deepEqual(lastPerformance(ws, 'bench', 'c'), [set(60, 8), set(60, 7)]);
  assert.equal(lastPerformance(ws, 'squat', 'c'), null);
  assert.equal(lastPerformance([], 'bench'), null);
});

test('lastPerformance breaks same-day ties by endedAt', () => {
  const ws = [
    wk('a', '2026-09-27', [ex('bench', [set(60, 8)])], { endedAt: 1000 }),
    wk('b', '2026-09-27', [ex('bench', [set(65, 8)])], { endedAt: 2000 })
  ];
  assert.deepEqual(lastPerformance(ws, 'bench'), [set(65, 8)]);
});

test('suggestNext: all sets hit top of range → add increment, reset to repMin', () => {
  assert.deepEqual(suggestNext([set(60, 10), set(60, 10), set(60, 11)], { repMin: 6, repMax: 10 }, 2.5), { kg: 62.5, reps: 6, increase: true });
});

test('suggestNext: otherwise keep heaviest weight and add a rep', () => {
  assert.deepEqual(suggestNext([set(60, 8), set(60, 7)], { repMin: 6, repMax: 10 }, 2.5), { kg: 60, reps: 9, increase: false });
  assert.deepEqual(suggestNext([set(60, 4)], { repMin: 6, repMax: 10 }, 2.5), { kg: 60, reps: 6, increase: false });
});

test('suggestNext: bodyweight adds reps; no history → null', () => {
  assert.deepEqual(suggestNext([set(0, 8), set(0, 6)], { repMin: 5, repMax: 10 }, 2.5, true), { kg: 0, reps: 9, increase: false });
  assert.deepEqual(suggestNext([set(0, 10), set(0, 10)], { repMin: 5, repMax: 10 }, 2.5, true), { kg: 0, reps: 11, increase: true });
  assert.equal(suggestNext(null, { repMin: 6, repMax: 10 }, 2.5), null);
  assert.equal(suggestNext([], { repMin: 6, repMax: 10 }, 2.5), null);
});

test('exerciseHistory: one point per workout, oldest first', () => {
  const ws = [
    wk('b', '2026-09-27', [ex('bench', [set(60, 10), set(70, 3)])]),
    wk('a', '2026-09-20', [ex('bench', [set(55, 8)])]),
    wk('c', '2026-09-30', [ex('squat', [set(80, 5)])])
  ];
  const h = exerciseHistory(ws, 'bench');
  assert.deepEqual(h.map(p => p.date), ['2026-09-20', '2026-09-27']);
  close(h[1].bestE1rm, 80);
  assert.equal(h[1].bestKg, 70);
  assert.equal(h[1].bestReps, 10);
  assert.equal(h[1].volume, 810);
  assert.deepEqual(exerciseHistory([], 'bench'), []);
});

test('personalRecords takes maxima; empty → null', () => {
  const ws = [wk('a', '2026-09-20', [ex('bench', [set(55, 12)])]), wk('b', '2026-09-27', [ex('bench', [set(70, 3)])])];
  const pr = personalRecords(exerciseHistory(ws, 'bench'));
  close(pr.e1rm, 55 * (1 + 12 / 30));
  assert.equal(pr.kg, 70);
  assert.equal(pr.reps, 12);
  assert.equal(personalRecords([]), null);
});

test('newRecords flags exercises whose best e1RM beats all previous workouts', () => {
  const ws = [
    wk('a', '2026-09-20', [ex('bench', [set(60, 8)]), ex('squat', [set(100, 5)], { muscle: 'quads' })]),
    wk('b', '2026-09-27', [ex('bench', [set(62.5, 8)]), ex('squat', [set(90, 5)], { muscle: 'quads' }), ex('row', [set(50, 10)])])
  ];
  const r = newRecords(ws[1], ws);
  assert.deepEqual(r.map(x => x.exerciseId), ['bench']); // row: first time, not a record
  assert.equal(r[0].kg, 62.5);
  assert.equal(r[0].reps, 8);
  assert.deepEqual(newRecords(ws[0], ws), []);
});

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0 phút');
  assert.equal(formatDuration(52 * 60000 + 30000), '52 phút');
  assert.equal(formatDuration(65 * 60000), '1 giờ 05');
  assert.equal(formatDuration(-5), '0 phút');
});

const catalog = new Map([
  ['bench', { id: 'bench', name: 'Bench', muscle: 'chest', repMin: 6, repMax: 10, isBodyweight: false }],
  ['pullup', { id: 'pullup', name: 'Pull-up', muscle: 'back', repMin: 5, repMax: 10, isBodyweight: true }]
]);

test('workoutFromTemplate builds empty sets and skips unknown exercises', () => {
  const tpl = { id: 't1', name: 'Upper', exercises: [{ exerciseId: 'bench', sets: 3 }, { exerciseId: 'gone', sets: 2 }, { exerciseId: 'pullup', sets: 2 }] };
  const exs = workoutFromTemplate(tpl, catalog);
  assert.deepEqual(exs.map(e => [e.exerciseId, e.sets.length]), [['bench', 3], ['pullup', 2]]);
  assert.deepEqual(exs[0].sets[0], { kg: null, reps: null, done: false });
  assert.equal(exs[1].isBodyweight, true);
  assert.equal(exs[0].name, 'Bench');
});

test('templateFromWorkout keeps exercise order and set counts (at least 1)', () => {
  const w = wk('a', '2026-10-03', [ex('bench', [set(60, 8), set(60, 8), set(60, 8, false)]), ex('pullup', [])]);
  assert.deepEqual(templateFromWorkout(w).exercises, [{ exerciseId: 'bench', sets: 3 }, { exerciseId: 'pullup', sets: 1 }]);
});

test('finalizeWorkout drops unfinished sets and empty exercises', () => {
  const w = wk('a', '2026-10-03', [ex('bench', [set(60, 8), set(60, 8, false)]), ex('row', [set(null, null, false)])], { status: 'active' });
  const f = finalizeWorkout(w, 999);
  assert.equal(f.status, 'done');
  assert.equal(f.endedAt, 999);
  assert.deepEqual(f.exercises.map(e => [e.exerciseId, e.sets.length]), [['bench', 1]]);
  assert.equal(w.exercises.length, 2); // input untouched
});
