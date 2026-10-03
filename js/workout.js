// Tập luyện tab: overview, active workout, rest timer, exercise/workout sheets.
import { TZ, addDays, daysBetween, localDate, searchFoods } from './calc.js';
import {
  doneSets, workoutStats, weekDays, doneWorkouts, workoutsBetween, setsByMuscle, lastPerformance, suggestNext,
  exerciseHistory, personalRecords, newRecords, formatDuration, exerciseEntry, workoutFromTemplate, templateFromWorkout,
  finalizeWorkout, e1rm
} from './training.js';
import * as db from './db.js';
import { MUSCLES } from '../data/exercises.seed.js';
import { $, fmt, fmt1, fmtKg, parseNum, esc, sortVi, showToast } from './dom.js';

const MUSCLE_LABEL = Object.fromEntries(MUSCLES.map(m => [m.id, m.label]));
const DAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const SETS_TARGET = 10; // sets / muscle / week, lower bound of the usual 10–20 hypertrophy range
const PLUS = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="stroke-width:2.4px;stroke-linecap:round"><path d="M12 5v14M5 12h14"></path></svg>';
const CHECK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="stroke-width:2.8px;stroke-linecap:round;stroke-linejoin:round"><path d="m5 12.5 4.5 4.5L19 7.5"></path></svg>';
const CHEVRON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" style="flex:none;stroke-width:2.2px;stroke-linecap:round;stroke-linejoin:round"><path d="m9 6 6 6-6 6"></path></svg>';

const st = {
  exercises: [], workouts: [], templates: [],
  active: null,
  tplEdit: false, historyLimit: 8, progressAll: false,
  armed: null, // key of a destructive button waiting for its 2nd tap
  sheet: { open: false, mode: null, query: '', muscle: 'all', exerciseId: null, workoutId: null, records: null, form: null },
  rest: null // { endsAt, total }
};
let ctx = null; // { getProfile, getToday, setTab }
let tick = null, saveTimer = null, wakeLock = null, audio = null;

