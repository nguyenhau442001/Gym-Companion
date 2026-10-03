// Pure workout math. No DOM, no storage. Workouts look like:
// { id, date, name, templateId, status: 'active'|'done', startedAt, endedAt,
//   exercises: [{ exerciseId, name, muscle, repMin, repMax, isBodyweight, sets: [{ kg, reps, done }] }] }
import { addDays } from './calc.js';

const isDone = s => s && s.done && s.reps > 0 && s.kg != null && s.kg >= 0;

/** Estimated 1-rep max (Epley). */
export function e1rm(kg, reps) {
  if (!(kg > 0) || !(reps > 0)) return 0;
  return reps === 1 ? kg : kg * (1 + reps / 30);
}

export function doneSets(workout) {
  const out = [];
  for (const e of workout.exercises) for (const s of e.sets) if (isDone(s)) out.push({ exerciseId: e.exerciseId, muscle: e.muscle, kg: s.kg, reps: s.reps });
  return out;
}

export function workoutStats(workout) {
  const sets = doneSets(workout);
  return {
    sets: sets.length,
    volume: sets.reduce((a, s) => a + s.kg * s.reps, 0),
    durationMs: Math.max(0, (workout.endedAt || 0) - (workout.startedAt || 0))
  };
}

/** Monday of the week containing dateStr. */
export function weekStart(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(dateStr, -((dow + 6) % 7));
}

export function weekDays(dateStr) {
  const s = weekStart(dateStr);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

const byRecency = (a, b) => (a.date === b.date ? (b.endedAt || 0) - (a.endedAt || 0) : a.date < b.date ? 1 : -1);

/** Finished workouts, newest first. */
export function doneWorkouts(workouts) {
  return workouts.filter(w => w.status === 'done').sort(byRecency);
}

export function workoutsBetween(workouts, from, to) {
  return doneWorkouts(workouts).filter(w => w.date >= from && w.date <= to);
}

export function setsByMuscle(workouts, from, to) {
  const out = {};
  for (const w of workoutsBetween(workouts, from, to)) for (const s of doneSets(w)) out[s.muscle] = (out[s.muscle] || 0) + 1;
  return out;
}

/** Done sets for exerciseId from the most recent finished workout (excluding excludeId). */
export function lastPerformance(workouts, exerciseId, excludeId) {
  for (const w of doneWorkouts(workouts)) {
    if (w.id === excludeId) continue;
    const e = w.exercises.find(x => x.exerciseId === exerciseId);
    const sets = e ? e.sets.filter(isDone) : [];
    if (sets.length) return sets;
  }
  return null;
}

/**
 * Double progression: when every set reached repMax, add `increment` kg and restart at repMin;
 * otherwise keep the heaviest weight and aim for one more rep than the best set (at least repMin).
 * Bodyweight: always add a rep.
 */
export function suggestNext(prevSets, { repMin, repMax }, increment = 2.5, isBodyweight = false) {
  if (!prevSets || !prevSets.length) return null;
  const allTop = prevSets.every(s => s.reps >= repMax);
  const topKg = Math.max(...prevSets.map(s => s.kg || 0));
  const bestReps = Math.max(...prevSets.filter(s => (s.kg || 0) === topKg).map(s => s.reps));
  if (isBodyweight) return { kg: topKg, reps: bestReps + 1, increase: allTop };
  if (allTop) return { kg: topKg + increment, reps: repMin, increase: true };
  return { kg: topKg, reps: Math.max(repMin, Math.min(repMax, bestReps + 1)), increase: false };
}

/** One point per finished workout containing the exercise, oldest first. */
export function exerciseHistory(workouts, exerciseId) {
  const out = [];
  for (const w of doneWorkouts(workouts).reverse()) {
    const e = w.exercises.find(x => x.exerciseId === exerciseId);
    const sets = e ? e.sets.filter(isDone) : [];
    if (!sets.length) continue;
    out.push({
      date: w.date, workoutId: w.id, sets,
      bestE1rm: Math.max(...sets.map(s => e1rm(s.kg, s.reps))),
      bestKg: Math.max(...sets.map(s => s.kg)),
      bestReps: Math.max(...sets.map(s => s.reps)),
      volume: sets.reduce((a, s) => a + s.kg * s.reps, 0)
    });
  }
  return out;
}

export function personalRecords(history) {
  if (!history.length) return null;
  return {
    e1rm: Math.max(...history.map(h => h.bestE1rm)),
    kg: Math.max(...history.map(h => h.bestKg)),
    reps: Math.max(...history.map(h => h.bestReps)),
    volume: Math.max(...history.map(h => h.volume))
  };
}

/** Exercises in `workout` whose best e1RM (or reps, for bodyweight) beats every earlier workout. */
export function newRecords(workout, workouts) {
  const earlier = doneWorkouts(workouts).filter(w => w.id !== workout.id && (w.date < workout.date || (w.date === workout.date && (w.endedAt || 0) < (workout.endedAt || 0))));
  const out = [];
  for (const e of workout.exercises) {
    const sets = e.sets.filter(isDone);
    if (!sets.length) continue;
    const prev = exerciseHistory(earlier, e.exerciseId);
    if (!prev.length) continue;
    const score = s => (e.isBodyweight && !(s.kg > 0) ? s.reps : e1rm(s.kg, s.reps));
    const best = sets.reduce((a, s) => (score(s) > score(a) ? s : a));
    const prevBest = Math.max(...prev.map(p => (e.isBodyweight && !(p.bestKg > 0) ? p.bestReps : p.bestE1rm)));
    if (score(best) > prevBest + 1e-9) out.push({ exerciseId: e.exerciseId, name: e.name, kg: best.kg, reps: best.reps });
  }
  return out;
}

export function formatDuration(ms) {
  const min = Math.max(0, Math.floor(ms / 60000));
  if (min < 60) return `${min} phút`;
  return `${Math.floor(min / 60)} giờ ${String(min % 60).padStart(2, '0')}`;
}

const emptySet = () => ({ kg: null, reps: null, done: false });

export function exerciseEntry(ex, setCount = 3) {
  return {
    exerciseId: ex.id, name: ex.name, muscle: ex.muscle, repMin: ex.repMin, repMax: ex.repMax, isBodyweight: !!ex.isBodyweight,
    sets: Array.from({ length: Math.max(1, setCount) }, emptySet)
  };
}

export function workoutFromTemplate(template, catalog) {
  return template.exercises.filter(t => catalog.has(t.exerciseId)).map(t => exerciseEntry(catalog.get(t.exerciseId), t.sets));
}

export function templateFromWorkout(workout) {
  return { name: workout.name, exercises: workout.exercises.map(e => ({ exerciseId: e.exerciseId, sets: Math.max(1, e.sets.length) })) };
}

export function finalizeWorkout(workout, endedAt) {
  const exercises = workout.exercises
    .map(e => ({ ...e, sets: e.sets.filter(isDone) }))
    .filter(e => e.sets.length);
  return { ...workout, exercises, status: 'done', endedAt };
}
