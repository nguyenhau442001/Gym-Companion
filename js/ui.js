// Render functions + event handlers. Reads/writes go through db.js; math through calc.js.
import {
  SLOTS, TZ, localDate, localHour, addDays, daysBetween, calcTargets, calcWeight, avg7, latestWeight, avgSeries,
  weeklyChange, weeklyGoal, weightAdvice, isMealLow, sumMacros, macrosBySlot, snapshotFor, topFoods, searchFoods,
  defaultSlot, validateBackup, DEFAULT_PROFILE
} from './calc.js';
import * as db from './db.js';
import { DEFAULT_CHIPS } from '../data/foods.seed.js';
import { $, fmt, fmt1, signed1, multLabel, pct, parseNum, esc, sortVi, setLead, setSeg, setIfIdle, showToast, initToast } from './dom.js';
import * as workout from './workout.js';

const RING = 464.96;
const W_PLOT = 306;
const THEME_COLORS = { dark: '#121315', light: '#f4f5f6' };

const state = {
  profile: null, weights: [], foods: [], logs: [],
  today: localDate(new Date()), tab: 'today', theme: 'dark',
  sheetOpen: false, query: '', slot: defaultSlot(localHour(new Date())), mult: 1,
  editingFood: null, deleteArmed: false,
  range: 8, selectedLogId: null, newId: null,
  weightInput: '', weightSaved: false, pendingImport: null
};

// ---------- helpers ----------
const slotLabel = id => (SLOTS.find(s => s.id === id) || {}).label || '';

// ---------- derived ----------
function derived() {
  const kg = calcWeight(state.weights, state.today);
  const targets = state.profile ? calcTargets(state.profile, kg) : null;
  const todayLogs = state.logs.filter(l => l.date === state.today);
  return { kg, targets, todayLogs };
}