// ---------- small helpers ----------
const catalog = () => new Map(st.exercises.map(e => [e.id, e]));
const today = () => ctx.getToday();
const profile = () => ctx.getProfile() || {};
const dayLabel = date => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 5)).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: TZ });
};
const setStr = s => `${s.kg > 0 ? fmtKg(s.kg) + '×' : ''}${s.reps}`;
const clock = sec => `${Math.floor(sec / 60)}:${String(Math.max(0, sec % 60)).padStart(2, '0')}`;
const elapsed = w => {
  const s = Math.max(0, Math.floor((Date.now() - w.startedAt) / 1000));
  const h = Math.floor(s / 3600);
  return h ? `${h}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : clock(s);
};
const sectionLabel = t => `<span style="font-size:12px;font-weight:600;color:var(--text3);padding:6px 4px 0">${t}</span>`;
const rowBtn = (attrs, inner, i) => `<button ${attrs} style="width:100%;display:flex;align-items:center;gap:12px;min-height:56px;padding:8px 14px 8px 16px;background:none;border:0;border-top:${i ? '1px solid var(--line)' : '0'};cursor:pointer;text-align:left">${inner}</button>`;
const twoLine = (title, meta) => `<span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font-size:15px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${title}</span><span style="font-size:12px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${meta}</span></span>`;
const bigBtn = (attrs, label, kind = 'acc') => {
  const styles = {
    acc: 'background:var(--acc);color:var(--onacc);font-weight:700',
    soft: 'background:var(--surface2);color:var(--text);font-weight:600',
    surface: 'background:var(--surface);color:var(--acc);font-weight:600',
    danger: 'background:none;color:var(--p);font-weight:600'
  };
  return `<button ${attrs} style="height:52px;border-radius:16px;border:0;${styles[kind]};font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px">${label}</button>`;
};
const arm = (key, label, armedLabel) => (st.armed === key ? armedLabel : label);
function confirmTwice(key) {
  if (st.armed === key) { st.armed = null; return true; }
  st.armed = key;
  render(true);
  return false;
}

function save(w) {
  clearTimeout(saveTimer);
  saveTimer = null;
  const i = st.workouts.findIndex(x => x.id === w.id);
  if (i >= 0) st.workouts[i] = w; else st.workouts.push(w);
  return db.saveWorkout(w);
}
function saveSoon() {
  clearTimeout(saveTimer);
  const w = st.active;
  saveTimer = setTimeout(() => { if (w) save(w); }, 400);
}

// ---------- overview ----------
function renderWeek() {
  const t = today();
  const days = weekDays(t);
  const ws = workoutsBetween(st.workouts, days[0], days[6]);
  const doneDays = new Set(ws.map(w => w.date));
  const target = profile().trainingDays ?? 4;
  $('wk-week').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <span style="font-size:15px;font-weight:600">Tuần này</span>
      <span style="font-size:13px;color:var(--text3)"><b style="color:${ws.length >= target ? 'var(--acc)' : 'var(--text)'};font-size:15px">${ws.length}</b> / ${target} buổi</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px">
      ${days.map((d, i) => {
        const done = doneDays.has(d), isToday = d === t;
        return `<div style="display:flex;flex-direction:column;align-items:center;gap:6px">
          <span style="width:34px;height:34px;border-radius:17px;display:flex;align-items:center;justify-content:center;background:${done ? 'var(--acc)' : 'var(--track)'};color:${done ? 'var(--onacc)' : 'var(--text3)'};box-shadow:${isToday ? 'inset 0 0 0 2px var(--acc)' : 'none'}">${done ? CHECK : ''}</span>
          <span style="font-size:11px;font-weight:${isToday ? 700 : 500};color:${isToday ? 'var(--text)' : 'var(--text3)'}">${DAY_LABELS[i]}</span>
        </div>`;
      }).join('')}
    </div>`;
}

function renderStart() {
  const cat = catalog();
  const rows = [rowBtn('data-start="blank"', `<span style="width:32px;height:32px;flex:none;border-radius:16px;background:var(--accsoft);color:var(--acc);display:flex;align-items:center;justify-content:center">${PLUS}</span>${twoLine('Buổi trống', 'Tự chọn bài tập')}`, 0)];
  const tpls = st.templates.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.name.localeCompare(b.name, 'vi'));
  tpls.forEach((t, i) => {
    const muscles = [...new Set(t.exercises.map(e => cat.get(e.exerciseId)?.muscle).filter(Boolean))].map(m => MUSCLE_LABEL[m]).slice(0, 4).join(', ');
    const meta = `${t.exercises.length} bài · ${t.exercises.reduce((a, e) => a + e.sets, 0)} set${muscles ? ' · ' + muscles : ''}`;
    if (st.tplEdit) {
      rows.push(`<div style="display:flex;align-items:center;gap:12px;min-height:56px;padding:8px 8px 8px 16px;border-top:1px solid var(--line)">${twoLine(esc(t.name), meta)}
        <button data-del-tpl="${esc(t.id)}" style="min-height:40px;padding:0 12px;border:0;border-radius:12px;background:var(--surface2);color:var(--p);font-size:14px;font-weight:700;cursor:pointer">${arm('tpl:' + t.id, 'Xoá', 'Xoá thật?')}</button></div>`);
    } else {
      rows.push(rowBtn(`data-start="${esc(t.id)}"`, `${twoLine(esc(t.name), meta)}<span style="font-size:14px;font-weight:700;color:var(--acc);flex:none">Bắt đầu</span>`, i + 1));
    }
  });
  $('wk-start').innerHTML = rows.join('');
  $('wk-tpl-edit').textContent = st.tplEdit ? 'Xong' : 'Sửa';
  $('wk-tpl-edit').hidden = !st.templates.length;
}

function renderMuscles() {
  const days = weekDays(today());
  const counts = setsByMuscle(st.workouts, days[0], days[6]);
  $('wk-muscles').innerHTML = MUSCLES.map(m => {
    const n = counts[m.id] || 0;
    return `<div style="display:grid;grid-template-columns:96px minmax(0,1fr) 44px;align-items:center;gap:10px">
      <span style="font-size:13px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.label}</span>
      <div style="height:8px;border-radius:4px;background:var(--track);overflow:hidden;position:relative">
        <div style="height:100%;border-radius:4px;background:var(--acc);opacity:${n >= SETS_TARGET ? 1 : 0.55};width:${Math.min(100, (n / 20) * 100)}%;transition:width .6s"></div>
        <span style="position:absolute;top:0;bottom:0;left:50%;width:2px;background:var(--surface)"></span>
      </div>
      <span style="font-size:13px;font-weight:600;text-align:right">${n} set</span>
    </div>`;
  }).join('') + `<span style="font-size:12px;color:var(--text3);padding-top:2px">Vạch giữa = ${SETS_TARGET} set/tuần · nên 10–20 set mỗi nhóm cơ để tăng cơ.</span>`;
}

function progressRows() {
  const cat = catalog();
  const ids = new Set();
  for (const w of doneWorkouts(st.workouts)) for (const e of w.exercises) ids.add(e.exerciseId);
  const out = [];
  for (const id of ids) {
    const h = exerciseHistory(st.workouts, id);
    if (!h.length) continue;
    const last = h[h.length - 1];
    const ex = cat.get(id) || st.workouts.flatMap(w => w.exercises).find(e => e.exerciseId === id);
    const bw = ex?.isBodyweight && !(last.bestKg > 0);
    const metric = p => (bw ? p.bestReps : p.bestE1rm);
    const base = h.filter(p => p.date <= addDays(today(), -28)).pop() || h[0];
    const delta = metric(last) - metric(base);
    out.push({ id, name: ex?.name || id, last, sessions: h.length, bw, value: metric(last), delta, hasBase: base !== last });
  }
  return out.sort((a, b) => (a.last.date < b.last.date ? 1 : a.last.date > b.last.date ? -1 : 0));
}

function renderProgress() {
  const rows = progressRows();
  if (!rows.length) {
    $('wk-progress').innerHTML = `<div style="padding:18px 16px;font-size:14px;color:var(--text3)">Hoàn thành buổi tập đầu tiên để xem tiến độ từng bài.</div>`;
    return;
  }
  const shown = st.progressAll ? rows : rows.slice(0, 6);
  $('wk-progress').innerHTML = shown.map((r, i) => {
    const val = r.bw ? `Tối đa ${r.value} reps` : `e1RM ${fmt1(r.value)} kg`;
    const d = r.hasBase && Math.abs(r.delta) > 1e-9
      ? `<span style="font-size:13px;font-weight:700;color:${r.delta > 0 ? 'var(--acc)' : 'var(--text3)'};flex:none">${r.delta > 0 ? '+' : '−'}${r.bw ? Math.abs(r.delta) : fmt1(Math.abs(r.delta))}${r.bw ? '' : ' kg'}</span>` : '';
    return rowBtn(`data-ex-detail="${esc(r.id)}"`, `${twoLine(esc(r.name), `${val} · ${r.sessions} buổi`)}${d}${CHEVRON}`, i);
  }).join('') + (rows.length > 6 ? `<button data-progress-all style="width:100%;min-height:48px;border:0;border-top:1px solid var(--line);background:none;color:var(--acc);font-size:14px;font-weight:600;cursor:pointer">${st.progressAll ? 'Thu gọn' : `Xem tất cả (${rows.length})`}</button>` : '');
}

function renderHistory() {
  const ws = doneWorkouts(st.workouts);
  if (!ws.length) {
    $('wk-history').innerHTML = `<div style="padding:18px 16px;font-size:14px;color:var(--text3)">Chưa có buổi tập nào.</div>`;
    return;
  }
  $('wk-history').innerHTML = ws.slice(0, st.historyLimit).map((w, i) => {
    const s = workoutStats(w);
    return rowBtn(`data-wk-detail="${esc(w.id)}"`, `${twoLine(esc(w.name), `${dayLabel(w.date)} · ${formatDuration(s.durationMs)}`)}
      <span style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex:none"><span style="font-size:15px;font-weight:600">${s.sets} <span style="font-size:12px;font-weight:400;color:var(--text3)">set</span></span><span style="font-size:12px;color:var(--text3)">${fmt(s.volume)} kg</span></span>`, i);
  }).join('') + (ws.length > st.historyLimit ? `<button data-history-more style="width:100%;min-height:48px;border:0;border-top:1px solid var(--line);background:none;color:var(--acc);font-size:14px;font-weight:600;cursor:pointer">Xem thêm</button>` : '');
}

