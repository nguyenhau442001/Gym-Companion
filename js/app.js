// Bootstrap: open DB, seed catalog, first-run profile, service worker, first render.
import * as db from './db.js';
import { DEFAULT_PROFILE } from './calc.js';
import { init, refreshDay } from './ui.js';

function initialTheme() {
  try {
    const t = localStorage.getItem('theme');
    if (t === 'dark' || t === 'light') return t;
  } catch {}
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

async function boot() {
  await db.openDB();
  await db.ensureSeed();
  let profile = await db.getProfile();
  if (!profile) {
    profile = { ...DEFAULT_PROFILE, createdAt: Date.now() };
    await db.saveProfile(profile);
    // First launch: ask Safari not to evict our IndexedDB.
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }
  const [weights, foods, logs] = await Promise.all([db.getWeights(), db.getFoods(), db.getFoodLogs()]);
  init({ profile, weights, foods, logs }, { theme: initialTheme() });

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshDay(); });
  registerSW();
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const banner = document.getElementById('update-banner');
  let reloading = false;
  const showBanner = worker => {
    banner.hidden = false;
    banner.onclick = () => worker.postMessage({ type: 'SKIP_WAITING' });
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js').then(reg => {
    if (reg.waiting && navigator.serviceWorker.controller) showBanner(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) showBanner(w);
      });
    });
    // iOS standalone rarely checks for updates on its own.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
}

boot().catch(err => {
  console.error(err);
  document.getElementById('today-date').textContent = 'LỖI KHỞI ĐỘNG: ' + err.message;
});