// ---------- render: today ----------
function renderToday(d) {
  const { targets: T, todayLogs, kg } = d;
  const tot = sumMacros(todayLogs);
  const now = new Date();
  $('today-date').textContent = now.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: TZ }).toUpperCase();
  $('kcal-eaten').textContent = fmt(tot.kcal);
  $('kcal-target').textContent = T ? fmt(T.kcal) : '—';
  $('kcal-remaining').textContent = T ? fmt(Math.max(0, T.kcal - tot.kcal)) : '—';
  $('surplus-label').textContent = '+' + (state.profile?.surplus ?? 400);
  $('kcal-ring-fill').style.strokeDashoffset = T ? RING * (1 - Math.min(1, tot.kcal / T.kcal)) : RING;
  for (const [k, key] of [['protein', 'protein'], ['carb', 'carb'], ['fat', 'fat']]) {
    $(k + '-eaten').textContent = fmt(tot[key]);
    $(k + '-target').textContent = T ? fmt(T[key]) : '—';
    $(k + '-bar').style.width = T ? pct(tot[key], T[key]) : '0%';
  }

  const bySlot = macrosBySlot(todayLogs);
  const ppm = T ? T.proteinPerMeal : 0;
  $('ppm-target').textContent = T ? fmt(ppm) : '—';
  $('ppm-grid').innerHTML = SLOTS.map(s => {
    const v = bySlot[s.id].protein;
    const hasLogs = todayLogs.some(l => l.mealSlot === s.id);
    const low = hasLogs && isMealLow(v, kg);
    return `<div data-slot="${s.id}" style="display:flex;flex-direction:column;gap:6px">
          <div style="height:44px;border-radius:10px;background:var(--track);position:relative;overflow:hidden">
            <div style="position:absolute;left:0;right:0;bottom:0;background:var(--p);opacity:${ppm && v >= ppm ? 1 : 0.55};height:${pct(v, ppm)};transition:height .6s"></div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:4px">
            <span style="font-size:12px;color:var(--text2)">${s.label}</span>
            <span style="font-size:13px;font-weight:600${low ? ';color:var(--p)' : ''}"${low ? ' aria-label="Protein thấp" title="Dưới 0,25 g/kg"' : ''}>${fmt(v)}g${low ? ' ↓' : ''}</span>
          </div>
        </div>`;
  }).join('');

  $('meal-list').innerHTML = SLOTS.map(s => {
    const g = todayLogs.filter(l => l.mealSlot === s.id);
    const sum = bySlot[s.id];
    const items = g.map((l, k) => {
      const sel = l.id === state.selectedLogId;
      return `<div data-log-id="${esc(l.id)}" style="display:flex;align-items:center;gap:12px;min-height:58px;padding:10px 16px;border-top:${k ? '1px solid var(--line)' : '0'};background:${l.id === state.newId ? 'var(--accsoft)' : 'transparent'};transition:background 1.2s;cursor:pointer">
              <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
                <span style="font-size:15px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(l.name)}</span>
                <span style="font-size:13px;color:var(--text3)">${esc(l.servings === 1 ? l.servingLabel : `${multLabel(l.servings)} ${l.servingLabel}`)}</span>
              </div>
              ${sel
                ? `<button data-del-log="${esc(l.id)}" style="min-height:40px;padding:0 14px;border:0;border-radius:12px;background:var(--surface2);color:var(--p);font-size:15px;font-weight:700;cursor:pointer">Xoá</button>`
                : `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">
                <span style="font-size:15px;font-weight:600">${fmt(l.kcal)} <span style="font-size:12px;font-weight:400;color:var(--text3)">kcal</span></span>
                <span style="font-size:12px;color:var(--p);font-weight:600">${fmt(l.protein)}g protein</span>
              </div>`}
            </div>`;
    }).join('');
    const empty = g.length ? '' : `<button data-add-slot="${s.id}" style="width:100%;min-height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:none;border:0;cursor:pointer;color:var(--text3);font-size:15px">
              <span>Chưa có món</span>
              <span style="display:flex;align-items:center;gap:6px;color:var(--acc);font-weight:600">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="stroke-width:2.4px;stroke-linecap:round"><path d="M12 5v14M5 12h14"></path></svg>Thêm
              </span>
            </button>`;
    return `<div data-meal-slot="${s.id}" style="display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;padding:0 4px">
          <span style="font-size:17px;font-weight:700">${s.label}</span>
          <span style="font-size:13px;color:var(--text3)">${g.length ? `${fmt(sum.kcal)} kcal · ${fmt(sum.protein)}g P` : ''}</span>
        </div>
        <div style="background:var(--surface);border-radius:18px;overflow:hidden">${items}${empty}</div>
      </div>`;
  }).join('');

  if (state.newId) {
    const id = state.newId;
    state.newId = null;
    requestAnimationFrame(() => setTimeout(() => {
      const row = document.querySelector(`[data-log-id="${CSS.escape(id)}"]`);
      if (row) row.style.background = 'transparent';
    }, 600));
  }
}