// ---------- active workout ----------
function placeholders(e, j, prev, sug) {
  const before = e.sets.slice(0, j).reverse().find(s => s.kg != null);
  const kg = before ? before.kg : sug ? sug.kg : prev?.[j]?.kg ?? prev?.[prev.length - 1]?.kg ?? null;
  const reps = sug ? sug.reps : prev?.[j]?.reps ?? e.repMin;
  return { kg: e.isBodyweight && !(kg > 0) ? 0 : kg, reps };
}

function renderActive() {
  const w = st.active;
  const s = workoutStats({ ...w, endedAt: Date.now() });
  const total = w.exercises.reduce((a, e) => a + e.sets.length, 0);
  const inc = profile().increment ?? 2.5;
  const cards = w.exercises.map((e, i) => {
    const prev = lastPerformance(st.workouts, e.exerciseId, w.id);
    const sug = suggestNext(prev, e, inc, e.isBodyweight);
    const sugText = sug ? (e.isBodyweight
      ? `Mục tiêu: ${sug.reps} reps${sug.kg > 0 ? ` @ +${fmtKg(sug.kg)} kg` : ''}`
      : `Gợi ý: ${fmtKg(sug.kg)} kg × ${sug.reps}${sug.increase ? ' · lên tạ ↑' : ''}`) : `Mục tiêu ${e.repMin}–${e.repMax} reps`;
    const rows = e.sets.map((set, j) => {
      const ph = placeholders(e, j, prev, sug);
      const p = prev?.[j];
      return `<div style="display:grid;grid-template-columns:24px minmax(0,1fr) 68px 56px 40px;align-items:center;gap:8px;padding:4px 6px;border-radius:12px;background:${set.done ? 'var(--accsoft)' : 'transparent'}">
        <span style="font-size:14px;font-weight:700;color:var(--text2);text-align:center">${j + 1}</span>
        <span style="font-size:13px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p ? setStr(p) : '—'}</span>
        <input data-ex="${i}" data-set="${j}" data-field="kg" inputmode="decimal" autocomplete="off" value="${set.kg != null ? fmtKg(set.kg) : ''}" placeholder="${ph.kg != null ? fmtKg(ph.kg) : 'kg'}" style="width:100%;height:40px;border-radius:10px;border:0;background:var(--surface2);text-align:center;font-size:16px;font-weight:600;outline:none">
        <input data-ex="${i}" data-set="${j}" data-field="reps" inputmode="numeric" autocomplete="off" value="${set.reps ?? ''}" placeholder="${ph.reps ?? ''}" style="width:100%;height:40px;border-radius:10px;border:0;background:var(--surface2);text-align:center;font-size:16px;font-weight:600;outline:none">
        <button data-done="${i}:${j}" aria-label="Xong set ${j + 1}" aria-pressed="${!!set.done}" style="width:40px;height:40px;border-radius:12px;border:0;cursor:pointer;display:flex;align-items:center;justify-content:center;background:${set.done ? 'var(--acc)' : 'var(--surface2)'};color:${set.done ? 'var(--onacc)' : 'var(--text3)'}">${CHECK}</button>
      </div>`;
    }).join('');
    return `<div data-ex-card="${i}" style="background:var(--surface);border-radius:22px;padding:14px 12px 10px;display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;align-items:flex-start;gap:8px;padding:0 4px">
        <button data-ex-detail="${esc(e.exerciseId)}" style="flex:1;min-width:0;border:0;background:none;padding:0;text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:3px">
          <span style="font-size:17px;font-weight:700">${esc(e.name)}</span>
          <span style="font-size:13px;color:var(--text3)">${MUSCLE_LABEL[e.muscle] || ''}${prev ? ` · Lần trước ${prev.map(setStr).join(', ')}` : ''}</span>
          <span style="font-size:13px;font-weight:600;color:${sug?.increase ? 'var(--acc)' : 'var(--text2)'}">${sugText}</span>
        </button>
        <button data-del-ex="${i}" style="min-height:32px;padding:0 4px;border:0;background:none;color:${st.armed === 'ex:' + i ? 'var(--p)' : 'var(--text3)'};font-size:13px;font-weight:600;cursor:pointer;flex:none">${arm('ex:' + i, 'Xoá', 'Xoá bài?')}</button>
      </div>
      <div style="display:grid;grid-template-columns:24px minmax(0,1fr) 68px 56px 40px;gap:8px;padding:0 6px;font-size:11px;font-weight:600;color:var(--text3)">
        <span style="text-align:center">SET</span><span>TRƯỚC</span><span style="text-align:center">KG</span><span style="text-align:center">REPS</span><span></span>
      </div>
      ${rows}
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:2px 0 0">
        <button data-add-set="${i}" style="height:40px;border-radius:12px;border:0;background:var(--surface2);color:var(--acc);font-size:14px;font-weight:600;cursor:pointer">+ Thêm set</button>
        <button data-rm-set="${i}" ${e.sets.length <= 1 ? 'disabled' : ''} style="height:40px;border-radius:12px;border:0;background:var(--surface2);color:var(--text2);font-size:14px;font-weight:600;cursor:pointer;opacity:${e.sets.length <= 1 ? 0.4 : 1}">− Bớt set</button>
      </div>
    </div>`;
  }).join('');

  $('wk-active').innerHTML = `
    <div style="background:var(--surface);border-radius:22px;padding:16px 18px;display:flex;flex-direction:column;gap:12px">
      <input id="wk-name" value="${esc(w.name)}" aria-label="Tên buổi tập" autocomplete="off" style="width:100%;background:none;border:0;outline:none;padding:0;font-size:22px;font-weight:700;letter-spacing:-.02em">
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px">
        <div style="display:flex;flex-direction:column;gap:2px">
          <span id="wk-elapsed" style="font-size:36px;font-weight:700;letter-spacing:-.03em;line-height:1;color:var(--acc)">${elapsed(w)}</span>
          <span style="font-size:13px;color:var(--text3)">${s.sets}/${total} set · ${fmt(s.volume)} kg</span>
        </div>
        <button id="wk-finish" style="height:44px;padding:0 18px;border-radius:14px;border:0;background:var(--acc);color:var(--onacc);font-size:16px;font-weight:700;cursor:pointer;flex:none">${arm('finish', 'Kết thúc', s.sets ? 'Lưu buổi?' : 'Huỷ buổi?')}</button>
      </div>
      ${st.armed === 'finish' && !s.sets ? '<span style="font-size:13px;color:var(--p)">Chưa có set nào xong — chạm lần nữa để huỷ buổi tập.</span>' : ''}
    </div>
    ${cards || '<div style="background:var(--surface);border-radius:22px;padding:20px 18px;font-size:14px;color:var(--text3);text-align:center">Chưa có bài tập. Thêm bài để bắt đầu.</div>'}
    ${bigBtn('id="wk-add-ex"', PLUS + 'Thêm bài tập', 'surface')}
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">
      ${bigBtn('id="wk-save-tpl"', 'Lưu làm mẫu', 'soft')}
      ${bigBtn('id="wk-discard"', arm('discard', 'Huỷ buổi tập', 'Chạm để huỷ'), 'danger')}
    </div>`;
}

