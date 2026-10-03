// IndexedDB wrapper. db "bulk-tracker". v1: nutrition stores; v2: adds templates (Tập luyện).
import { SEED_FOODS } from '../data/foods.seed.js';
import { SEED_EXERCISES, SEED_TEMPLATES } from '../data/exercises.seed.js';
import { SCHEMA_VERSION } from './calc.js';

const DB_NAME = 'bulk-tracker';
const DB_VERSION = 2;
const PROFILE_KEY = 'me';
let dbPromise = null;

function req(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

function done(tx) {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error); });
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('profile')) db.createObjectStore('profile', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('weights')) db.createObjectStore('weights', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('foods')) db.createObjectStore('foods', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('foodLogs')) db.createObjectStore('foodLogs', { keyPath: 'id' }).createIndex('date', 'date');
      if (!db.objectStoreNames.contains('workouts')) db.createObjectStore('workouts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('exercises')) db.createObjectStore('exercises', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('templates')) db.createObjectStore('templates', { keyPath: 'id' });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  return dbPromise;
}

async function store(name, mode = 'readonly') {
  const db = await openDB();
  return db.transaction(name, mode).objectStore(name);
}

async function getAll(name) { return req((await store(name)).getAll()); }
async function put(name, value) { const s = await store(name, 'readwrite'); await req(s.put(value)); return value; }
async function del(name, key) { const s = await store(name, 'readwrite'); await req(s.delete(key)); }

export function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) || Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** Insert seed foods/exercises that are missing (keeps catalogs in sync with new releases). */
export async function ensureSeed() {
  const db = await openDB();
  const tx = db.transaction(['foods', 'exercises'], 'readwrite');
  for (const [name, rows] of [['foods', SEED_FOODS], ['exercises', SEED_EXERCISES]]) {
    const s = tx.objectStore(name);
    s.getAllKeys().onsuccess = e => {
      const existing = new Set(e.target.result);
      for (const r of rows) if (!existing.has(r.id)) s.put(r);
    };
  }
  await done(tx);
}

/** Starter templates, once per install (deleting them later is respected). */
export async function seedTemplates() {
  const db = await openDB();
  const tx = db.transaction('templates', 'readwrite');
  SEED_TEMPLATES.forEach((t, i) => tx.objectStore('templates').put({ ...t, createdAt: Date.now() + i }));
  await done(tx);
}

// ---------- profile ----------
export async function getProfile() {
  const p = await req((await store('profile')).get(PROFILE_KEY));
  if (!p) return null;
  const { id, ...rest } = p;
  return rest;
}
export async function saveProfile(profile) { await put('profile', { ...profile, id: PROFILE_KEY }); return profile; }

// ---------- weights ----------
export const getWeights = () => getAll('weights');
export const saveWeight = (date, kg) => put('weights', { date, kg });
export const deleteWeight = date => del('weights', date);

// ---------- foods ----------
export const getFoods = () => getAll('foods');
export const saveFood = food => put('foods', food);
export const deleteFood = id => del('foods', id);

// ---------- food logs ----------
export const getFoodLogs = () => getAll('foodLogs');
export const saveFoodLog = log => put('foodLogs', log);
export const deleteFoodLog = id => del('foodLogs', id);

// ---------- training ----------
export const getExercises = () => getAll('exercises');
export const saveExercise = ex => put('exercises', ex);
export const deleteExercise = id => del('exercises', id);
export const getWorkouts = () => getAll('workouts');
export const saveWorkout = w => put('workouts', w);
export const deleteWorkout = id => del('workouts', id);
export const getTemplates = () => getAll('templates');
export const saveTemplate = t => put('templates', t);
export const deleteTemplate = id => del('templates', id);

// ---------- backup ----------
export async function exportData() {
  const [profile, weights, foods, foodLogs, workouts, exercises, templates] = await Promise.all([getProfile(), getWeights(), getFoods(), getFoodLogs(), getWorkouts(), getExercises(), getTemplates()]);
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    profile,
    weights,
    foods: foods.filter(f => f.isCustom),
    foodLogs,
    workouts,
    exercises: exercises.filter(e => e.isCustom),
    templates
  };
}

/**
 * Overwrite with a validated backup. Seed foods/exercises are kept.
 * v1 files carry no training data, so workouts/templates/custom exercises stay untouched for them.
 */
export async function importData(data) {
  const db = await openDB();
  const v2 = data.schemaVersion === 2;
  const tx = db.transaction(['profile', 'weights', 'foods', 'foodLogs', 'workouts', 'exercises', 'templates'], 'readwrite');
  if (v2) {
    const exs = tx.objectStore('exercises');
    exs.getAll().onsuccess = e => {
      for (const x of e.target.result) if (x.isCustom) exs.delete(x.id);
      for (const x of data.exercises || []) exs.put({ ...x, isCustom: true });
    };
    tx.objectStore('workouts').clear();
    for (const w of data.workouts || []) tx.objectStore('workouts').put(w);
    tx.objectStore('templates').clear();
    for (const t of data.templates || []) tx.objectStore('templates').put(t);
  }
  const foods = tx.objectStore('foods');
  // Callback style (not await) so the transaction stays active on older Safari.
  foods.getAll().onsuccess = e => {
    for (const f of e.target.result) if (f.isCustom) foods.delete(f.id);
    for (const f of data.foods) foods.put({ ...f, isCustom: true });
  };
  tx.objectStore('weights').clear();
  for (const w of data.weights) tx.objectStore('weights').put({ date: w.date, kg: w.kg });
  tx.objectStore('foodLogs').clear();
  for (const l of data.foodLogs) tx.objectStore('foodLogs').put(l);
  tx.objectStore('profile').clear();
  if (data.profile) tx.objectStore('profile').put({ ...data.profile, templatesSeeded: true, id: PROFILE_KEY });
  await done(tx);
}