// ---------- render: weight ----------
function buildChart(weights, today, rangeWeeks) {
  const start = addDays(today, -(rangeWeeks * 7) + 1);
  const span = daysBetween(start, today);
  const pts = weights.filter(w => w.date >= start && w.date <= today).sort((a, b) => (a.date < b.date ? -1 : 1));
  const mas = avgSeries(weights, start, today);
  if (!pts.length) {
    return `<div style="height:190px;display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--text3);text-align:center;padding:0 24px">Chưa có dữ liệu cân nặng trong ${rangeWeeks} tuần qua</div>`;
  }
  const all = pts.map(p => p.kg).concat(mas.map(m => m.kg));
  const lo = Math.floor((Math.min(...all) - 0.2) * 2) / 2, hi = Math.ceil((Math.max(...all) + 0.2) * 2) / 2;
  const top = 8, bot = 170;
  const X = date => (daysBetween(start, date) / span) * W_PLOT;
  const Y = kg => bot - ((kg - lo) / (hi - lo)) * (bot - top);
  const grid = [0, 1, 2, 3].map(k => { const v = lo + (hi - lo) * k / 3; return { y: Y(v), label: fmt1(v) }; });
  const xl = [0, 1, 2, 3].map(k => {
    const date = addDays(start, Math.round(span * k / 3));
    const [, m, dd] = date.split('-').map(Number);
    return { x: X(date), label: `${dd}/${m}`, anchor: k === 0 ? 'start' : k === 3 ? 'end' : 'middle' };
  });
  const path = mas.map((m, i) => (i ? 'L' : 'M') + X(m.date).toFixed(1) + ' ' + Y(m.kg).toFixed(1)).join(' ');
  const last = mas[mas.length - 1];
  return `<svg viewBox="0 0 342 190" style="width:100%;height:auto;display:block;overflow:visible">
    ${grid.map(g => `<g><line x1="0" x2="${W_PLOT}" y1="${g.y}" y2="${g.y}" stroke="var(--line)" stroke-width="1"></line><text x="342" y="${g.y + 3.5}" text-anchor="end" fill="var(--text3)" font-size="10.5">${g.label}</text></g>`).join('')}
    ${xl.map(x => `<text x="${x.x}" y="188" text-anchor="${x.anchor}" fill="var(--text3)" font-size="10.5">${x.label}</text>`).join('')}
    ${pts.map(p => `<circle cx="${X(p.date)}" cy="${Y(p.kg)}" r="2.6" fill="var(--text3)" opacity="0.7"></circle>`).join('')}
    ${path ? `<path d="${path}" fill="none" stroke="var(--acc)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>` : ''}
    ${last ? `<circle cx="${X(last.date)}" cy="${Y(last.kg)}" r="5" fill="var(--acc)" stroke="var(--surface)" stroke-width="2.5"></circle>` : ''}
  </svg>`;
}

const NOTES = {
  ok: 'Đang tăng đúng nhịp lean bulk. Giữ nguyên mức calo hiện tại.',
  slow: 'Tăng chậm hơn mục tiêu — cân nhắc thêm ~150 kcal/ngày.',
  fast: 'Tăng nhanh hơn mục tiêu — cân nhắc giảm ~150 kcal/ngày.',
  none: 'Cần ít nhất 3 lần cân mỗi tuần trong 2 tuần liên tiếp để tính thay đổi. Cân buổi sáng, sau khi đi vệ sinh, trước khi ăn.'
};

function renderWeight(d) {
  const { today, weights } = state;
  const todayEntry = weights.find(w => w.date === today);
  const a7 = avg7(weights, today);
  const weekly = weeklyChange(weights, today);
  const goal = weeklyGoal(a7 ?? d.kg, state.profile?.goalRate ?? 0.005);
  $('weight-subtitle').textContent = todayEntry ? 'ĐÃ CÂN HÔM NAY' : 'CHƯA CÂN HÔM NAY';
  const dayLabel = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: TZ });
  $('weight-status').textContent = state.weightSaved ? 'Đã lưu' : dayLabel;
  $('weight-status').style.color = state.weightSaved ? 'var(--acc)' : 'var(--text3)';
  setIfIdle($('weight-input'), state.weightInput);
  $('weight-save').textContent = state.weightSaved ? 'Đã lưu ✓' : todayEntry ? 'Cập nhật' : 'Lưu cân nặng';
  setSeg('range-select', v => Number(v) === state.range);
  $('weight-chart').innerHTML = buildChart(weights, today, state.range);
  setLead('stat-avg7', a7 == null ? '—' : fmt1(a7));
  setLead('stat-weekly', weekly == null ? '—' : signed1(weekly));
  setLead('stat-goal', goal == null ? '—' : '+' + fmt1(goal));
  $('weight-note').textContent = NOTES[weightAdvice(weekly, goal) || 'none'];
}

// ---------- render: settings ----------
function renderSettings(d) {
  const p = state.profile || {};
  for (const k of ['age', 'heightCm', 'trainingDays']) setIfIdle($('in-' + k), p[k] ?? '');
  const lw = latestWeight(state.weights, state.today);
  setIfIdle($('in-weightKg'), lw ? fmt1(lw.kg) : '');
  setSeg('surplus-select', v => Number(v) === p.surplus, true);
  setSeg('goal-rate-select', v => Math.abs(Number(v) - (p.goalRate ?? 0.005)) < 1e-9, true);
  const T = d.targets;
  setLead('out-target-kcal', T ? fmt(T.kcal) : '—');
  $('out-bmr').textContent = T ? fmt(T.bmr) : '—';
  $('out-tdee').textContent = T ? fmt(T.tdee) : '—';
  setLead('out-protein', T ? fmt(T.protein) : '—');
  setLead('out-carb', T ? fmt(T.carb) : '—');
  setLead('out-fat', T ? fmt(T.fat) : '—');
  const a7 = avg7(state.weights, state.today);
  $('result-note').textContent = !T ? 'Nhập cân nặng để tính mục tiêu'
    : a7 != null ? `Mifflin-St Jeor · theo cân nặng TB 7 ngày ${fmt1(a7)} kg`
    : `Mifflin-St Jeor · theo lần cân gần nhất ${fmt1(d.kg)} kg`;
  setSeg('theme-select', v => v === state.theme);
  setSeg('rest-select', v => Number(v) === (p.restSec ?? 90), true);
  setSeg('increment-select', v => Number(v) === (p.increment ?? 2.5), true);
  const pi = state.pendingImport;
  $('import-confirm').hidden = !pi;
  if (pi) {
    const c = pi.counts;
    const training = c.workouts != null ? ` · ${c.workouts} buổi tập · ${c.templates} mẫu · ${c.exercises} bài tự tạo` : '';
    $('import-summary').textContent = `${pi.fileName}: ${c.weights} lần cân · ${c.foodLogs} món đã ghi · ${c.foods} món tự tạo${training} · ${c.profile ? 'có' : 'không có'} hồ sơ. `
      + (c.workouts != null ? 'Toàn bộ dữ liệu hiện tại sẽ bị thay thế.' : 'Dữ liệu ăn uống và cân nặng sẽ bị thay thế; dữ liệu tập luyện giữ nguyên.');
  }
}

// ---------- render: sheet ----------
function renderSheet() {
  const open = state.sheetOpen;
  $('sheet-add').style.transform = open ? 'translateY(0)' : 'translateY(105%)';
  $('sheet-scrim').style.opacity = open ? 1 : 0;
  $('sheet-scrim').style.pointerEvents = open ? 'auto' : 'none';
  $('sheet-add').setAttribute('aria-hidden', !open);

  const editing = state.editingFood;
  $('sheet-title').textContent = editing ? (editing.id ? 'Sửa món' : 'Món mới') : 'Thêm món';
  $('sheet-search').hidden = $('sheet-list').hidden = $('sheet-footer').hidden = !!editing;
  $('food-form').hidden = !editing;
  if (editing) return;

  setIfIdle($('food-search'), state.query);
  const q = state.query.trim();
  const results = searchFoods(state.foods.slice().sort(sortVi), q);
  $('list-title').textContent = q ? `KẾT QUẢ (${results.length})` : 'TẤT CẢ MÓN';
  const rows = results.map((f, i) => {
    const meta = `${esc(f.servingLabel)} · ${fmt(f.kcal)} kcal · ${fmt(f.protein)}g P${f.isCustom ? ' · Tự tạo' : ''}`;
    const btn = `<button data-food-id="${esc(f.id)}" style="width:100%;flex:1;min-width:0;display:flex;align-items:center;gap:12px;min-height:56px;padding:8px 10px 8px 14px;background:none;border:0;border-top:${i && !f.isCustom ? '1px solid var(--line)' : '0'};cursor:pointer;text-align:left">
          <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
            <span style="font-size:15px;font-weight:500">${esc(f.name)}</span>
            <span style="font-size:12px;color:var(--text3)">${meta}</span>
          </span>
          <span style="width:32px;height:32px;flex:none;border-radius:16px;background:var(--accsoft);color:var(--acc);display:flex;align-items:center;justify-content:center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="stroke-width:2.6px;stroke-linecap:round"><path d="M12 5v14M5 12h14"></path></svg>
          </span>
        </button>`;
    if (!f.isCustom) return btn;
    return `<div style="display:flex;align-items:center;border-top:${i ? '1px solid var(--line)' : '0'}">${btn}
        <button data-edit-food="${esc(f.id)}" aria-label="Sửa ${esc(f.name)}" style="min-height:56px;padding:0 14px 0 4px;border:0;background:none;color:var(--text3);font-size:13px;font-weight:600;cursor:pointer">Sửa</button></div>`;
  }).join('');
  const none = results.length ? '' : `<div style="padding:18px 16px;font-size:14px;color:var(--text3)">Không tìm thấy món phù hợp</div>`;
  const create = `<button id="btn-new-food" style="width:100%;min-height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:none;border:0;border-top:1px solid var(--line);cursor:pointer;color:var(--text3);font-size:15px">
          <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${q ? `Tạo “${esc(q)}”` : 'Tạo món mới'}</span>
          <span style="display:flex;align-items:center;gap:6px;color:var(--acc);font-weight:600;flex:none">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="stroke-width:2.4px;stroke-linecap:round"><path d="M12 5v14M5 12h14"></path></svg>Thêm
          </span>
        </button>`;
  $('food-results').innerHTML = rows + none + create;

  const byId = new Map(state.foods.map(f => [f.id, f]));
  const ids = topFoods(state.logs, state.today).filter(id => byId.has(id));
  for (const id of DEFAULT_CHIPS) { if (ids.length >= 8) break; if (byId.has(id) && !ids.includes(id)) ids.push(id); }
  $('quick-chips').innerHTML = ids.map(id => {
    const f = byId.get(id);
    return `<button data-food-id="${esc(f.id)}" style="min-height:44px;padding:6px 14px;border-radius:14px;border:1px solid var(--line);background:var(--surface);cursor:pointer;display:flex;flex-direction:column;align-items:flex-start;gap:1px;text-align:left">
            <span style="font-size:14px;font-weight:600">${esc(f.name)}</span>
            <span style="font-size:11px;color:var(--text3)">${fmt(f.kcal * state.mult)} kcal · <span style="color:var(--p)">${fmt(f.protein * state.mult)}g P</span></span>
          </button>`;
  }).join('');
  setSeg('slot-select', v => v === state.slot);
  setSeg('serving-select', v => Number(v) === state.mult);
}

function renderTabs() {
  for (const t of ['today', 'weight', 'workout', 'settings']) {
    $('screen-' + t).hidden = state.tab !== t;
    document.querySelector(`[data-tab="${t}"]`).style.color = state.tab === t ? 'var(--acc)' : 'var(--text3)';
  }
}

function applyTheme() {
  $('root').dataset.theme = state.theme;
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.content = THEME_COLORS[state.theme];
}

export function render() {
  const d = derived();
  applyTheme();
  renderTabs();
  renderToday(d);
  renderWeight(d);
  renderSettings(d);
  renderSheet();
  workout.render();
}

// ---------- actions ----------
async function reload() {
  [state.profile, state.weights, state.foods, state.logs] = await Promise.all([db.getProfile(), db.getWeights(), db.getFoods(), db.getFoodLogs()]);
}

function openSheet(slot) {
  if (slot) state.slot = slot;
  state.sheetOpen = true;
  state.editingFood = null;
  renderSheet();
}
function closeSheet() {
  state.sheetOpen = false;
  state.editingFood = null;
  state.query = '';
  $('food-search').value = '';
  document.activeElement?.blur?.();
  renderSheet();
}

async function addFood(foodId) {
  const f = state.foods.find(x => x.id === foodId);
  if (!f) return;
  const log = { id: db.newId(), date: localDate(new Date()), mealSlot: state.slot, foodId: f.id, servings: state.mult, createdAt: Date.now(), ...snapshotFor(f, state.mult) };
  await db.saveFoodLog(log);
  state.logs.push(log);
  state.today = log.date;
  state.newId = log.id;
  state.tab = 'today';
  closeSheet();
  render();
  showToast(`${f.name} · ${slotLabel(log.mealSlot)} · ${multLabel(log.servings)}`, async () => {
    await db.deleteFoodLog(log.id);
    state.logs = state.logs.filter(l => l.id !== log.id);
    render();
  });
}

async function deleteLog(id) {
  const log = state.logs.find(l => l.id === id);
  if (!log) return;
  await db.deleteFoodLog(id);
  state.logs = state.logs.filter(l => l.id !== id);
  state.selectedLogId = null;
  render();
  showToast(`Đã xoá ${log.name}`, async () => {
    await db.saveFoodLog(log);
    state.logs.push(log);
    render();
  });
}

async function saveWeightFor(kg) {
  const date = localDate(new Date());
  await db.saveWeight(date, kg);
  state.weights = state.weights.filter(w => w.date !== date).concat({ date, kg });
  state.today = date;
}

async function updateProfile(patch) {
  state.profile = { ...state.profile, ...patch };
  await db.saveProfile(state.profile);
  render();
}

function openFoodForm(food) {
  state.editingFood = food || {};
  state.deleteArmed = false;
  const form = $('food-form');
  const f = food || { name: state.query.trim(), servingLabel: '', kcal: '', protein: '', carb: '', fat: '' };
  form.elements.name.value = f.name;
  form.elements.servingLabel.value = f.servingLabel;
  for (const k of ['protein', 'carb', 'fat', 'kcal']) form.elements[k].value = f[k] === '' ? '' : String(f[k]).replace('.', ',');
  $('food-form-error').hidden = true;
  $('food-form-delete').hidden = !food;
  $('food-form-delete').textContent = 'Xoá món';
  renderSheet();
}

async function submitFoodForm(e) {
  e.preventDefault();
  const el = $('food-form').elements;
  const name = el.name.value.trim();
  const num = k => { const v = el[k].value.trim(); return v === '' ? 0 : parseNum(v); };
  const protein = num('protein'), carb = num('carb'), fat = num('fat');
  let kcal = el.kcal.value.trim() === '' ? null : parseNum(el.kcal.value);
  const err = !name ? 'Nhập tên món' : [protein, carb, fat].some(v => v == null || v < 0) || (kcal != null && !(kcal >= 0)) || (el.kcal.value.trim() !== '' && kcal == null) ? 'Số liệu không hợp lệ' : null;
  if (err) { $('food-form-error').textContent = err; $('food-form-error').hidden = false; return; }
  if (kcal == null) kcal = protein * 4 + carb * 4 + fat * 9;
  const prev = state.editingFood;
  const food = { id: prev.id || db.newId(), name, servingLabel: el.servingLabel.value.trim() || '1 phần', kcal, protein, carb, fat, isCustom: true, isEstimate: false };
  await db.saveFood(food);
  state.foods = state.foods.filter(f => f.id !== food.id).concat(food);
  state.editingFood = null;
  state.query = prev.id ? state.query : food.name;
  $('food-search').value = state.query;
  renderSheet();
  showToast(prev.id ? `Đã cập nhật ${food.name}` : `Đã tạo ${food.name} · chạm vào món để thêm`);
}

async function deleteFoodFromForm() {
  if (!state.deleteArmed) { state.deleteArmed = true; $('food-form-delete').textContent = 'Chạm lần nữa để xoá'; return; }
  const food = state.editingFood;
  await db.deleteFood(food.id);
  state.foods = state.foods.filter(f => f.id !== food.id);
  state.editingFood = null;
  renderSheet();
  showToast(`Đã xoá ${food.name}`, async () => {
    await db.saveFood(food);
    state.foods.push(food);
    renderSheet();
  });
}

async function exportJSON() {
  const data = await db.exportData();
  const name = `len-can-${localDate(new Date())}.json`;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      showToast('Đã xuất dữ liệu JSON');
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showToast('Đã xuất dữ liệu JSON');
}

async function onImportFile(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { showToast('File không phải JSON hợp lệ'); return; }
  const v = validateBackup(data);
  if (!v.ok) { showToast('File không hợp lệ: ' + v.errors[0]); return; }
  state.pendingImport = { data, counts: v.counts, fileName: file.name };
  render();
  const sc = $('scroll'), box = $('import-confirm').getBoundingClientRect();
  sc.scrollTo({ top: sc.scrollTop + box.top - sc.getBoundingClientRect().top - 120, behavior: 'smooth' });
}

async function applyImport() {
  const pi = state.pendingImport;
  if (!pi) return;
  await db.importData(pi.data);
  await db.ensureSeed();
  await reload();
  if (!state.profile) {
    state.profile = { ...DEFAULT_PROFILE, createdAt: Date.now(), templatesSeeded: true };
    await db.saveProfile(state.profile);
  }
  state.pendingImport = null;
  state.weightInput = initialWeightInput();
  await workout.reload();
  render();
  showToast(`Đã nhập ${pi.counts.foodLogs} món · ${pi.counts.weights} lần cân`);
}

function initialWeightInput() {
  const lw = latestWeight(state.weights, state.today);
  return lw ? fmt1(lw.kg) : '';
}

/** Re-check date when the app returns to foreground (may have crossed midnight). */
export function refreshDay() {
  const t = localDate(new Date());
  if (t !== state.today) {
    state.today = t;
    state.slot = defaultSlot(localHour(new Date()));
    state.weightSaved = false;
    state.weightInput = initialWeightInput();
  }
  render();
}

// ---------- wiring ----------
export function init(data, { theme, training }) {
  Object.assign(state, data);
  workout.init(training, { getProfile: () => state.profile, getToday: () => state.today, setTab: t => { state.tab = t; render(); } });
  state.theme = theme;
  state.weightInput = initialWeightInput();

  for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => {
    if (b.disabled) return;
    state.tab = b.dataset.tab;
    state.selectedLogId = null;
    render();
    $('scroll').scrollTop = 0;
  });
  $('fab-add').addEventListener('click', () => openSheet());
  // #app is overflow:hidden but can still be scrolled by focus/keyboard (iOS); keep it pinned.
  $('app').addEventListener('scroll', () => { if ($('app').scrollTop) $('app').scrollTop = 0; });
  $('sheet-done').addEventListener('click', closeSheet);
  $('sheet-scrim').addEventListener('click', closeSheet);

  // Today: meal list (event delegation)
  $('meal-list').addEventListener('click', e => {
    const add = e.target.closest('[data-add-slot]');
    if (add) return openSheet(add.dataset.addSlot);
    const del = e.target.closest('[data-del-log]');
    if (del) return deleteLog(del.dataset.delLog);
    const row = e.target.closest('[data-log-id]');
    if (row) { state.selectedLogId = state.selectedLogId === row.dataset.logId ? null : row.dataset.logId; renderToday(derived()); }
  });

  // Weight
  const parseInput = () => parseNum(state.weightInput) || 0;
  const bump = delta => { const base = parseInput() || calcWeight(state.weights, state.today) || 60; state.weightInput = fmt1(base + delta); state.weightSaved = false; $('weight-input').value = state.weightInput; render(); };
  $('weight-dec').addEventListener('click', () => bump(-0.1));
  $('weight-inc').addEventListener('click', () => bump(0.1));
  $('weight-input').addEventListener('input', e => { state.weightInput = e.target.value; state.weightSaved = false; $('weight-save').textContent = state.weights.some(w => w.date === state.today) ? 'Cập nhật' : 'Lưu cân nặng'; $('weight-status').textContent = ''; });
  $('weight-save').addEventListener('click', async () => {
    const kg = parseInput();
    if (!(kg >= 25 && kg <= 300)) { showToast('Cân nặng không hợp lệ'); return; }
    await saveWeightFor(Math.round(kg * 10) / 10);
    state.weightInput = fmt1(kg);
    state.weightSaved = true;
    $('weight-input').blur();
    render();
    showToast(`Đã lưu ${fmt1(kg)} kg`);
  });
  $('range-select').addEventListener('click', e => { const b = e.target.closest('button[data-value]'); if (b) { state.range = Number(b.dataset.value); renderWeight(derived()); } });

  // Settings
  const LIMITS = { age: [13, 90], heightCm: [120, 230], trainingDays: [0, 7] };
  for (const [k, [min, max]] of Object.entries(LIMITS)) {
    $('in-' + k).addEventListener('input', e => {
      const v = parseNum(e.target.value);
      if (v == null || v < min || v > max) return;
      updateProfile({ [k]: k === 'heightCm' ? v : Math.round(v) });
    });
    $('in-' + k).addEventListener('blur', () => renderSettings(derived()));
  }
  $('in-weightKg').addEventListener('change', async e => {
    const kg = parseNum(e.target.value);
    if (!(kg >= 25 && kg <= 300)) { showToast('Cân nặng không hợp lệ'); renderSettings(derived()); return; }
    await saveWeightFor(Math.round(kg * 10) / 10);
    state.weightInput = fmt1(kg);
    render();
    showToast(`Đã lưu ${fmt1(kg)} kg cho hôm nay`);
  });
  $('surplus-select').addEventListener('click', e => { const b = e.target.closest('button[data-value]'); if (b) updateProfile({ surplus: Number(b.dataset.value) }); });
  $('rest-select').addEventListener('click', e => { const b = e.target.closest('button[data-value]'); if (b) updateProfile({ restSec: Number(b.dataset.value) }); });
  $('increment-select').addEventListener('click', e => { const b = e.target.closest('button[data-value]'); if (b) updateProfile({ increment: Number(b.dataset.value) }); });
  $('goal-rate-select').addEventListener('click', e => { const b = e.target.closest('button[data-value]'); if (b) updateProfile({ goalRate: Number(b.dataset.value) }); });
  $('theme-select').addEventListener('click', e => {
    const b = e.target.closest('button[data-value]');
    if (!b) return;
    state.theme = b.dataset.value;
    try { localStorage.setItem('theme', state.theme); } catch {}
    render();
  });
  $('btn-export').addEventListener('click', () => exportJSON().catch(err => showToast('Lỗi export: ' + err.message)));
  $('btn-import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', onImportFile);
  $('import-cancel').addEventListener('click', () => { state.pendingImport = null; render(); });
  $('import-apply').addEventListener('click', () => applyImport().catch(err => showToast('Lỗi import: ' + err.message)));

  // Sheet
  $('food-search').addEventListener('input', e => { state.query = e.target.value; renderSheet(); });
  $('food-results').addEventListener('click', e => {
    const edit = e.target.closest('[data-edit-food]');
    if (edit) return openFoodForm(state.foods.find(f => f.id === edit.dataset.editFood));
    if (e.target.closest('#btn-new-food')) return openFoodForm(null);
    const b = e.target.closest('[data-food-id]');
    if (b) addFood(b.dataset.foodId);
  });
  $('quick-chips').addEventListener('click', e => { const b = e.target.closest('[data-food-id]'); if (b) addFood(b.dataset.foodId); });
  $('slot-select').addEventListener('click', e => { const b = e.target.closest('button[data-value]'); if (b) { state.slot = b.dataset.value; renderSheet(); } });
  $('serving-select').addEventListener('click', e => { const b = e.target.closest('button[data-value]'); if (b) { state.mult = Number(b.dataset.value); renderSheet(); } });
  $('food-form').addEventListener('submit', e => submitFoodForm(e).catch(err => showToast('Lỗi: ' + err.message)));
  $('food-form-cancel').addEventListener('click', () => { state.editingFood = null; renderSheet(); });
  $('food-form-delete').addEventListener('click', () => deleteFoodFromForm().catch(err => showToast('Lỗi: ' + err.message)));

  initToast();

  render();
}