function renderBadge() {
  const b = $('wk-badge');
  b.hidden = !st.active;
  if (st.active) b.textContent = Math.floor((Date.now() - st.active.startedAt) / 60000) + '′';
}

// ---------- rest timer ----------
function startRest(sec) {
  if (!(sec > 0)) return;
  st.rest = { endsAt: Date.now() + sec * 1000, total: sec };
  renderRest();
}
function renderRest() {
  const el = $('rest-timer');
  if (!st.rest) { el.hidden = true; return; }
  const left = Math.ceil((st.rest.endsAt - Date.now()) / 1000);
  if (left <= 0) {
    st.rest = null;
    el.hidden = true;
    beep();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    showToast('Hết giờ nghỉ — vào set tiếp theo');
    return;
  }
  el.hidden = false;
  $('rest-left').textContent = clock(left);
  $('rest-bar').style.width = Math.max(0, Math.min(100, (left / st.rest.total) * 100)) + '%';
}
function primeAudio() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { audio = null; }
}
function beep() {
  if (!audio) return;
  try {
    const t0 = audio.currentTime;
    for (const off of [0, 0.22]) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t0 + off);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + off + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + off + 0.16);
      o.connect(g).connect(audio.destination);
      o.start(t0 + off);
      o.stop(t0 + off + 0.18);
    }
  } catch {}
}

function startTick() {
  clearInterval(tick);
  tick = setInterval(() => {
    if (st.active) {
      const el = $('wk-elapsed');
      if (el) el.textContent = elapsed(st.active);
      renderBadge();
    }
    if (st.rest) renderRest();
    if (!st.active && !st.rest) { clearInterval(tick); tick = null; }
  }, 1000);
}

async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { wakeLock = null; }
}

// ---------- sheet ----------
function openSheet(mode, extra = {}) {
  Object.assign(st.sheet, { open: true, mode, query: '', muscle: 'all', form: null }, extra);
  st.armed = null;
  renderSheet();
  $('wk-sheet-body').scrollTop = 0;
}
function closeSheet() {
  st.sheet.open = false;
  document.activeElement?.blur?.();
  renderSheet();
}

function renderSheet() {
  const sh = st.sheet;
  $('wk-sheet').style.transform = sh.open ? 'translateY(0)' : 'translateY(105%)';
  $('wk-sheet').setAttribute('aria-hidden', !sh.open);
  $('wk-sheet-scrim').style.opacity = sh.open ? 1 : 0;
  $('wk-sheet-scrim').style.pointerEvents = sh.open ? 'auto' : 'none';
  if (!sh.open) return;
  if (sh.mode === 'pick') renderPick();
  else if (sh.mode === 'create') renderCreate();
  else if (sh.mode === 'exercise') renderExerciseDetail();
  else if (sh.mode === 'workout') renderWorkoutDetail();
}

function renderPickList() {
  const sh = st.sheet;
  const inWorkout = new Set((st.active?.exercises || []).map(e => e.exerciseId));
  let list = st.exercises.slice().sort(sortVi);
  if (sh.muscle !== 'all') list = list.filter(e => e.muscle === sh.muscle);
  list = searchFoods(list, sh.query);
  const rows = list.map((e, i) => {
    const prev = lastPerformance(st.workouts, e.id);
    const meta = `${MUSCLE_LABEL[e.muscle]} · ${e.repMin}–${e.repMax} reps${prev ? ' · lần trước ' + prev.map(setStr).slice(0, 3).join(', ') : ''}${e.isCustom ? ' · Tự tạo' : ''}`;
    const added = inWorkout.has(e.id);
    return rowBtn(`data-pick="${esc(e.id)}"`, `${twoLine(esc(e.name), meta)}<span style="width:32px;height:32px;flex:none;border-radius:16px;background:${added ? 'var(--acc)' : 'var(--accsoft)'};color:${added ? 'var(--onacc)' : 'var(--acc)'};display:flex;align-items:center;justify-content:center">${added ? CHECK : PLUS}</span>`, i);
  }).join('');
  $('wk-pick-list').innerHTML = rows + (list.length ? '' : `<div style="padding:18px 16px;font-size:14px;color:var(--text3)">Không tìm thấy bài phù hợp</div>`)
    + `<button data-create-ex style="width:100%;min-height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:none;border:0;border-top:1px solid var(--line);cursor:pointer;color:var(--text3);font-size:15px">
        <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${sh.query.trim() ? `Tạo “${esc(sh.query.trim())}”` : 'Tạo bài tập mới'}</span>
        <span style="display:flex;align-items:center;gap:6px;color:var(--acc);font-weight:600;flex:none">${PLUS}Thêm</span></button>`;
  for (const b of $('wk-muscle-chips').querySelectorAll('button')) {
    const on = b.dataset.muscle === sh.muscle;
    b.style.background = on ? 'var(--acc)' : 'var(--surface)';
    b.style.color = on ? 'var(--onacc)' : 'var(--text2)';
  }
}

function renderPick() {
  $('wk-sheet-title').textContent = 'Thêm bài tập';
  $('wk-sheet-body').innerHTML = `
    <label style="display:flex;align-items:center;gap:8px;height:44px;padding:0 12px;border-radius:12px;background:var(--surface2);flex:none">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" style="flex:none;stroke-width:2.2px;stroke-linecap:round"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path></svg>
      <input id="wk-ex-search" type="search" placeholder="Tìm bài tập…" autocomplete="off" style="flex:1;min-width:0;background:none;border:0;outline:none;font-size:16px">
    </label>
    <div id="wk-muscle-chips" style="display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:0 -16px;padding:0 16px;flex:none">
      ${[{ id: 'all', label: 'Tất cả' }, ...MUSCLES].map(m => `<button data-muscle="${m.id}" style="flex:none;height:34px;padding:0 12px;border-radius:17px;border:1px solid var(--line);font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">${m.label}</button>`).join('')}
    </div>
    <div id="wk-pick-list" style="background:var(--surface);border-radius:16px;overflow:hidden;flex:none"></div>`;
  renderPickList();
}

