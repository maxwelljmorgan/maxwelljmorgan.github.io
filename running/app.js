/* ============================================================
   Stride — Running Training Tracker
   Vanilla JS. Persists to localStorage. Charts via Chart.js.
   ============================================================ */

/* ---------- pdf.js setup (loaded as module from CDN) ---------- */
let pdfjsLib = null;
import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs')
    .then((m) => {
        pdfjsLib = m;
        pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';
    })
    .catch(() => { /* PDF upload will warn if used before ready */ });

/* ====================== Storage keys ====================== */
const K_PLAN = 'stride_plan_v1';
const K_LOGS = 'stride_logs_v1';
const K_SETTINGS = 'stride_settings_v1';

/* ====================== Helpers ====================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
}
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), 2400);
}

/* ---- Dates (work in local time, ISO yyyy-mm-dd keys) ---- */
function todayISO() { return toISO(new Date()); }
function toISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fromISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function mondayOf(d) {
    // returns Monday (local) of the week containing d
    const x = new Date(d);
    const dow = (x.getDay() + 6) % 7; // Mon=0 .. Sun=6
    return addDays(x, -dow);
}
function fmtShort(d) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function daysBetween(a, b) { return Math.round((fromISO(b) - fromISO(a)) / 86400000); }

/* ---- Pace / time ---- */
function hmsToSec(h, m, s) { return (h || 0) * 3600 + (m || 0) * 60 + (s || 0); }
function parseTimeStr(str) {
    if (!str) return 0;
    const p = str.split(':').map(Number);
    if (p.length === 3) return hmsToSec(p[0], p[1], p[2]);
    if (p.length === 2) return hmsToSec(0, p[0], p[1]);
    return Number(str) || 0;
}
function secToHMS(sec) {
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function paceStr(secPerMile) {
    if (!isFinite(secPerMile) || secPerMile <= 0) return '—';
    const m = Math.floor(secPerMile / 60), s = Math.round(secPerMile % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}
function parsePace(str) {
    if (!str) return 0;
    const p = str.split(':').map(Number);
    if (p.length === 2) return p[0] * 60 + p[1];
    return Number(str) * 60 || 0;
}

/* ====================== Built-in plan template ======================
   Anchored to race date. The race is in the LAST week. Each template
   week is offset back in 7-day steps from the race week's Monday.
   Day "wd" maps to Mon..Sun. dist is planned miles (0 = rest/cross).
   type: easy | long | tempo | intervals | threshold | sharpen | cross | rest | race
==================================================================== */
function dayQuality(type) { return ['tempo', 'intervals', 'threshold', 'sharpen'].includes(type); }
function isRunType(type) { return !['rest', 'cross'].includes(type); }

const BUILTIN_TEMPLATE = [
    { name: 'Kickoff', phase: 'On-ramp', focus: 'Start today, ease in', target: 17, days: [
        { wd: 'Wed', type: 'easy', label: 'Easy', dist: 4, pace: '7:30' },
        { wd: 'Thu', type: 'easy', label: 'Easy', dist: 4, pace: '7:30' },
        { wd: 'Fri', type: 'cross', label: 'Cross-train (or rest) 30–40 min', dist: 0, pace: '' },
        { wd: 'Sat', type: 'easy', label: 'Easy + 4 strides', dist: 3, pace: '7:30' },
        { wd: 'Sun', type: 'long', label: 'Easy long', dist: 6, pace: '7:40' },
    ]},
    { name: 'Week 1', phase: 'Base Building', focus: 'Establish routine', target: 26, days: [
        { wd: 'Mon', type: 'rest', label: 'Rest', dist: 0, pace: '' },
        { wd: 'Tue', type: 'easy', label: 'Easy', dist: 5, pace: '7:30' },
        { wd: 'Wed', type: 'easy', label: 'Easy', dist: 6, pace: '7:30' },
        { wd: 'Thu', type: 'easy', label: 'Easy', dist: 4, pace: '7:30' },
        { wd: 'Fri', type: 'cross', label: 'Cross-train 40 min', dist: 0, pace: '' },
        { wd: 'Sat', type: 'easy', label: 'Easy + 4 strides', dist: 3, pace: '7:30' },
        { wd: 'Sun', type: 'long', label: 'Long run', dist: 8, pace: '7:40' },
    ]},
    { name: 'Week 2', phase: 'Base Building', focus: 'Build aerobic base', target: 28, days: [
        { wd: 'Mon', type: 'rest', label: 'Rest', dist: 0, pace: '' },
        { wd: 'Tue', type: 'easy', label: 'Easy', dist: 5, pace: '7:28' },
        { wd: 'Wed', type: 'easy', label: 'Easy', dist: 6, pace: '7:28' },
        { wd: 'Thu', type: 'easy', label: 'Easy', dist: 5, pace: '7:28' },
        { wd: 'Fri', type: 'cross', label: 'Cross-train 40 min', dist: 0, pace: '' },
        { wd: 'Sat', type: 'easy', label: 'Easy + 4 strides', dist: 3, pace: '7:28' },
        { wd: 'Sun', type: 'long', label: 'Long run', dist: 9, pace: '7:38' },
    ]},
    { name: 'Week 3', phase: 'Base Building', focus: 'Base block peak', target: 31, days: [
        { wd: 'Mon', type: 'rest', label: 'Rest', dist: 0, pace: '' },
        { wd: 'Tue', type: 'easy', label: 'Easy', dist: 6, pace: '7:26' },
        { wd: 'Wed', type: 'easy', label: 'Easy', dist: 6, pace: '7:26' },
        { wd: 'Thu', type: 'easy', label: 'Easy', dist: 5, pace: '7:26' },
        { wd: 'Fri', type: 'cross', label: 'Cross-train 40 min', dist: 0, pace: '' },
        { wd: 'Sat', type: 'easy', label: 'Easy + 6 strides', dist: 4, pace: '7:26' },
        { wd: 'Sun', type: 'long', label: 'Long run', dist: 10, pace: '7:36' },
    ]},
    { name: 'Week 4', phase: 'Base Building', focus: 'Recovery / cutback', target: 26, days: [
        { wd: 'Mon', type: 'rest', label: 'Rest', dist: 0, pace: '' },
        { wd: 'Tue', type: 'easy', label: 'Easy', dist: 5, pace: '7:24' },
        { wd: 'Wed', type: 'easy', label: 'Easy', dist: 5, pace: '7:24' },
        { wd: 'Thu', type: 'easy', label: 'Easy', dist: 4, pace: '7:24' },
        { wd: 'Fri', type: 'cross', label: 'Cross-train (easy)', dist: 0, pace: '' },
        { wd: 'Sat', type: 'easy', label: 'Easy + strides', dist: 4, pace: '7:24' },
        { wd: 'Sun', type: 'long', label: 'Long run', dist: 8, pace: '7:34' },
    ]},
    { name: 'Week 5', phase: 'Threshold', focus: 'Introduce tempo', target: 32, days: [
        { wd: 'Mon', type: 'rest', label: 'Rest', dist: 0, pace: '' },
        { wd: 'Tue', type: 'tempo', label: 'Tempo: 2 WU / 4 @ 6:50 / 1 CD', dist: 7, pace: '6:50' },
        { wd: 'Wed', type: 'easy', label: 'Easy', dist: 6, pace: '7:22' },
        { wd: 'Thu', type: 'easy', label: 'Easy', dist: 5, pace: '7:22' },
        { wd: 'Fri', type: 'cross', label: 'Cross-train 40 min', dist: 0, pace: '' },
        { wd: 'Sat', type: 'easy', label: 'Easy + strides', dist: 4, pace: '7:22' },
        { wd: 'Sun', type: 'long', label: 'Long run', dist: 10, pace: '7:34' },
    ]},
    { name: 'Week 6', phase: 'Threshold', focus: 'Threshold development', target: 35, days: [
        { wd: 'Mon', type: 'rest', label: 'Rest', dist: 0, pace: '' },
        { wd: 'Tue', type: 'tempo', label: 'Tempo: 2 WU / 5 @ 6:48 / 1 CD', dist: 8, pace: '6:48' },
        { wd: 'Wed', type: 'easy', label: 'Easy', dist: 6, pace: '7:20' },
        { wd: 'Thu', type: 'easy', label: 'Easy', dist: 6, pace: '7:20' },
        { wd: 'Fri', type: 'cross', label: 'Cross-train 45 min', dist: 0, pace: '' },
        { wd: 'Sat', type: 'easy', label: 'Easy + 6 strides', dist: 4, pace: '7:20' },
        { wd: 'Sun', type: 'long', label: 'Long run', dist: 11, pace: '7:30' },
    ]},
    { name: 'Week 7', phase: 'Threshold', focus: 'Threshold development', target: 37, days: [
        { wd: 'Mon', type: 'rest', label: 'Rest', dist: 0, pace: '' },
        { wd: 'Tue', type: 'tempo', label: 'Tempo: 2 WU / 5 @ 6:45 / 1 CD', dist: 8, pace: '6:45' },
        { wd: 'Wed', type: 'easy', label: 'Easy', dist: 7, pace: '7:18' },
        { wd: 'Thu', type: 'easy', label: 'Easy', dist: 6, pace: '7:18' },
        { wd: 'Fri', type: 'cross', label: 'Cross-train 45 min', dist: 0, pace: '' },
        { wd: 'Sat', type: 'easy', label: 'Easy + strides', dist: 4, pace: '7:18' },
        { wd: 'Sun', type: 'long', label: 'Long run (last 3 @ GP)', dist: 12, pace: '7:28' },
    ]},
    { name: 'Week 8', phase: 'Threshold', focus: 'Recovery / cutback', target: 31, days: [
        { wd: 'Mon', type: 'rest', label: 'Rest', dist: 0, pace: '' },
        { wd: 'Tue', type: 'tempo', label: 'Tempo (light): 2 WU / 3 @ 6:48 / 1 CD', dist: 6, pace: '6:48' },
        { wd: 'Wed', type: 'easy', label: 'Easy', dist: 6, pace: '7:16' },
        { wd: 'Thu', type: 'easy', label: 'Easy', dist: 5, pace: '7:16' },
        { wd: 'Fri', type: 'cross', label: 'Cross-train (easy)', dist: 0, pace: '' },
        { wd: 'Sat', type: 'easy', label: 'Easy + strides', dist: 4, pace: '7:16' },
        { wd: 'Sun', type: 'long', label: 'Long run', dist: 10, pace: '7:28' },
    ]},
    { name: 'Week 9', phase: 'Speed + Strength', focus: 'Introduce intervals', target: 38, days: [
        { wd: 'Mon', type: 'rest', label: 'Rest', dist: 0, pace: '' },
        { wd: 'Tue', type: 'intervals', label: 'Intervals: 2 WU / 5×800m @ 6:12 (400 jog) / CD', dist: 8, pace: '6:12' },
        { wd: 'Wed', type: 'easy', label: 'Easy', dist: 6, pace: '7:14' },
        { wd: 'Thu', type: 'tempo', label: 'Tempo: 2 WU / 4 @ 6:45 / 1 CD', dist: 7, pace: '6:45' },
        { wd: 'Fri', type: 'cross', label: 'Cross-train 45 min', dist: 0, pace: '' },
        { wd: 'Sat', type: 'easy', label: 'Easy', dist: 5, pace: '7:14' },
        { wd: 'Sun', type: 'long', label: 'Long run (last 4 @ GP)', dist: 12, pace: '7:24' },
    ]},
    { name: 'Week 10', phase: 'Speed + Strength', focus: 'Build speed + threshold', target: 40, days: [
        { wd: 'Mon', type: 'rest', label: 'Rest', dist: 0, pace: '' },
        { wd: 'Tue', type: 'intervals', label: 'Intervals: 2 WU / 5×1000m @ 6:12 (400 jog) / CD', dist: 8, pace: '6:12' },
        { wd: 'Wed', type: 'easy', label: 'Easy', dist: 7, pace: '7:12' },
        { wd: 'Thu', type: 'tempo', label: 'Tempo: 2 WU / 4 @ 6:42 / 1 CD', dist: 7, pace: '6:42' },
        { wd: 'Fri', type: 'cross', label: 'Cross-train 45 min', dist: 0, pace: '' },
        { wd: 'Sat', type: 'easy', label: 'Easy', dist: 5, pace: '7:12' },
        { wd: 'Sun', type: 'long', label: 'Long run (last 5 @ GP)', dist: 13, pace: '7:22' },
    ]},
    { name: 'Week 11', phase: 'Speed + Strength', focus: 'Block peak', target: 42, days: [
        { wd: 'Mon', type: 'rest', label: 'Rest', dist: 0, pace: '' },
        { wd: 'Tue', type: 'intervals', label: 'Intervals: 2 WU / 4×1 mi @ 6:35 (3 min jog) / CD', dist: 8, pace: '6:35' },
        { wd: 'Wed', type: 'easy', label: 'Easy', dist: 7, pace: '7:10' },
        { wd: 'Thu', type: 'threshold', label: 'Threshold: 2 WU / 5 @ 6:40 / 1 CD', dist: 8, pace: '6:40' },
        { wd: 'Fri', type: 'cross', label: 'Cross-train 45 min', dist: 0, pace: '' },
        { wd: 'Sat', type: 'easy', label: 'Easy', dist: 6, pace: '7:10' },
        { wd: 'Sun', type: 'long', label: 'Long run (last 5 @ GP)', dist: 13, pace: '7:20' },
    ]},
    { name: 'Week 12', phase: 'Peak', focus: 'Peak volume + longest long run', target: 43, days: [
        { wd: 'Mon', type: 'rest', label: 'Rest', dist: 0, pace: '' },
        { wd: 'Tue', type: 'intervals', label: 'Intervals: 2 WU / 5×1000m @ 6:10 (400 jog) / CD', dist: 8, pace: '6:10' },
        { wd: 'Wed', type: 'easy', label: 'Easy', dist: 8, pace: '7:07' },
        { wd: 'Thu', type: 'threshold', label: 'Threshold: 2 WU / 5 @ 6:40 / 1 CD', dist: 8, pace: '6:40' },
        { wd: 'Fri', type: 'cross', label: 'Cross-train 45 min', dist: 0, pace: '' },
        { wd: 'Sat', type: 'easy', label: 'Easy', dist: 5, pace: '7:07' },
        { wd: 'Sun', type: 'long', label: 'Long run (last 6 @ GP)', dist: 14, pace: '7:15' },
    ]},
    { name: 'Week 13', phase: 'Taper', focus: 'Taper begins (~16% volume cut)', target: 36, days: [
        { wd: 'Mon', type: 'rest', label: 'Rest', dist: 0, pace: '' },
        { wd: 'Tue', type: 'intervals', label: 'Intervals (reduced): 2 WU / 4×1000m @ 6:12 (400 jog) / CD', dist: 7, pace: '6:12' },
        { wd: 'Wed', type: 'easy', label: 'Easy', dist: 6, pace: '7:05' },
        { wd: 'Thu', type: 'tempo', label: 'Tempo: 1 WU / 4 @ 6:42 / 1 CD', dist: 6, pace: '6:42' },
        { wd: 'Fri', type: 'cross', label: 'Cross-train 35 min', dist: 0, pace: '' },
        { wd: 'Sat', type: 'easy', label: 'Easy', dist: 5, pace: '7:05' },
        { wd: 'Sun', type: 'long', label: 'Long run (last 4 @ GP)', dist: 12, pace: '7:15' },
    ]},
    { name: 'Week 14', phase: 'Taper', focus: 'Sharpening taper', target: 26, days: [
        { wd: 'Mon', type: 'rest', label: 'Rest', dist: 0, pace: '' },
        { wd: 'Tue', type: 'sharpen', label: 'Sharpening: 2 WU / 4×600m @ 6:10 (400 jog) / CD', dist: 6, pace: '6:10' },
        { wd: 'Wed', type: 'easy', label: 'Easy', dist: 5, pace: '7:02' },
        { wd: 'Thu', type: 'easy', label: 'Easy + 4 strides', dist: 5, pace: '7:02' },
        { wd: 'Fri', type: 'cross', label: 'Cross-train 30 min', dist: 0, pace: '' },
        { wd: 'Sat', type: 'easy', label: 'Easy', dist: 4, pace: '7:02' },
        { wd: 'Sun', type: 'easy', label: 'Easy (relaxed)', dist: 6, pace: '7:05' },
    ]},
    { name: 'Week 15', phase: 'Race Week', focus: 'RACE WEEK', target: 20, days: [
        { wd: 'Mon', type: 'easy', label: 'Easy + 4 strides (shakeout)', dist: 4, pace: '7:00' },
        { wd: 'Tue', type: 'easy', label: 'Easy + 3×100m strides (primer)', dist: 3, pace: '7:00' },
        { wd: 'Wed', type: 'race', label: 'HALF MARATHON', dist: 13.1, pace: '7:00' },
        { wd: 'Thu', type: 'rest', label: 'Rest or 20-min walk', dist: 0, pace: '' },
        { wd: 'Fri', type: 'easy', label: 'Recovery jog or easy XT', dist: 3, pace: '' },
        { wd: 'Sat', type: 'rest', label: 'Rest', dist: 0, pace: '' },
        { wd: 'Sun', type: 'easy', label: 'Easy recovery', dist: 4, pace: '' },
    ]},
];

/* Build a full plan object anchored to a race date. */
function buildBuiltInPlan(raceDateISO, raceName) {
    const raceMonday = mondayOf(fromISO(raceDateISO));
    const N = BUILTIN_TEMPLATE.length;
    const weeks = BUILTIN_TEMPLATE.map((tpl, i) => {
        const weekMonday = addDays(raceMonday, -(N - 1 - i) * 7);
        return {
            name: tpl.name, phase: tpl.phase, focus: tpl.focus, target: tpl.target,
            monday: toISO(weekMonday),
            days: tpl.days.map((d) => ({ ...d })),
        };
    });
    return {
        source: 'builtin',
        raceName: raceName || 'Half Marathon',
        raceDate: raceDateISO,
        goalPace: '7:00',
        weeks,
    };
}

/* Re-anchor an existing (edited/pdf) plan to a (new) race date keeping content. */
function reanchorPlan(plan) {
    const raceMonday = mondayOf(fromISO(plan.raceDate));
    const N = plan.weeks.length;
    plan.weeks.forEach((w, i) => { w.monday = toISO(addDays(raceMonday, -(N - 1 - i) * 7)); });
    return plan;
}

/* ====================== State ====================== */
let plan = load(K_PLAN, null);
let logs = load(K_LOGS, {});          // { 'yyyy-mm-dd': {date,miles,timeSec,pace,wellness,notes} }
let settings = load(K_SETTINGS, { theme: 'dark' });
let editingDate = null;                // date currently loaded into form for edit
const charts = {};                     // Chart.js instances

/* ====================== Plan-derived helpers ====================== */
function dayDate(week, day) {
    const monday = fromISO(week.monday);
    return addDays(monday, WD.indexOf(day.wd));
}
function allPlanDays() {
    const out = [];
    if (!plan) return out;
    plan.weeks.forEach((w) => w.days.forEach((d) => out.push({ week: w, day: d, date: dayDate(w, d) })));
    return out;
}
function plannedForDate(iso) {
    return allPlanDays().find((x) => toISO(x.date) === iso) || null;
}
function currentWeekIndex() {
    if (!plan) return -1;
    const today = fromISO(todayISO());
    // week whose Mon..Sun contains today
    for (let i = 0; i < plan.weeks.length; i++) {
        const mon = fromISO(plan.weeks[i].monday);
        const sun = addDays(mon, 6);
        if (today >= mon && today <= sun) return i;
    }
    // before plan starts -> first week; after -> last
    const firstMon = fromISO(plan.weeks[0].monday);
    if (today < firstMon) return 0;
    return plan.weeks.length - 1;
}
function weekActualMiles(week) {
    let sum = 0;
    week.days.forEach((d) => {
        const e = logs[toISO(dayDate(week, d))];
        if (e) sum += e.miles || 0;
    });
    return sum;
}
function weekPlannedRunDays(week) { return week.days.filter((d) => isRunType(d.type) && d.dist > 0); }
function weekCompletedRunDays(week) {
    return weekPlannedRunDays(week).filter((d) => {
        const e = logs[toISO(dayDate(week, d))];
        return e && e.miles > 0;
    }).length;
}
function logsArray() {
    return Object.values(logs).sort((a, b) => a.date.localeCompare(b.date));
}

/* ====================== Navigation ====================== */
function switchView(view) {
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    $$('.bn-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    if (view === 'plan') renderPlan();
    if (view === 'log') renderLogList();
    if (view === 'analysis') renderAnalysis();
    if (view === 'insights') renderInsights();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
$$('.nav-item, .bn-item').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));

/* ====================== Theme ====================== */
function applyTheme() {
    document.documentElement.setAttribute('data-theme', settings.theme);
    const dark = settings.theme === 'dark';
    $$('.theme-ico').forEach((e) => e.textContent = dark ? '🌙' : '☀️');
    $$('.theme-label').forEach((e) => e.textContent = dark ? 'Dark' : 'Light');
}
function toggleTheme() {
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
    save(K_SETTINGS, settings);
    applyTheme();
    // re-render charts so they pick up theme colors
    if ($('#view-analysis').classList.contains('active')) renderAnalysis();
}
$('#themeToggle').addEventListener('click', toggleTheme);
$('#themeToggleMobile').addEventListener('click', toggleTheme);

/* ====================== TRAINING PLAN view ====================== */
function renderPlan() {
    if (!plan) return;
    const ci = currentWeekIndex();
    const raceD = fromISO(plan.raceDate);
    const today = fromISO(todayISO());
    const daysToRace = Math.max(0, Math.round((raceD - today) / 86400000));
    const weeksRemaining = Math.max(0, plan.weeks.length - 1 - ci);

    // Countdown stat cards
    $('#planStats').innerHTML = `
        <div class="stat accent">
            <div class="label">Race Day</div>
            <div class="value">${raceD.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
            <div class="sub">${raceD.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric' })}</div>
        </div>
        <div class="stat">
            <div class="label">Countdown</div>
            <div class="value">${daysToRace}<span style="font-size:14px;font-weight:600"> days</span></div>
            <div class="sub">${weeksRemaining} week${weeksRemaining === 1 ? '' : 's'} remaining</div>
        </div>
        <div class="stat">
            <div class="label">Current Week</div>
            <div class="value">${plan.weeks[ci].name.replace('Week ', 'W')}</div>
            <div class="sub">of ${plan.weeks.length} • ${plan.weeks[ci].phase}</div>
        </div>
        <div class="stat">
            <div class="label">Goal</div>
            <div class="value">${plan.goalPace || '—'}<span style="font-size:14px;font-weight:600">/mi</span></div>
            <div class="sub">${plan.raceName}</div>
        </div>`;

    // Source card
    const srcBadge = plan.source === 'pdf'
        ? '<span class="badge pdf">PDF Upload</span>'
        : plan.source === 'edited'
            ? '<span class="badge edited">Custom / Edited</span>'
            : '<span class="badge builtin">Built-in Plan</span>';
    $('#planSourceCard').innerHTML = `
        <div>${srcBadge} <strong style="margin-left:8px">${plan.raceName}</strong>
            <span class="muted"> — ${plan.weeks.length}-week schedule</span></div>
        <div class="muted">Volume periodized with cutback weeks &amp; a taper into race day.</div>`;

    // Current week highlight
    renderCurrentWeek(ci);

    // Accordion
    const acc = $('#planAccordion');
    acc.innerHTML = '';
    plan.weeks.forEach((w, i) => {
        const mon = fromISO(w.monday);
        const firstDay = dayDate(w, w.days[0]);
        const lastDay = dayDate(w, w.days[w.days.length - 1]);
        const actual = weekActualMiles(w);
        const item = document.createElement('div');
        item.className = 'acc-item' + (i === ci ? ' is-current open' : '');
        item.innerHTML = `
            <div class="acc-head">
                <span class="w-chev">▶</span>
                <span class="w-name">${w.name}${i === ci ? ' • now' : ''}</span>
                <span class="w-range">${fmtShort(firstDay)} – ${fmtShort(lastDay)} · ${w.phase}</span>
                <span class="w-target">${actual ? actual.toFixed(0) + '/' : ''}${w.target} mi</span>
            </div>
            <div class="acc-body">${dayGridHTML(w)}</div>`;
        item.querySelector('.acc-head').addEventListener('click', () => item.classList.toggle('open'));
        acc.appendChild(item);
    });
}

function dayGridHTML(week) {
    const todayI = todayISO();
    const rows = week.days.map((d) => {
        const date = dayDate(week, d);
        const iso = toISO(date);
        const e = logs[iso];
        const done = e && e.miles > 0;
        let tag = '';
        if (d.type === 'rest') tag = '<span class="tag rest">rest</span>';
        else if (d.type === 'long') tag = '<span class="tag long">long</span>';
        else if (dayQuality(d.type)) tag = '<span class="tag quality">quality</span>';
        else if (d.type === 'cross') tag = '<span class="tag cross">XT</span>';
        else if (d.type === 'race') tag = '<span class="tag race">race</span>';
        const distTxt = d.dist > 0 ? `${d.dist} mi` : (d.type === 'cross' ? 'XT' : '—');
        const actualTxt = done ? `<span style="color:var(--good)"> ✓ ${e.miles}mi</span>` : '';
        return `<div class="day-row ${done ? 'done' : ''} ${iso === todayI ? 'today' : ''}">
            <div><div class="d-day">${d.wd}</div><div class="d-date">${fmtShort(date)}</div></div>
            <div class="d-work">${d.label}${tag}${actualTxt}</div>
            <div class="d-dist">${distTxt}</div>
            <div class="d-pace">${d.pace || ''}</div>
        </div>`;
    }).join('');
    return `<div class="day-grid">${rows}</div>`;
}

function renderCurrentWeek(ci) {
    const w = plan.weeks[ci];
    const actual = weekActualMiles(w);
    const pct = w.target ? Math.min(100, (actual / w.target) * 100) : 0;
    const completed = weekCompletedRunDays(w);
    const planned = weekPlannedRunDays(w).length;
    $('#currentWeekWrap').innerHTML = `
        <div class="current-week-card">
            <div class="cw-head">
                <h3>${w.name} — ${w.phase}</h3>
                <span class="phase">${completed}/${planned} run days done</span>
            </div>
            <div class="cw-focus">Focus: ${w.focus}</div>
            <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600">
                <span>${actual.toFixed(1)} mi logged</span><span>${w.target} mi target</span>
            </div>
            <div class="cw-progress"><span style="width:${pct}%"></span></div>
            ${dayGridHTML(w)}
        </div>`;
}

/* ====================== DAILY LOG view ====================== */
function recalcPace() {
    const miles = parseFloat($('#logMiles').value) || 0;
    const sec = hmsToSec(+$('#logHrs').value, +$('#logMin').value, +$('#logSec').value);
    if (miles > 0 && sec > 0) {
        $('#logPace').value = paceStr(sec / miles);
        $('#logPace').dataset.auto = '1';
    }
}
['logMiles', 'logHrs', 'logMin', 'logSec'].forEach((id) =>
    $('#' + id).addEventListener('input', recalcPace));
$('#logPace').addEventListener('input', () => { $('#logPace').dataset.auto = '0'; });
$('#logWellness').addEventListener('input', (e) => { $('#wellnessOut').textContent = e.target.value; });

$('#logDate').addEventListener('change', () => updatePlannedHint($('#logDate').value));
function updatePlannedHint(iso) {
    const p = plannedForDate(iso);
    const hint = $('#plannedHint');
    if (p && p.day.dist > 0) {
        hint.textContent = `Planned: ${p.day.label} — ${p.day.dist} mi @ ${p.day.pace || 'easy'}`;
    } else if (p && p.day.type === 'rest') {
        hint.textContent = 'Planned: Rest day';
    } else if (p && p.day.type === 'cross') {
        hint.textContent = 'Planned: Cross-training';
    } else {
        hint.textContent = '';
    }
    // If editing existing, button text already set; otherwise load existing entry for this date
    if (logs[iso] && editingDate !== iso) loadEntryIntoForm(iso);
}

function loadEntryIntoForm(iso) {
    const e = logs[iso];
    editingDate = iso;
    $('#logDate').value = iso;
    $('#logMiles').value = e.miles || '';
    const sec = e.timeSec || 0;
    $('#logHrs').value = Math.floor(sec / 3600) || '';
    $('#logMin').value = sec ? Math.floor((sec % 3600) / 60) : '';
    $('#logSec').value = sec ? sec % 60 : '';
    $('#logPace').value = e.pace || '';
    $('#logWellness').value = e.wellness || 7;
    $('#wellnessOut').textContent = e.wellness || 7;
    $('#logNotes').value = e.notes || '';
    $('#logSaveBtn').textContent = 'Update Entry';
    $('#logFormTitle').textContent = `Edit ${fromISO(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`;
    updatePlannedHint(iso);
}

function resetForm() {
    editingDate = null;
    $('#logForm').reset();
    $('#logDate').value = todayISO();
    $('#logWellness').value = 7;
    $('#wellnessOut').textContent = '7';
    $('#logSaveBtn').textContent = 'Save Entry';
    $('#logFormTitle').textContent = 'Log a Run';
    updatePlannedHint(todayISO());
}
$('#logResetBtn').addEventListener('click', resetForm);

$('#logForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const iso = $('#logDate').value;
    if (!iso) { toast('Pick a date'); return; }
    const miles = parseFloat($('#logMiles').value) || 0;
    const timeSec = hmsToSec(+$('#logHrs').value, +$('#logMin').value, +$('#logSec').value);
    let pace = $('#logPace').value.trim();
    if (!pace && miles > 0 && timeSec > 0) pace = paceStr(timeSec / miles);
    logs[iso] = {
        date: iso,
        miles,
        timeSec,
        pace,
        wellness: +$('#logWellness').value,
        notes: $('#logNotes').value.trim(),
    };
    save(K_LOGS, logs);
    toast(editingDate ? 'Entry updated' : 'Entry saved');
    resetForm();
    renderLogList();
});

function renderLogList() {
    const list = $('#logList');
    const arr = logsArray().reverse();
    if (!arr.length) {
        list.innerHTML = '<div class="empty">No runs logged yet. Add your first entry above. 🏃</div>';
        return;
    }
    list.innerHTML = arr.map((e) => {
        const d = fromISO(e.date);
        const p = plannedForDate(e.date);
        const wColor = e.wellness >= 7 ? 'var(--good)' : e.wellness >= 4 ? 'var(--warn)' : 'var(--bad)';
        const vsPlan = (p && p.day.dist > 0)
            ? `<span class="le-metric">vs plan <b>${p.day.dist}mi</b></span>` : '';
        return `<div class="log-entry">
            <div class="le-top">
                <span class="le-date">${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                <span class="le-metric"><b>${e.miles}</b> mi</span>
                ${e.timeSec ? `<span class="le-metric">${secToHMS(e.timeSec)}</span>` : ''}
                ${e.pace ? `<span class="le-metric"><b>${e.pace}</b>/mi</span>` : ''}
                ${vsPlan}
                <span class="well-pill" style="background:${wColor}22;color:${wColor}">Wellness ${e.wellness}</span>
                <span class="le-actions">
                    <button class="mini-btn" data-edit="${e.date}">Edit</button>
                    <button class="mini-btn" data-del="${e.date}">Delete</button>
                </span>
            </div>
            ${e.notes ? `<div class="le-notes">“${e.notes}”</div>` : ''}
        </div>`;
    }).join('');
    $$('[data-edit]', list).forEach((b) => b.addEventListener('click', () => {
        loadEntryIntoForm(b.dataset.edit);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }));
    $$('[data-del]', list).forEach((b) => b.addEventListener('click', () => {
        if (confirm('Delete this entry?')) {
            delete logs[b.dataset.del];
            save(K_LOGS, logs);
            renderLogList();
            toast('Entry deleted');
        }
    }));
}

/* ====================== ANALYSIS view ====================== */
$$('.subtab').forEach((b) => b.addEventListener('click', () => {
    $$('.subtab').forEach((x) => x.classList.toggle('active', x === b));
    $$('.subview').forEach((v) => v.classList.toggle('active', v.id === `sub-${b.dataset.sub}`));
    renderAnalysis();
}));

function themeColors() {
    const cs = getComputedStyle(document.documentElement);
    return {
        text: cs.getPropertyValue('--text-2').trim(),
        grid: cs.getPropertyValue('--border').trim(),
        accent: cs.getPropertyValue('--accent').trim(),
        accent2: cs.getPropertyValue('--accent-2').trim(),
        good: cs.getPropertyValue('--good').trim(),
        muted: cs.getPropertyValue('--muted').trim(),
        bad: cs.getPropertyValue('--bad').trim(),
    };
}
function makeChart(id, config) {
    if (charts[id]) charts[id].destroy();
    const ctx = $('#' + id);
    if (!ctx) return;
    const c = themeColors();
    Chart.defaults.color = c.text;
    Chart.defaults.borderColor = c.grid;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    charts[id] = new Chart(ctx, config);
}

function renderAnalysis() {
    const active = $('.subtab.active').dataset.sub;
    if (active === 'daily') renderDaily();
    else if (active === 'weekly') renderWeekly();
    else renderMonthly();
}

function renderDaily() {
    const c = themeColors();
    const arr = logsArray();
    const runs = arr.filter((e) => e.miles > 0);

    // stat cards (today / latest)
    const todayE = logs[todayISO()];
    const latest = runs[runs.length - 1];
    const pToday = plannedForDate(todayISO());
    const last7 = arr.filter((e) => daysBetween(e.date, todayISO()) >= 0 && daysBetween(e.date, todayISO()) < 7);
    const last7Miles = last7.reduce((s, e) => s + (e.miles || 0), 0);
    const avgWell = arr.length ? (arr.reduce((s, e) => s + e.wellness, 0) / arr.length) : 0;
    $('#dailyStats').innerHTML = `
        <div class="stat"><div class="label">Today</div>
            <div class="value">${todayE ? todayE.miles : 0}<span style="font-size:13px"> mi</span></div>
            <div class="sub">${pToday && pToday.day.dist > 0 ? 'plan ' + pToday.day.dist + ' mi' : pToday ? pToday.day.label : 'no plan'}</div></div>
        <div class="stat"><div class="label">Last Run Pace</div>
            <div class="value">${latest && latest.pace ? latest.pace : '—'}</div>
            <div class="sub">${latest ? fromISO(latest.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}</div></div>
        <div class="stat"><div class="label">Last 7 Days</div>
            <div class="value">${last7Miles.toFixed(1)}<span style="font-size:13px"> mi</span></div>
            <div class="sub">${last7.filter(e => e.miles > 0).length} runs</div></div>
        <div class="stat"><div class="label">Avg Wellness</div>
            <div class="value">${avgWell ? avgWell.toFixed(1) : '—'}</div>
            <div class="sub">across ${arr.length} entries</div></div>`;

    // Pace trend (last 30 runs)
    const recent = runs.filter((e) => e.pace).slice(-30);
    makeChart('chartPaceDaily', {
        type: 'line',
        data: {
            labels: recent.map((e) => fromISO(e.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
            datasets: [{
                label: 'Pace (/mi)', data: recent.map((e) => parsePace(e.pace)),
                borderColor: c.accent, backgroundColor: c.accent + '22',
                tension: .3, fill: true, pointRadius: 3,
            }],
        },
        options: paceAxisOptions(c, 'Faster ↑'),
    });

    // Wellness line
    const wRecent = arr.slice(-30);
    makeChart('chartWellnessDaily', {
        type: 'line',
        data: {
            labels: wRecent.map((e) => fromISO(e.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
            datasets: [{
                label: 'Wellness', data: wRecent.map((e) => e.wellness),
                borderColor: c.accent2, backgroundColor: c.accent2 + '22',
                tension: .3, fill: true, pointRadius: 3,
            }],
        },
        options: baseOptions(c, { y: { min: 0, max: 10, ticks: { stepSize: 2 } } }),
    });

    // Actual vs planned recent (14 days)
    const wrap = $('#dailyCompare');
    const days = [];
    for (let i = 13; i >= 0; i--) days.push(toISO(addDays(fromISO(todayISO()), -i)));
    const rows = days.map((iso) => {
        const p = plannedForDate(iso);
        const e = logs[iso];
        const planMi = p ? p.day.dist : 0;
        const actMi = e ? e.miles : 0;
        if (!planMi && !actMi) return '';
        const max = Math.max(planMi, actMi, 1);
        return `<div class="compare-row">
            <span class="cr-date">${fromISO(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</span>
            <div class="bar-cmp"><span>Plan ${planMi || 0} mi</span><div class="bar-track"><div class="bar-fill planned" style="width:${planMi / max * 100}%"></div></div></div>
            <div class="bar-cmp"><span>Actual ${actMi || 0} mi</span><div class="bar-track"><div class="bar-fill actual" style="width:${actMi / max * 100}%"></div></div></div>
        </div>`;
    }).filter(Boolean).join('');
    wrap.innerHTML = rows || '<div class="empty">No planned or logged activity in the last two weeks.</div>';
}

function renderWeekly() {
    const c = themeColors();
    const ci = currentWeekIndex();
    const w = plan.weeks[ci];
    const actual = weekActualMiles(w);
    const completed = weekCompletedRunDays(w);
    const planned = weekPlannedRunDays(w).length;
    const consistency = planned ? Math.round(completed / planned * 100) : 0;
    // longest run this week
    let longest = 0, wellSum = 0, wellCount = 0;
    w.days.forEach((d) => {
        const e = logs[toISO(dayDate(w, d))];
        if (e) { longest = Math.max(longest, e.miles || 0); if (e.wellness) { wellSum += e.wellness; wellCount++; } }
    });
    const avgWell = wellCount ? (wellSum / wellCount).toFixed(1) : '—';

    $('#weeklyStats').innerHTML = `
        <div class="stat accent"><div class="label">${w.name} Mileage</div>
            <div class="value">${actual.toFixed(1)}<span style="font-size:13px"> / ${w.target}</span></div>
            <div class="sub">${Math.round(actual / (w.target || 1) * 100)}% of target</div></div>
        <div class="stat"><div class="label">Consistency</div>
            <div class="value">${consistency}%</div><div class="sub">${completed}/${planned} run days</div></div>
        <div class="stat"><div class="label">Longest Run</div>
            <div class="value">${longest.toFixed(1)}<span style="font-size:13px"> mi</span></div><div class="sub">this week</div></div>
        <div class="stat"><div class="label">Avg Wellness</div>
            <div class="value">${avgWell}</div><div class="sub">this week</div></div>`;

    // Weekly mileage bar — planned vs actual
    const labels = plan.weeks.map((x) => x.name.replace('Week ', 'W').replace('Kickoff', 'K'));
    makeChart('chartWeeklyMiles', {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Planned', data: plan.weeks.map((x) => x.target), backgroundColor: c.muted + '99' },
                { label: 'Actual', data: plan.weeks.map((x) => +weekActualMiles(x).toFixed(1)), backgroundColor: c.accent },
            ],
        },
        options: baseOptions(c, { y: { title: { display: true, text: 'Miles' } } }),
    });

    // Table
    const tbl = $('#weeklyTable');
    let html = '<thead><tr><th>Week</th><th>Phase</th><th>Target</th><th>Actual</th><th>%</th><th>Consistency</th><th>Long</th></tr></thead><tbody>';
    plan.weeks.forEach((x, i) => {
        const act = weekActualMiles(x);
        const comp = weekCompletedRunDays(x);
        const pl = weekPlannedRunDays(x).length;
        const cons = pl ? Math.round(comp / pl * 100) : 0;
        let long = 0;
        x.days.forEach((d) => { const e = logs[toISO(dayDate(x, d))]; if (e) long = Math.max(long, e.miles || 0); });
        const pctMi = Math.round(act / (x.target || 1) * 100);
        const cls = (v) => v >= 90 ? 'pct-good' : v >= 60 ? 'pct-mid' : 'pct-bad';
        const hasData = act > 0;
        html += `<tr class="${i === ci ? 'current' : ''}">
            <td><b>${x.name}</b></td><td>${x.phase}</td><td>${x.target} mi</td>
            <td>${act.toFixed(1)} mi</td>
            <td>${hasData ? `<span class="${cls(pctMi)}">${pctMi}%</span>` : '—'}</td>
            <td>${hasData ? `<span class="${cls(cons)}">${cons}%</span>` : '—'}</td>
            <td>${long ? long.toFixed(1) : '—'}</td></tr>`;
    });
    html += '</tbody>';
    tbl.innerHTML = html;
}

function renderMonthly() {
    const c = themeColors();
    const arr = logsArray();
    const runs = arr.filter((e) => e.miles > 0);

    // group by month
    const months = {};
    arr.forEach((e) => {
        const key = e.date.slice(0, 7);
        (months[key] = months[key] || []).push(e);
    });
    const monthKeys = Object.keys(months).sort();

    const totalMiles = runs.reduce((s, e) => s + e.miles, 0);
    const totalTime = runs.reduce((s, e) => s + (e.timeSec || 0), 0);
    const paced = runs.filter((e) => e.pace);
    const avgPace = paced.length ? paced.reduce((s, e) => s + parsePace(e.pace), 0) / paced.length : 0;

    // completed vs missed across whole plan to date
    let compTot = 0, planTot = 0;
    const todayD = fromISO(todayISO());
    plan.weeks.forEach((w) => {
        weekPlannedRunDays(w).forEach((d) => {
            const date = dayDate(w, d);
            if (date <= todayD) {
                planTot++;
                const e = logs[toISO(date)];
                if (e && e.miles > 0) compTot++;
            }
        });
    });

    $('#monthlyStats').innerHTML = `
        <div class="stat accent"><div class="label">Total Mileage</div>
            <div class="value">${totalMiles.toFixed(0)}<span style="font-size:13px"> mi</span></div>
            <div class="sub">${runs.length} runs logged</div></div>
        <div class="stat"><div class="label">Total Time</div>
            <div class="value" style="font-size:22px">${secToHMS(totalTime)}</div><div class="sub">moving time</div></div>
        <div class="stat"><div class="label">Avg Pace</div>
            <div class="value">${avgPace ? paceStr(avgPace) : '—'}</div><div class="sub">all runs</div></div>
        <div class="stat"><div class="label">Workouts Done</div>
            <div class="value">${compTot}<span style="font-size:13px"> / ${planTot}</span></div>
            <div class="sub">${planTot ? Math.round(compTot / planTot * 100) : 0}% completed</div></div>`;

    // Cumulative mileage line (per run date)
    let cum = 0;
    const cumPts = runs.map((e) => { cum += e.miles; return { x: e.date, y: +cum.toFixed(1) }; });
    makeChart('chartCumulative', {
        type: 'line',
        data: {
            labels: cumPts.map((p) => fromISO(p.x).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
            datasets: [{ label: 'Cumulative miles', data: cumPts.map((p) => p.y), borderColor: c.accent, backgroundColor: c.accent + '22', fill: true, tension: .25, pointRadius: 0 }],
        },
        options: baseOptions(c, { y: { title: { display: true, text: 'Miles' } } }),
    });

    // Pace progression — weekly average pace
    const weekPace = plan.weeks.map((w) => {
        const es = w.days.map((d) => logs[toISO(dayDate(w, d))]).filter((e) => e && e.pace && e.miles > 0);
        if (!es.length) return null;
        return es.reduce((s, e) => s + parsePace(e.pace), 0) / es.length;
    });
    const wpLabels = plan.weeks.map((x) => x.name.replace('Week ', 'W').replace('Kickoff', 'K'));
    makeChart('chartPaceMonthly', {
        type: 'line',
        data: {
            labels: wpLabels,
            datasets: [{
                label: 'Avg weekly pace (/mi)', data: weekPace.map((v) => v ? +v.toFixed(1) : null),
                borderColor: c.good, backgroundColor: c.good + '22', spanGaps: true, tension: .3, pointRadius: 3,
            }],
        },
        options: paceAxisOptions(c, 'Faster ↑'),
    });

    // Wellness trend — weekly average
    const weekWell = plan.weeks.map((w) => {
        const es = w.days.map((d) => logs[toISO(dayDate(w, d))]).filter((e) => e);
        if (!es.length) return null;
        return es.reduce((s, e) => s + e.wellness, 0) / es.length;
    });
    makeChart('chartWellnessMonthly', {
        type: 'line',
        data: {
            labels: wpLabels,
            datasets: [{ label: 'Avg weekly wellness', data: weekWell.map((v) => v ? +v.toFixed(1) : null), borderColor: c.accent2, backgroundColor: c.accent2 + '22', spanGaps: true, tension: .3, fill: true, pointRadius: 3 }],
        },
        options: baseOptions(c, { y: { min: 0, max: 10, ticks: { stepSize: 2 } } }),
    });

    // Completed vs missed per month
    const compByMonth = {}, missByMonth = {};
    plan.weeks.forEach((w) => {
        weekPlannedRunDays(w).forEach((d) => {
            const date = dayDate(w, d);
            if (date > todayD) return;
            const mk = toISO(date).slice(0, 7);
            const e = logs[toISO(date)];
            if (e && e.miles > 0) compByMonth[mk] = (compByMonth[mk] || 0) + 1;
            else missByMonth[mk] = (missByMonth[mk] || 0) + 1;
        });
    });
    const allM = Array.from(new Set([...Object.keys(compByMonth), ...Object.keys(missByMonth)])).sort();
    makeChart('chartCompletion', {
        type: 'bar',
        data: {
            labels: allM.map((m) => fromISO(m + '-01').toLocaleDateString(undefined, { month: 'short', year: '2-digit' })),
            datasets: [
                { label: 'Completed', data: allM.map((m) => compByMonth[m] || 0), backgroundColor: c.good, stack: 's' },
                { label: 'Missed', data: allM.map((m) => missByMonth[m] || 0), backgroundColor: c.bad, stack: 's' },
            ],
        },
        options: baseOptions(c, { x: { stacked: true }, y: { stacked: true, title: { display: true, text: 'Workouts' } } }),
    });
}

function baseOptions(c, scales = {}) {
    return {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { boxWidth: 12 } } },
        scales: Object.assign({
            x: { grid: { color: c.grid + '55' }, ticks: { maxRotation: 0, autoSkip: true } },
            y: { grid: { color: c.grid + '55' }, beginAtZero: true },
        }, scales),
    };
}
function paceAxisOptions(c, note) {
    return {
        responsive: true, maintainAspectRatio: false,
        plugins: {
            legend: { labels: { boxWidth: 12 } },
            tooltip: { callbacks: { label: (ctx) => paceStr(ctx.parsed.y) + ' /mi' } },
        },
        scales: {
            x: { grid: { color: c.grid + '55' }, ticks: { maxRotation: 0, autoSkip: true } },
            y: { reverse: true, grid: { color: c.grid + '55' }, title: { display: true, text: note }, ticks: { callback: (v) => paceStr(v) } },
        },
    };
}

/* ====================== COACHING INSIGHTS ====================== */
function renderInsights() {
    const list = $('#insightsList');
    const arr = logsArray();
    const runs = arr.filter((e) => e.miles > 0);
    const ins = [];
    const ci = currentWeekIndex();
    const today = fromISO(todayISO());
    const raceD = fromISO(plan.raceDate);
    const daysToRace = Math.round((raceD - today) / 86400000);
    const weeksToRace = Math.ceil(daysToRace / 7);

    // Recent windows
    const last7 = arr.filter((e) => { const d = daysBetween(e.date, todayISO()); return d >= 0 && d < 7; });
    const last14 = arr.filter((e) => { const d = daysBetween(e.date, todayISO()); return d >= 0 && d < 14; });

    /* 1. Low wellness */
    const recentWell = last7.map((e) => e.wellness);
    if (recentWell.length >= 3) {
        const avg = recentWell.reduce((a, b) => a + b, 0) / recentWell.length;
        if (avg < 4.5) {
            ins.push(['bad', '🛑', 'Wellness is running low',
                `Your average wellness over the last week is ${avg.toFixed(1)}/10 across ${recentWell.length} entries. That's a fatigue signal. Consider an easy/recovery week — cut volume ~20–30%, swap a quality session for easy running, and prioritize sleep. Pushing through chronically low wellness invites injury or illness.`]);
        } else if (avg < 6) {
            ins.push(['warn', '😓', 'Wellness slightly suppressed',
                `Average wellness is ${avg.toFixed(1)}/10 lately. Keep easy days truly easy and watch for a downward trend. If it keeps dropping, take an extra rest day.`]);
        }
    }

    /* 2. Mileage vs target (current week, only meaningful mid/late week) */
    if (ci >= 0) {
        const w = plan.weeks[ci];
        const act = weekActualMiles(w);
        const monday = fromISO(w.monday);
        const dayThroughWeek = Math.min(7, Math.max(1, Math.round((today - monday) / 86400000) + 1));
        const expectedSoFar = w.target * (dayThroughWeek / 7);
        if (dayThroughWeek >= 4 && act < expectedSoFar * 0.6) {
            ins.push(['warn', '📉', `Behind on ${w.name} mileage`,
                `You've logged ${act.toFixed(1)} mi of a ${w.target} mi target with the week ${Math.round(dayThroughWeek / 7 * 100)}% gone. You're tracking below pace. Don't cram missed miles into one session — spread the catch-up across remaining easy days, and protect the long run. If you've missed a lot, it's safer to repeat this week's volume than to leap ahead.`]);
        }
    }

    /* 3. Season-to-date adherence -> race readiness */
    let compTot = 0, planTot = 0;
    plan.weeks.forEach((w) => {
        weekPlannedRunDays(w).forEach((d) => {
            const date = dayDate(w, d);
            if (date <= today) { planTot++; const e = logs[toISO(date)]; if (e && e.miles > 0) compTot++; }
        });
    });
    if (planTot >= 5) {
        const adh = compTot / planTot;
        if (adh < 0.65) {
            ins.push(['bad', '⚠️', 'Race readiness at risk',
                `You've completed ${compTot} of ${planTot} planned workouts (${Math.round(adh * 100)}%) so far. Consistency is the #1 predictor of a strong half. Rebuild the routine: lock in the long run and one quality day each week, and treat the rest as flexible easy miles.`]);
        } else if (adh >= 0.9) {
            ins.push(['good', '✅', 'Excellent consistency',
                `${Math.round(adh * 100)}% of planned workouts done (${compTot}/${planTot}). This kind of adherence is exactly what builds race-day fitness. Keep it up and stay healthy.`]);
        }
    }

    /* 4. Pace trend over recent weeks (easy-run pace) */
    const weekEasyPace = plan.weeks.map((w) => {
        const es = w.days.filter((d) => d.type === 'easy').map((d) => logs[toISO(dayDate(w, d))]).filter((e) => e && e.pace && e.miles > 0);
        if (!es.length) return null;
        return es.reduce((s, e) => s + parsePace(e.pace), 0) / es.length;
    });
    const withData = weekEasyPace.map((v, i) => ({ v, i })).filter((x) => x.v != null);
    if (withData.length >= 3) {
        const recent3 = withData.slice(-3).map((x) => x.v);
        const improving = recent3[0] - recent3[recent3.length - 1]; // positive = faster
        if (improving > 5) {
            ins.push(['good', '🚀', 'Easy pace is trending faster',
                `Your average easy pace has improved by about ${Math.round(improving)} sec/mi over the last few weeks — a clear sign aerobic fitness is building. Resist the urge to make easy runs harder; let the gains come from the quality sessions and long runs.`]);
        } else if (improving < -8) {
            ins.push(['warn', '🐢', 'Easy pace is drifting slower',
                `Easy pace has slowed ~${Math.abs(Math.round(improving))} sec/mi recently. This can be heat, fatigue, or under-recovery. If wellness is also down, back off; if it's just heat, treat pace as an effort ceiling and don't force it.`]);
        }
    }

    /* 5. Overtraining: high volume + low wellness over multiple days */
    const highLowDays = last14.filter((e) => e.miles >= 8 && e.wellness <= 4).length;
    const lowStreak = (() => {
        let streak = 0, max = 0;
        arr.slice(-10).forEach((e) => { if (e.wellness <= 4) { streak++; max = Math.max(max, streak); } else streak = 0; });
        return max;
    })();
    if (highLowDays >= 2 || lowStreak >= 3) {
        ins.push(['bad', '🔥', 'Possible overtraining signals',
            `You've had ${highLowDays >= 2 ? `${highLowDays} high-mileage days paired with low wellness` : `${lowStreak} straight low-wellness days`} recently. That combination is a classic overreaching pattern. Insert 2–3 genuinely easy or rest days, hydrate, and only resume hard efforts once wellness recovers above ~6. Better to lose a few miles than weeks to injury.`]);
    }

    /* 6. Taper reminder (within 3 weeks of race) */
    if (daysToRace >= 0 && weeksToRace <= 3) {
        if (weeksToRace <= 1) {
            ins.push(['info', '🏁', 'Race week is here',
                `${daysToRace} day${daysToRace === 1 ? '' : 's'} to ${plan.raceName}. Volume should be low now — short shakeouts with a few strides keep the legs sharp. Prioritize sleep, hydration, and carbs. You can't gain fitness this week, but you can arrive fresh. Trust the work you've done.`]);
        } else {
            ins.push(['info', '📉', 'Taper phase — reduce volume, keep intensity',
                `${weeksToRace} weeks out. This is taper territory: drop weekly volume but keep a little sharpening intensity (short tempo/intervals) so the legs stay quick. The goal is to arrive fresh, not fitter. Don't add "just one more" big week.`]);
        }
    }

    /* 7. Long run check */
    const recentLong = (() => {
        for (let i = Math.max(0, ci - 1); i <= ci; i++) {
            const w = plan.weeks[i]; if (!w) continue;
            const ld = w.days.find((d) => d.type === 'long');
            if (ld) { const e = logs[toISO(dayDate(w, ld))]; if (e && e.miles > 0) return { planned: ld.dist, actual: e.miles }; }
        }
        return null;
    })();
    if (recentLong && recentLong.actual < recentLong.planned * 0.8 && weeksToRace > 3) {
        ins.push(['warn', '🏔️', 'Long run came up short',
            `Your most recent long run was ${recentLong.actual} mi vs a planned ${recentLong.planned} mi. The long run is the single best predictor of half-marathon execution. Try to hit the planned distance next week — slow the pace if needed, but get the time on feet.`]);
    }

    /* Positive default if nothing flagged */
    if (!ins.length) {
        if (runs.length === 0) {
            ins.push(['info', '👋', 'Welcome to Stride',
                `Log your first few runs and insights will appear here — covering wellness, mileage vs target, pace trends, overtraining signals, and taper reminders as race day approaches.`]);
        } else {
            ins.push(['good', '👍', 'Everything looks on track',
                `No red flags in your recent data. Consistency, wellness, and pacing are all within healthy ranges. Keep logging and stick to the plan.`]);
        }
    }

    list.innerHTML = ins.map(([cls, icon, title, body]) =>
        `<div class="insight ${cls}"><h3>${icon} ${title}</h3><p>${body}</p></div>`).join('');
}

/* ====================== PDF UPLOAD ====================== */
$('#uploadPlanBtn').addEventListener('click', () => $('#pdfInput').click());
$('#pdfInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!pdfjsLib) { toast('PDF engine still loading — try again in a moment'); return; }
    toast('Reading PDF…');
    try {
        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        let text = '';
        for (let p = 1; p <= pdf.numPages; p++) {
            const page = await pdf.getPage(p);
            const content = await page.getTextContent();
            text += content.items.map((it) => it.str).join(' ') + '\n';
        }
        const parsed = parsePlanText(text);
        if (!parsed.weeks.length) {
            toast('Couldn’t auto-detect weeks — opening editor to set it up');
            openEditor(); // edit from current plan
            return;
        }
        // Preserve race date if PDF didn't give one
        parsed.raceDate = parsed.raceDate || (plan ? plan.raceDate : todayISO());
        parsed.source = 'pdf';
        reanchorPlan(parsed);
        plan = parsed;
        save(K_PLAN, plan);
        renderPlan();
        toast(`Imported ${parsed.weeks.length} weeks from PDF — review & edit`);
        openEditor();
    } catch (err) {
        console.error(err);
        toast('Failed to read that PDF');
    }
});

/* Best-effort parser: finds "Week N ... NN mi", goal pace, race date,
   and day rows (Mon/Tue/...). Designed for plans like the built-in one
   but resilient: anything it misses can be fixed in the editor. */
function parsePlanText(raw) {
    const text = raw.replace(/\s+/g, ' ').replace(/[–—]/g, '-');
    const weeks = [];

    // Race name & date
    let raceName = 'Half Marathon';
    const nameM = text.match(/(Half Marathon|Marathon|10K|5K|10 Mile|Ultra)/i);
    if (nameM) raceName = nameM[1];
    let raceDate = null;
    const dateM = text.match(/Race\s*Day\s*\w*\s*([A-Z][a-z]{2,8})\s+(\d{1,2}),?\s*(\d{4})/i)
        || text.match(/Race\s*Date[:\s]*([A-Z][a-z]{2,8})\s+(\d{1,2}),?\s*(\d{4})/i);
    if (dateM) raceDate = parseMonthName(dateM[1], +dateM[2], +dateM[3]);

    let goalPace = '';
    const gpM = text.match(/(?:goal\s*(?:race\s*)?pace|GP)\D{0,6}(\d:\d{2})\s*\/?\s*mi/i);
    if (gpM) goalPace = gpM[1].replace('"', ':');

    // Split into week chunks. Match "Week N" and also "Kickoff".
    const headerRe = /(Kickoff|Week\s*\d{1,2})\b/gi;
    const markers = [];
    let m;
    while ((m = headerRe.exec(text)) !== null) markers.push({ name: m[1].replace(/\s+/, ' '), idx: m.index });
    for (let i = 0; i < markers.length; i++) {
        const chunk = text.slice(markers[i].idx, i + 1 < markers.length ? markers[i + 1].idx : text.length);
        const wk = parseWeekChunk(markers[i].name, chunk);
        if (wk) weeks.push(wk);
    }

    return { source: 'pdf', raceName, raceDate, goalPace: goalPace || '7:00', weeks };
}

function parseWeekChunk(name, chunk) {
    // weekly target mileage: look for "NN mi" near the header
    let target = 0;
    const tM = chunk.match(/(\d{1,3})\s*mi\b/);
    if (tM) target = +tM[1];
    // focus
    let focus = '';
    const fM = chunk.match(/Focus:?\s*([^]*?)(?:Mon|Day\b|$)/i);
    if (fM) focus = fM[1].replace(/[#|].*$/, '').trim().slice(0, 60);

    // days
    const days = [];
    const dayRe = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/g;
    const dpos = [];
    let dm;
    while ((dm = dayRe.exec(chunk)) !== null) dpos.push({ wd: dm[1], idx: dm.index });
    for (let i = 0; i < dpos.length; i++) {
        // ignore duplicate weekday mentions; only take first 7 distinct in order
        if (days.find((d) => d.wd === dpos[i].wd)) continue;
        const seg = chunk.slice(dpos[i].idx + 3, (i + 1 < dpos.length ? dpos[i + 1].idx : chunk.length));
        days.push(parseDaySeg(dpos[i].wd, seg));
        if (days.length >= 7) break;
    }
    if (!days.length && !target) return null;
    return { name: name.replace(/week/i, 'Week'), phase: 'Imported', focus, target, days };
}

function parseDaySeg(wd, seg) {
    seg = seg.trim();
    const distM = seg.match(/(\d{1,2}(?:\.\d)?)\s*mi\b/);
    const dist = distM ? +distM[1] : 0;
    const paceM = seg.match(/(\d:\d{2})(?:\s*\/?\s*mi)?/);
    const pace = paceM ? paceM[1] : '';
    let type = 'easy';
    const low = seg.toLowerCase();
    if (/rest/.test(low)) type = 'rest';
    else if (/cross|xt|bike|swim|elliptical/.test(low)) type = 'cross';
    else if (/interval|x\s*\d|repeat|800m|1000m|400m|600m/.test(low)) type = 'intervals';
    else if (/tempo/.test(low)) type = 'tempo';
    else if (/threshold/.test(low)) type = 'threshold';
    else if (/sharpen/.test(low)) type = 'sharpen';
    else if (/race|half marathon|marathon|13\.1/.test(low)) type = 'race';
    else if (/long/.test(low)) type = 'long';
    // label: trim to a sane length
    let label = seg.replace(/\s{2,}/g, ' ').trim();
    label = label.split(/\s(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/)[0].slice(0, 70) || type;
    if (type === 'rest') label = 'Rest';
    return { wd, type, label, dist: type === 'rest' || type === 'cross' ? 0 : dist, pace: (type === 'rest' || type === 'cross') ? '' : pace };
}

function parseMonthName(mon, day, year) {
    const idx = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
        .indexOf(mon.slice(0, 3).toLowerCase());
    if (idx < 0) return null;
    return toISO(new Date(year, idx, day));
}

/* ====================== PLAN EDITOR ====================== */
let draft = null;
$('#editPlanBtn').addEventListener('click', () => openEditor());
$('#editorClose').addEventListener('click', closeEditor);
$('#editorModal .modal-overlay').addEventListener('click', closeEditor);

function openEditor() {
    draft = JSON.parse(JSON.stringify(plan));
    $('#edRaceName').value = draft.raceName;
    $('#edRaceDate').value = draft.raceDate;
    $('#edGoalPace').value = draft.goalPace || '';
    renderEditorWeeks();
    $('#editorModal').classList.remove('hidden');
}
function closeEditor() { $('#editorModal').classList.add('hidden'); }

const TYPE_OPTS = ['easy', 'long', 'tempo', 'intervals', 'threshold', 'sharpen', 'cross', 'rest', 'race'];
function renderEditorWeeks() {
    const wrap = $('#editorWeeks');
    wrap.innerHTML = '';
    draft.weeks.forEach((w, wi) => {
        const el = document.createElement('div');
        el.className = 'ed-week';
        el.innerHTML = `
            <div class="ed-week-top">
                <div class="field"><label>Week name</label><input data-w="${wi}" data-f="name" value="${esc(w.name)}"></div>
                <div class="field"><label>Target (mi)</label><input type="number" data-w="${wi}" data-f="target" value="${w.target}"></div>
                <div class="field"><label>Focus</label><input data-w="${wi}" data-f="focus" value="${esc(w.focus || '')}"></div>
                <button class="mini-btn" data-delweek="${wi}">Delete</button>
            </div>
            <div class="ed-days"></div>
            <button class="mini-btn" data-addday="${wi}" style="margin-top:6px">+ Add day</button>`;
        const daysWrap = el.querySelector('.ed-days');
        w.days.forEach((d, di) => {
            const row = document.createElement('div');
            row.className = 'ed-day';
            row.innerHTML = `
                <select data-w="${wi}" data-d="${di}" data-f="wd" class="ed-wd">${WD.map((x) => `<option ${x === d.wd ? 'selected' : ''}>${x}</option>`).join('')}</select>
                <input data-w="${wi}" data-d="${di}" data-f="label" value="${esc(d.label)}" placeholder="Workout">
                <input type="number" step="0.1" data-w="${wi}" data-d="${di}" data-f="dist" value="${d.dist || ''}" placeholder="mi">
                <input data-w="${wi}" data-d="${di}" data-f="pace" value="${esc(d.pace || '')}" placeholder="pace">
                <select data-w="${wi}" data-d="${di}" data-f="type">${TYPE_OPTS.map((t) => `<option ${t === d.type ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
            daysWrap.appendChild(row);
        });
        wrap.appendChild(el);
    });

    // wire inputs
    $$('[data-f]', wrap).forEach((inp) => inp.addEventListener('input', () => {
        const wi = +inp.dataset.w, f = inp.dataset.f;
        if (inp.dataset.d !== undefined) {
            const di = +inp.dataset.d;
            let v = inp.value;
            if (f === 'dist') v = parseFloat(v) || 0;
            draft.weeks[wi].days[di][f] = v;
        } else {
            let v = inp.value;
            if (f === 'target') v = parseFloat(v) || 0;
            draft.weeks[wi][f] = v;
        }
    }));
    $$('[data-delweek]', wrap).forEach((b) => b.addEventListener('click', () => {
        draft.weeks.splice(+b.dataset.delweek, 1); renderEditorWeeks();
    }));
    $$('[data-addday]', wrap).forEach((b) => b.addEventListener('click', () => {
        draft.weeks[+b.dataset.addday].days.push({ wd: 'Mon', type: 'easy', label: 'Easy', dist: 4, pace: '' });
        renderEditorWeeks();
    }));
}
function esc(s) { return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

$('#addWeekBtn').addEventListener('click', () => {
    draft.weeks.push({
        name: 'Week ' + (draft.weeks.length), phase: 'Custom', focus: '', target: 20,
        days: WD.map((wd) => ({ wd, type: wd === 'Mon' ? 'rest' : 'easy', label: wd === 'Mon' ? 'Rest' : 'Easy', dist: wd === 'Mon' ? 0 : 4, pace: '' })),
    });
    renderEditorWeeks();
});

$('#savePlanBtn').addEventListener('click', () => {
    draft.raceName = $('#edRaceName').value.trim() || 'Race';
    draft.raceDate = $('#edRaceDate').value || draft.raceDate;
    draft.goalPace = $('#edGoalPace').value.trim();
    if (!draft.weeks.length) { toast('Add at least one week'); return; }
    draft.source = draft.source === 'pdf' ? 'pdf' : 'edited';
    reanchorPlan(draft);
    plan = draft;
    save(K_PLAN, plan);
    closeEditor();
    renderPlan();
    toast('Plan saved');
});

$('#resetPlanBtn').addEventListener('click', () => {
    if (!confirm('Reset to the built-in 15-week half-marathon plan? Your custom edits will be lost.')) return;
    const rd = $('#edRaceDate').value || plan.raceDate;
    draft = buildBuiltInPlan(rd, $('#edRaceName').value.trim() || 'Half Marathon');
    $('#edGoalPace').value = draft.goalPace;
    renderEditorWeeks();
    toast('Reset to built-in plan (not yet saved)');
});

/* ====================== First-run setup ====================== */
$('#setupSave').addEventListener('click', () => {
    const rd = $('#setupRaceDate').value;
    if (!rd) { toast('Pick a race date'); return; }
    plan = buildBuiltInPlan(rd, $('#setupRaceName').value.trim() || 'Half Marathon');
    save(K_PLAN, plan);
    $('#setupModal').classList.add('hidden');
    renderPlan();
    toast('Plan ready — good luck! 🏁');
});

/* ====================== Init ====================== */
function init() {
    applyTheme();
    resetForm();
    if (!plan) {
        // default the date picker to the built-in plan's race date
        $('#setupRaceDate').value = '2026-09-30';
        $('#setupModal').classList.remove('hidden');
    } else {
        renderPlan();
    }
}
init();
