// IndexedDB wrapper. db "bulk-tracker", schema version 1.
import { SEED_FOODS } from '../data/foods.seed.js';
import { SCHEMA_VERSION } from './calc.js';

const DB_NAME = 'bulk-tracker';
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
    const open = indexedDB.open(DB_NAME, SCHEMA_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('profile')) db.createObjectStore('profile', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('weights')) db.createObjectStore('weights', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('foods')) db.createObjectStore('foods', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('foodLogs')) db.createObjectStore('foodLogs', { keyPath: 'id' }).createIndex('date', 'date');
      // Reserved for v2 (Tập luyện)
      if (!db.objectStoreNames.contains('workouts')) db.createObjectStore('workouts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('exercises')) db.createObjectStore('exercises', { keyPath: 'id' });
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

/** Insert seed foods that are missing (keeps the catalog in sync with new releases). */
export async function ensureSeed() {
  const db = await openDB();
  const tx = db.transaction('foods', 'readwrite');
  const s = tx.objectStore('foods');
  s.getAllKeys().onsuccess = e => {
    const existing = new Set(e.target.result);
    for (const f of SEED_FOODS) if (!existing.has(f.id)) s.put(f);
  };
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

// ---------- backup ----------
export async function exportData() {
  const [profile, weights, foods, foodLogs] = await Promise.all([getProfile(), getWeights(), getFoods(), getFoodLogs()]);
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    profile,
    weights,
    foods: foods.filter(f => f.isCustom),
    foodLogs
  };
}

/** Overwrite profile, weights, custom foods and logs with a validated backup. Seed foods are kept. */
export async function importData(data) {
  const db = await openDB();
  const tx = db.transaction(['profile', 'weights', 'foods', 'foodLogs'], 'readwrite');
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
  if (data.profile) tx.objectStore('profile').put({ ...data.profile, id: PROFILE_KEY });
  await done(tx);
}