function renderCreate() {
  const f = st.sheet.form;
  $('wk-sheet-title').textContent = f.id ? 'Sửa bài tập' : 'Bài tập mới';
  const field = (label, name, value, mode, unit, first) => `<label style="display:flex;align-items:center;gap:12px;min-height:52px;padding:0 16px;border-top:${first ? '0' : '1px solid var(--line)'}">
      <span style="flex:1;font-size:16px">${label}</span>
      <input name="${name}" type="text" inputmode="${mode}" value="${value}" autocomplete="off" style="width:76px;text-align:right;background:none;border:0;outline:none;font-size:17px;font-weight:600;color:var(--acc)">
      <span style="width:40px;font-size:14px;color:var(--text3)">${unit}</span></label>`;
  $('wk-sheet-body').innerHTML = `<form id="wk-ex-form" novalidate style="display:flex;flex-direction:column;gap:12px;margin:0">
    <div style="background:var(--surface);border-radius:18px;overflow:hidden">
      <label style="display:flex;align-items:center;gap:12px;min-height:52px;padding:0 16px">
        <span style="font-size:16px;flex:none">Tên bài</span>
        <input name="name" type="text" value="${esc(f.name || '')}" placeholder="VD: Pec Deck" autocomplete="off" style="flex:1;min-width:0;text-align:right;background:none;border:0;outline:none;font-size:17px;font-weight:600;color:var(--acc)">
      </label>
      ${field('Reps tối thiểu', 'repMin', f.repMin ?? 8, 'numeric', 'reps')}
      ${field('Reps tối đa', 'repMax', f.repMax ?? 12, 'numeric', 'reps')}
    </div>
    ${sectionLabel('NHÓM CƠ')}
    <div id="wk-form-muscle" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px;background:var(--surface2);border-radius:12px;padding:3px">
      ${MUSCLES.map(m => `<button type="button" data-value="${m.id}" style="height:40px;border:0;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;padding:0 4px;background:${f.muscle === m.id ? 'var(--surface)' : 'transparent'};color:${f.muscle === m.id ? 'var(--text)' : 'var(--text2)'}">${m.label}</button>`).join('')}
    </div>
    ${sectionLabel('LOẠI')}
    <div id="wk-form-bw" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));background:var(--surface2);border-radius:12px;padding:3px">
      ${[['0', 'Có tạ'], ['1', 'Trọng lượng cơ thể']].map(([v, l]) => { const on = (!!f.isBodyweight) === (v === '1'); return `<button type="button" data-value="${v}" style="height:40px;border:0;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;background:${on ? 'var(--surface)' : 'transparent'};color:${on ? 'var(--text)' : 'var(--text2)'}">${l}</button>`; }).join('')}
    </div>
    <span id="wk-form-error" style="font-size:13px;color:var(--p);padding:0 6px" hidden></span>
    ${bigBtn('type="submit"', 'Lưu bài tập')}
    ${bigBtn('type="button" data-form-cancel', 'Huỷ', 'soft')}
  </form>`;
}

function chartSvg(points, unit) {
  if (points.length < 2) return '';
  const W = 306, top = 8, bot = 150;
  const vals = points.map(p => p.v);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max(1, (hi - lo) * 0.15);
  lo = Math.floor(lo - pad); hi = Math.ceil(hi + pad);
  const span = Math.max(1, daysBetween(points[0].date, points[points.length - 1].date));
  const X = d => (daysBetween(points[0].date, d) / span) * W;
  const Y = v => bot - ((v - lo) / (hi - lo)) * (bot - top);
  const grid = [0, 1, 2].map(k => { const v = lo + (hi - lo) * k / 2; return { y: Y(v), label: unit === 'reps' ? Math.round(v) : fmt1(v) }; });
  const lbl = d => { const [, m, dd] = d.split('-').map(Number); return `${dd}/${m}`; };
  const path = points.map((p, i) => (i ? 'L' : 'M') + X(p.date).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join(' ');
  const last = points[points.length - 1];
  return `<svg viewBox="0 0 342 170" style="width:100%;height:auto;display:block;overflow:visible">
    ${grid.map(g => `<g><line x1="0" x2="${W}" y1="${g.y}" y2="${g.y}" stroke="var(--line)" stroke-width="1"></line><text x="342" y="${g.y + 3.5}" text-anchor="end" fill="var(--text3)" font-size="10.5">${g.label}</text></g>`).join('')}
    <text x="0" y="168" fill="var(--text3)" font-size="10.5">${lbl(points[0].date)}</text>
    <text x="${W}" y="168" text-anchor="end" fill="var(--text3)" font-size="10.5">${lbl(last.date)}</text>
    <path d="${path}" fill="none" stroke="var(--acc)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
    ${points.map(p => `<circle cx="${X(p.date)}" cy="${Y(p.v)}" r="3" fill="var(--acc)"></circle>`).join('')}
    <circle cx="${X(last.date)}" cy="${Y(last.v)}" r="5" fill="var(--acc)" stroke="var(--surface)" stroke-width="2.5"></circle>
  </svg>`;
}

const tile = (label, value, unit) => `<div style="background:var(--surface);border-radius:18px;padding:14px 12px;display:flex;flex-direction:column;gap:6px">
  <span style="font-size:12px;color:var(--text2);line-height:1.25">${label}</span>
  <span style="font-size:22px;font-weight:700;letter-spacing:-.02em">${value}<span style="font-size:13px;font-weight:500;color:var(--text3)"> ${unit}</span></span></div>`;

function renderExerciseDetail() {
  const id = st.sheet.exerciseId;
  const ex = catalog().get(id) || st.workouts.flatMap(w => w.exercises).find(e => e.exerciseId === id) || { name: id };
  const h = exerciseHistory(st.workouts, id);
  const pr = personalRecords(h);
  const bw = ex.isBodyweight && !(pr?.kg > 0);
  $('wk-sheet-title').textContent = ex.name;
  const chart = chartSvg(h.slice(-20).map(p => ({ date: p.date, v: bw ? p.bestReps : p.bestE1rm })), bw ? 'reps' : 'kg');
  const sessions = h.slice().reverse().slice(0, 12).map((p, i) => `<div style="display:flex;align-items:center;gap:12px;min-height:52px;padding:8px 16px;border-top:${i ? '1px solid var(--line)' : '0'}">
      ${twoLine(dayLabel(p.date), p.sets.map(setStr).join(' · '))}
      <span style="font-size:13px;font-weight:600;flex:none">${bw ? p.bestReps + ' reps' : 'e1RM ' + fmt1(p.bestE1rm)}</span></div>`).join('');
  $('wk-sheet-body').innerHTML = `
    <span style="font-size:13px;color:var(--text3);padding:0 4px">${MUSCLE_LABEL[ex.muscle] || ''}${ex.repMin ? ` · ${ex.repMin}–${ex.repMax} reps` : ''}${ex.isCustom ? ' · Tự tạo' : ''}</span>
    ${pr ? `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">
      ${bw ? tile('Reps tối đa', pr.reps, 'reps') + tile('Buổi đã tập', h.length, 'buổi') + tile('Tạ thêm max', fmtKg(pr.kg), 'kg')
           : tile('e1RM tốt nhất', fmt1(pr.e1rm), 'kg') + tile('Tạ nặng nhất', fmtKg(pr.kg), 'kg') + tile('Buổi đã tập', h.length, 'buổi')}
    </div>` : ''}
    ${chart ? `<div style="background:var(--surface);border-radius:22px;padding:16px 16px 12px;display:flex;flex-direction:column;gap:10px">
      <span style="font-size:12px;color:var(--text2)">${bw ? 'Reps tốt nhất mỗi buổi' : 'e1RM mỗi buổi (Epley)'}</span>${chart}</div>` : ''}
    ${h.length ? sectionLabel('CÁC BUỔI GẦN ĐÂY') + `<div style="background:var(--surface);border-radius:18px;overflow:hidden;flex:none">${sessions}</div>`
      : '<div style="background:var(--surface);border-radius:18px;padding:18px 16px;font-size:14px;color:var(--text3)">Chưa có dữ liệu cho bài này.</div>'}
    ${ex.isCustom ? `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">${bigBtn('data-edit-ex', 'Sửa bài', 'soft')}${bigBtn('data-del-custom-ex', arm('cex', 'Xoá bài tập', 'Chạm để xoá'), 'danger')}</div>` : ''}`;
}

function renderWorkoutDetail() {
  const w = st.workouts.find(x => x.id === st.sheet.workoutId);
  if (!w) { closeSheet(); return; }
  const s = workoutStats(w);
  const recs = st.sheet.records || newRecords(w, st.workouts);
  $('wk-sheet-title').textContent = w.name;
  $('wk-sheet-body').innerHTML = `
    <span style="font-size:13px;color:var(--text3);padding:0 4px">${dayLabel(w.date)}</span>
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">
      ${tile('Thời gian', formatDuration(s.durationMs).replace(' phút', ''), s.durationMs >= 3600000 ? '' : 'phút')}${tile('Số set', s.sets, 'set')}${tile('Khối lượng', fmt(s.volume), 'kg')}
    </div>
    ${recs.length ? `<div style="background:var(--accsoft);border-radius:18px;padding:14px 16px;display:flex;flex-direction:column;gap:6px">
      <span style="font-size:13px;font-weight:700;color:var(--acc)">KỶ LỤC MỚI · ${recs.length}</span>
      ${recs.map(r => `<span style="font-size:14px">${esc(r.name)} — <b>${setStr(r)}</b></span>`).join('')}</div>` : ''}
    <div style="background:var(--surface);border-radius:18px;overflow:hidden;flex:none">
      ${w.exercises.map((e, i) => rowBtn(`data-ex-detail="${esc(e.exerciseId)}"`, `${twoLine(esc(e.name), e.sets.map(setStr).join(' · '))}${CHEVRON}`, i)).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">
      ${bigBtn(`data-repeat="${esc(w.id)}"`, 'Tập lại')}${bigBtn(`data-tpl-from="${esc(w.id)}"`, 'Lưu làm mẫu', 'soft')}
    </div>
    ${bigBtn(`data-del-wk="${esc(w.id)}"`, arm('wk:' + w.id, 'Xoá buổi tập', 'Chạm lần nữa để xoá'), 'danger')}`;
}

// ---------- actions ----------
async function startWorkout(name, exercises, templateId = null) {
  if (st.active) { ctx.setTab('workout'); return; }
  const w = { id: db.newId(), date: localDate(new Date()), name, templateId, status: 'active', startedAt: Date.now(), endedAt: null, exercises };
  st.active = w;
  await save(w);
  ctx.setTab('workout');
  $('scroll').scrollTop = 0;
  startTick();
  keepAwake(true);
  if (!exercises.length) openSheet('pick');
}

function addExercise(id) {
  const ex = catalog().get(id);
  if (!ex || !st.active) return;
  const prev = lastPerformance(st.workouts, id, st.active.id);
  st.active.exercises.push(exerciseEntry(ex, prev ? Math.min(5, Math.max(2, prev.length)) : 3));
  save(st.active);
  render(true);
  showToast(`Đã thêm ${ex.name}`);
}

async function toggleDone(i, j) {
  const w = st.active, e = w.exercises[i], set = e.sets[j];
  if (set.done) { set.done = false; save(w); render(true); return; }
  primeAudio();
  const prev = lastPerformance(st.workouts, e.exerciseId, w.id);
  const ph = placeholders(e, j, prev, suggestNext(prev, e, profile().increment ?? 2.5, e.isBodyweight));
  if (set.kg == null) set.kg = ph.kg ?? (e.isBodyweight ? 0 : null);
  if (set.reps == null) set.reps = ph.reps;
  if (set.kg == null || !(set.reps > 0)) { showToast('Nhập kg và reps trước'); render(true); return; }
  set.done = true;
  await save(w);
  const isLastSet = w.exercises.every(x => x.sets.every(s => s.done));
  if (!isLastSet) startRest(profile().restSec ?? 90);
  startTick();
  render(true);
}

async function finishWorkout() {
  const w = st.active;
  const s = workoutStats({ ...w, endedAt: Date.now() });
  if (!confirmTwice('finish')) return;
  if (!s.sets) { await discardWorkout(true); return; }
  const done = finalizeWorkout(w, Date.now());
  await save(done);
  st.active = null;
  st.rest = null;
  renderRest();
  keepAwake(false);
  const recs = newRecords(done, st.workouts);
  render(true);
  $('scroll').scrollTop = 0;
  openSheet('workout', { workoutId: done.id, records: recs });
  showToast(`Đã lưu ${done.name} · ${s.sets} set${recs.length ? ` · ${recs.length} kỷ lục mới` : ''}`);
}

async function discardWorkout(confirmed = false) {
  if (!confirmed && !confirmTwice('discard')) return;
  const w = st.active;
  await db.deleteWorkout(w.id);
  st.workouts = st.workouts.filter(x => x.id !== w.id);
  st.active = null;
  st.rest = null;
  st.armed = null;
  renderRest();
  keepAwake(false);
  render(true);
  $('scroll').scrollTop = 0;
  showToast('Đã huỷ buổi tập');
}

async function saveTemplateFrom(w) {
  if (!w.exercises.length) { showToast('Buổi tập chưa có bài nào'); return; }
  const base = templateFromWorkout(w);
  const existing = st.templates.find(t => t.name.trim().toLowerCase() === base.name.trim().toLowerCase());
  const tpl = existing ? { ...existing, exercises: base.exercises } : { id: db.newId(), name: base.name, exercises: base.exercises, createdAt: Date.now() };
  await db.saveTemplate(tpl);
  st.templates = st.templates.filter(t => t.id !== tpl.id).concat(tpl);
  render(true);
  showToast(existing ? `Đã cập nhật mẫu ${tpl.name}` : `Đã lưu mẫu ${tpl.name}`);
}

async function submitExerciseForm(e) {
  e.preventDefault();
  const el = $('wk-ex-form').elements;
  const f = st.sheet.form;
  const name = el.name.value.trim();
  const repMin = parseNum(el.repMin.value), repMax = parseNum(el.repMax.value);
  const err = !name ? 'Nhập tên bài' : !f.muscle ? 'Chọn nhóm cơ' : !(repMin >= 1 && repMax >= repMin && repMax <= 100) ? 'Khoảng reps không hợp lệ' : null;
  if (err) { $('wk-form-error').textContent = err; $('wk-form-error').hidden = false; return; }
  const ex = { id: f.id || db.newId(), name, muscle: f.muscle, repMin: Math.round(repMin), repMax: Math.round(repMax), isBodyweight: !!f.isBodyweight, isCustom: true };
  await db.saveExercise(ex);
  st.exercises = st.exercises.filter(x => x.id !== ex.id).concat(ex);
  if (f.id) { openSheet('exercise', { exerciseId: ex.id }); showToast(`Đã cập nhật ${ex.name}`); return; }
  if (st.active) { closeSheet(); addExercise(ex.id); return; }
  openSheet('exercise', { exerciseId: ex.id });
  showToast(`Đã tạo ${ex.name}`);
}

// ---------- public ----------
/** force = rebuild the active workout even if a set input has focus (user actions). */
export function render(force = false) {
  if (!ctx) return;
  const t = today();
  const days = weekDays(t);
  const n = workoutsBetween(st.workouts, days[0], days[6]).length;
  $('wk-subtitle').textContent = st.active ? `ĐANG TẬP · ${dayLabel(st.active.date).toUpperCase()}` : `TUẦN NÀY · ${n}/${profile().trainingDays ?? 4} BUỔI`;
  $('wk-main').hidden = !!st.active;
  $('wk-active').hidden = !st.active;
  if (st.active) {
    // Don't rebuild while the user is typing in a set input (keeps focus and caret).
    const a = document.activeElement;
    if (force || !(a && a.closest && a.closest('#wk-active') && a.tagName === 'INPUT')) renderActive();
  } else {
    renderWeek();
    renderStart();
    renderMuscles();
    renderProgress();
    renderHistory();
  }
  renderBadge();
  renderSheet();
}

export async function reload() {
  [st.exercises, st.workouts, st.templates] = await Promise.all([db.getExercises(), db.getWorkouts(), db.getTemplates()]);
  st.active = st.workouts.find(w => w.status === 'active') || null;
  if (st.active) { startTick(); keepAwake(true); }
  render(true);
}

export function init(data, context) {
  ctx = context;
  st.exercises = data.exercises;
  st.workouts = data.workouts;
  st.templates = data.templates;
  st.active = data.workouts.find(w => w.status === 'active') || null;
  if (st.active) startTick();

  // Overview
  $('wk-start').addEventListener('click', e => {
    const del = e.target.closest('[data-del-tpl]');
    if (del) {
      const id = del.dataset.delTpl;
      if (!confirmTwice('tpl:' + id)) return;
      db.deleteTemplate(id).then(() => { st.templates = st.templates.filter(t => t.id !== id); render(true); showToast('Đã xoá mẫu'); });
      return;
    }
    const b = e.target.closest('[data-start]');
    if (!b) return;
    if (b.dataset.start === 'blank') return startWorkout('Buổi tập', []);
    const tpl = st.templates.find(t => t.id === b.dataset.start);
    if (tpl) startWorkout(tpl.name, workoutFromTemplate(tpl, catalog()), tpl.id);
  });
  $('wk-tpl-edit').addEventListener('click', () => { st.tplEdit = !st.tplEdit; st.armed = null; render(true); });
  $('wk-progress').addEventListener('click', e => {
    if (e.target.closest('[data-progress-all]')) { st.progressAll = !st.progressAll; return render(true); }
    const b = e.target.closest('[data-ex-detail]');
    if (b) openSheet('exercise', { exerciseId: b.dataset.exDetail });
  });
  $('wk-history').addEventListener('click', e => {
    if (e.target.closest('[data-history-more]')) { st.historyLimit += 10; return render(true); }
    const b = e.target.closest('[data-wk-detail]');
    if (b) openSheet('workout', { workoutId: b.dataset.wkDetail, records: null });
  });

  // Active workout (delegated; content is re-rendered)
  const act = $('wk-active');
  act.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'wk-name') { st.active.name = t.value.trim() || 'Buổi tập'; saveSoon(); return; }
    if (!t.dataset.field) return;
    const set = st.active.exercises[+t.dataset.ex].sets[+t.dataset.set];
    const v = t.value.trim() === '' ? null : parseNum(t.value);
    set[t.dataset.field] = v == null ? null : t.dataset.field === 'reps' ? Math.round(v) : v;
    saveSoon();
  });
  act.addEventListener('click', e => {
    const t = e.target;
    const done = t.closest('[data-done]');
    if (done) { const [i, j] = done.dataset.done.split(':').map(Number); return toggleDone(i, j); }
    const add = t.closest('[data-add-set]');
    if (add) {
      const ex = st.active.exercises[+add.dataset.addSet];
      const last = ex.sets[ex.sets.length - 1];
      ex.sets.push({ kg: last?.kg ?? null, reps: last?.reps ?? null, done: false });
      save(st.active); return render(true);
    }
    const rm = t.closest('[data-rm-set]');
    if (rm) {
      const ex = st.active.exercises[+rm.dataset.rmSet];
      if (ex.sets.length > 1) { const k = ex.sets.map(s => s.done).lastIndexOf(false); ex.sets.splice(k >= 0 ? k : ex.sets.length - 1, 1); save(st.active); }
      return render(true);
    }
    const del = t.closest('[data-del-ex]');
    if (del) {
      const i = +del.dataset.delEx;
      if (!confirmTwice('ex:' + i)) return;
      st.active.exercises.splice(i, 1); save(st.active); return render(true);
    }
    const det = t.closest('[data-ex-detail]');
    if (det) return openSheet('exercise', { exerciseId: det.dataset.exDetail });
    if (t.closest('#wk-add-ex')) return openSheet('pick');
    if (t.closest('#wk-finish')) return finishWorkout();
    if (t.closest('#wk-discard')) return discardWorkout();
    if (t.closest('#wk-save-tpl')) return saveTemplateFrom(st.active);
    if (st.armed && !t.closest('button')) { st.armed = null; render(true); }
  });

  // Rest timer
  $('rest-timer').addEventListener('click', e => {
    const b = e.target.closest('[data-rest]');
    if (!b || !st.rest) return;
    if (b.dataset.rest === 'skip') st.rest = null;
    else { const d = Number(b.dataset.rest) * 1000; st.rest.endsAt += d; st.rest.total = Math.max(st.rest.total + d / 1000, 1); }
    renderRest();
  });

  // Sheet
  $('wk-sheet-done').addEventListener('click', closeSheet);
  $('wk-sheet-scrim').addEventListener('click', closeSheet);
  const body = $('wk-sheet-body');
  body.addEventListener('input', e => {
    if (e.target.id === 'wk-ex-search') { st.sheet.query = e.target.value; renderPickList(); }
  });
  body.addEventListener('submit', e => submitExerciseForm(e).catch(err => showToast('Lỗi: ' + err.message)));
  body.addEventListener('click', e => {
    const t = e.target, sh = st.sheet;
    const chip = t.closest('[data-muscle]');
    if (chip) { sh.muscle = chip.dataset.muscle; return renderPickList(); }
    const pick = t.closest('[data-pick]');
    if (pick) {
      if (!st.active) return openSheet('exercise', { exerciseId: pick.dataset.pick });
      addExercise(pick.dataset.pick);
      return renderPickList();
    }
    if (t.closest('[data-create-ex]')) return openSheet('create', { form: { name: sh.query.trim(), muscle: sh.muscle !== 'all' ? sh.muscle : null, repMin: 8, repMax: 12, isBodyweight: false } });
    const mus = t.closest('#wk-form-muscle [data-value]');
    if (mus) { syncForm(); sh.form.muscle = mus.dataset.value; return renderCreate(); }
    const bw = t.closest('#wk-form-bw [data-value]');
    if (bw) { syncForm(); sh.form.isBodyweight = bw.dataset.value === '1'; return renderCreate(); }
    if (t.closest('[data-form-cancel]')) return sh.form.id ? openSheet('exercise', { exerciseId: sh.form.id }) : openSheet('pick');
    if (t.closest('[data-edit-ex]')) { const ex = catalog().get(sh.exerciseId); return openSheet('create', { form: { ...ex } }); }
    if (t.closest('[data-del-custom-ex]')) {
      if (!confirmTwice('cex')) return renderSheet();
      const id = sh.exerciseId;
      db.deleteExercise(id).then(() => { st.exercises = st.exercises.filter(x => x.id !== id); closeSheet(); render(true); showToast('Đã xoá bài tập · lịch sử vẫn giữ'); });
      return;
    }
    const det = t.closest('[data-ex-detail]');
    if (det) return openSheet('exercise', { exerciseId: det.dataset.exDetail });
    const rep = t.closest('[data-repeat]');
    if (rep) {
      const w = st.workouts.find(x => x.id === rep.dataset.repeat);
      if (st.active) { showToast('Đang có buổi tập chưa kết thúc'); return; }
      closeSheet();
      const cat = catalog();
      return startWorkout(w.name, w.exercises.map(e => exerciseEntry(cat.get(e.exerciseId) || { id: e.exerciseId, name: e.name, muscle: e.muscle, repMin: e.repMin, repMax: e.repMax, isBodyweight: e.isBodyweight }, e.sets.length)), w.templateId);
    }
    const tf = t.closest('[data-tpl-from]');
    if (tf) return saveTemplateFrom(st.workouts.find(x => x.id === tf.dataset.tplFrom));
    const dw = t.closest('[data-del-wk]');
    if (dw) {
      const id = dw.dataset.delWk;
      if (!confirmTwice('wk:' + id)) return renderSheet();
      const w = st.workouts.find(x => x.id === id);
      db.deleteWorkout(id).then(() => {
        st.workouts = st.workouts.filter(x => x.id !== id);
        closeSheet(); render(true);
        showToast('Đã xoá buổi tập', async () => { await db.saveWorkout(w); st.workouts.push(w); render(true); });
      });
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (st.active) keepAwake(true);
      if (st.rest) renderRest();
    }
  });
  if (st.active) keepAwake(true);
}

function syncForm() {
  const el = $('wk-ex-form')?.elements;
  if (!el) return;
  Object.assign(st.sheet.form, { name: el.name.value, repMin: el.repMin.value, repMax: el.repMax.value });
}
