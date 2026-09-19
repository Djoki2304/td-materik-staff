(() => {
'use strict';
const L = window.Logic;
const KEY = 'shopstaff.v1';
const $ = (s, r = document) => r.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

/* ================= Хранилище ================= */
let memOnly = false;

function defaults() {
  return {
    v: 1,
    settings: { currency: '₽', payEvery: 5, perDay: 10, pinHash: null, shopName: 'ТД Материк', logo: null },
    positions: ['Продавец', 'Кассир', 'Грузчик', 'Администратор', 'Уборщица'].map(n => ({ id: uid(), name: n, rate: 0, pay: n === 'Администратор' ? 'month' : 'day' })),
    employees: [], att: {}, payments: [],
    meta: { lastBackup: null, created: Date.now() }
  };
}
function load() {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = Object.assign(d, JSON.parse(raw));
      s.settings = Object.assign(defaults().settings, s.settings);
      return s;
    }
  } catch (e) { memOnly = true; }
  return d;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { memOnly = true; }
}
let S = load();
try { localStorage.setItem(KEY + '.probe', '1'); localStorage.removeItem(KEY + '.probe'); } catch (e) { memOnly = true; }
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}

/* ================= Форматирование ================= */
const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const money = n => nf.format(Math.round(n * 100) / 100) + ' ' + (S.settings.currency || '');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WD_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const WD_FULL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const fmtShort = s => { const [, m, d] = s.split('-').map(Number); return d + ' ' + MONTHS[m - 1]; };
const fmtLong = s => WD_FULL[L.weekday(s)] + ', ' + fmtShort(s);
const monthLabel = ym => { const [y, m] = ym.split('-').map(Number); return MONTHS_NOM[m - 1] + ' ' + y; };
const initials = n => n.trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
const shortName = n => { const w = n.trim().split(/\s+/); return w.length > 1 ? w[0] + ' ' + w[1][0] + '.' : w[0]; };
const hue = n => { let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const avatar = e => `<div class="avatar" style="background:hsl(${hue(e.name)} 55% 38%)">${esc(initials(e.name))}</div>`;
const plural = (n, a, b, c) => { const m = Math.abs(n) % 100, k = m % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k > 1 && k < 5 ? b : c; };
const logoSrc = () => S.settings.logo || 'icons/icon-192.png';
const brand = () => `<div class="brand"><img src="${logoSrc()}" alt=""><div><b>${esc(S.settings.shopName || 'Магазин')}</b><small>Учёт персонала</small></div></div>`;
const localIso = ts => { const d = new Date(ts); return d.getFullYear() + '-' + L.pad2(d.getMonth() + 1) + '-' + L.pad2(d.getDate()); };
const days = n => n + ' ' + plural(n, 'день', 'дня', 'дней');

const ST = {
  w: { label: 'Вышел', short: '✓', cls: 'ok' },
  a: { label: 'Прогул', short: '✕', cls: 'bad' },
  o: { label: 'Выходной', short: '–', cls: 'off' },
  s: { label: 'Больничный', short: 'Б', cls: 'warn' },
  v: { label: 'Отпуск', short: 'О', cls: 'info' }
};
const PAY_TYPES = { pay: 'Выплата зарплаты', adv: 'Аванс', bonus: 'Премия', fine: 'Штраф' };

/* ================= Помощники по данным ================= */
const getEmp = id => S.employees.find(e => e.id === id);
const activeEmps = () => S.employees.filter(e => e.active !== false);
const posName = e => (S.positions.find(p => p.id === e.positionId) || {}).name || 'Без должности';
const rateNow = e => L.rateOf(e, S.positions);
const isMonthly = e => L.isMonthly(e, S.positions);
const rateLabel = e => money(rateNow(e)) + (isMonthly(e) ? '/мес' : '/день');
const dueOf = e => L.dueInfo(S, e, L.today(), S.settings.payEvery);
const schedLabel = e => e.schedule === 'free' || !L.SCHEDULES[e.schedule] ? 'Свободный' : e.schedule;

function setStatus(empId, date, st) {
  if (st === 'w' && date > L.today()) { toast('Нельзя отметить выход на будущую дату'); return false; }
  const e = getEmp(empId);
  const a = S.att[empId] = S.att[empId] || {};
  const cur = a[date];
  if (!st) delete a[date];
  else if (st === 'w') a[date] = { s: 'w', r: cur && cur.s === 'w' ? cur.r : L.dayRate(e, S.positions) };
  else a[date] = { s: st };
  save();
  return true;
}
const balance = id => L.balanceOf(S, id);
const dueList = () => activeEmps().filter(e => dueOf(e).due);

/* ================= Состояние интерфейса ================= */
const ui = { tab: 'today', date: null, month: L.today().slice(0, 7), salView: 'due', showOff: false, matrixFresh: true };
const curDate = () => ui.date || L.today();

/* ================= Общие элементы ================= */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
function openSheet(title, body) {
  const r = $('#sheet-root');
  r.innerHTML = `<div class="backdrop" data-act="closeSheet"></div>
    <div class="sheet"><div class="sheet-head"><h2>${title}</h2><button class="x" data-act="closeSheet" aria-label="Закрыть">✕</button></div>
    <div class="sheet-body">${body}</div></div>`;
  r.classList.add('open');
}
function closeSheet() { const r = $('#sheet-root'); r.classList.remove('open'); r.innerHTML = ''; }

const ICONS = {
  today: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  sheet: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  pay: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v.01M18 15v.01"/>',
  staff: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2.5 0 4.5 2 4.5 4.5"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'
};
const TABS = [['today', 'Сегодня'], ['sheet', 'Табель'], ['pay', 'Зарплата'], ['staff', 'Люди'], ['more', 'Ещё']];
function renderTabs() {
  const due = dueList().length;
  $('#tabbar').innerHTML = TABS.map(([id, label]) =>
    `<button class="tab ${ui.tab === id ? 'on' : ''}" data-act="tab" data-tab="${id}"><svg viewBox="0 0 24 24">${ICONS[id]}</svg>${label}${id === 'pay' && due ? `<span class="badge">${due}</span>` : ''}</button>`).join('');
}

/* ================= Экран «Сегодня» ================= */
function empRow(e, date) {
  const st = (L.getRec(S.att, e.id, date) || {}).s;
  const other = st && st !== 'w' && st !== 'a';
  return `<div class="row">${avatar(e)}
    <div class="grow"><div class="name">${esc(e.name)}</div><div class="sub">${esc(posName(e))} · ${isMonthly(e) ? 'оклад' : money(rateNow(e))}</div></div>
    <div class="seg">
      <button class="sbtn ${st === 'w' ? 'on ok' : ''}" data-act="mark" data-emp="${e.id}" data-st="w" aria-label="Вышел">✓</button>
      <button class="sbtn ${st === 'a' ? 'on bad' : ''}" data-act="mark" data-emp="${e.id}" data-st="a" aria-label="Прогул">✕</button>
      <button class="sbtn ${other ? 'on ' + ST[st].cls : ''}" data-act="dayMenu" data-emp="${e.id}" data-date="${date}" aria-label="Другой статус">${other ? ST[st].short : '⋯'}</button>
    </div></div>`;
}

function needBackup() {
  if (!S.employees.length) return false;
  const t = S.meta.lastBackup;
  return !t || Date.now() - t > 7 * 864e5;
}

function viewToday() {
  const date = curDate(), tdy = L.today();
  const emps = activeEmps();
  let html = brand() + `<div class="navbar">
      <button class="iconbtn" data-act="dateNav" data-d="-1" aria-label="Вчера">‹</button>
      <div class="lbl">${fmtLong(date)}<small>${date === tdy ? 'Сегодня' : `<a href="#" data-act="dateNav" data-d="today" style="color:var(--accent);text-decoration:none">Вернуться на сегодня</a>`}</small></div>
      <button class="iconbtn" data-act="dateNav" data-d="1" aria-label="Завтра">›</button></div>`;

  if (memOnly) html += `<div class="banner bad"><div class="grow"><b>Данные не сохраняются!</b>Браузер не даёт записать данные на устройство. Откройте приложение с экрана «Домой» и сделайте резервную копию.</div></div>`;
  if (needBackup()) html += `<div class="banner"><div class="grow"><b>Сделайте резервную копию</b>${S.meta.lastBackup ? 'Прошло больше недели с последней копии.' : 'Копий ещё не было.'} Так данные не потеряются вместе с телефоном.</div><button class="btn small" data-act="backup">Открыть</button></div>`;

  if (!emps.length) {
    return html + `<div class="card empty">Пока нет сотрудников.<br>Сначала задайте ставки по должностям, затем добавьте людей.
      <div class="btn-row" style="margin-top:14px"><button class="btn" data-act="positions">Должности и ставки</button><button class="btn primary" data-act="editEmp" data-id="new">Добавить сотрудника</button></div>
      <div style="margin-top:16px"><a href="#" data-act="demo" style="color:var(--accent)">Посмотреть на демо-данных</a></div></div>`;
  }
  if (S.positions.some(p => !p.rate) && emps.some(e => !rateNow(e))) {
    html += `<div class="banner info"><div class="grow"><b>Не у всех задана ставка</b>Укажите ставку за день в должностях — зарплата считается по ней.</div><button class="btn small" data-act="positions">Указать</button></div>`;
  }

  const main = [], off = [];
  emps.forEach(e => (L.planned(e, date) === false ? off : main).push(e));
  const stOf = e => (L.getRec(S.att, e.id, date) || {}).s;
  const came = emps.filter(e => stOf(e) === 'w').length;
  const unmarked = main.filter(e => !stOf(e)).length;
  const absent = main.filter(e => stOf(e) === 'a').length;

  html += `<div class="card pad"><div class="summary"><span class="big">${came}</span><span class="of">вышли · по графику ${main.length}</span></div>
    <div class="chips">${unmarked ? `<span class="chip warn">не отмечено: ${unmarked}</span>` : '<span class="chip ok">все отмечены</span>'}${absent ? `<span class="chip bad">прогул: ${absent}</span>` : ''}</div></div>`;

  const dues = dueList();
  if (dues.length) {
    const sum = dues.reduce((s, e) => s + L.payoutSuggest(S, e, tdy, S.settings.payEvery).amount, 0);
    html += `<div class="banner info"><div class="grow"><b>Пора платить: ${dues.length} ${plural(dues.length, 'сотрудник', 'сотрудника', 'сотрудников')}</b>Всего ${money(sum)}</div>
      <button class="btn small primary" data-act="tab" data-tab="pay">Открыть</button></div>`;
  }

  html += `<h3>По графику работают (${main.length})</h3>`;
  if (main.length) {
    html += `<div class="card">${main.map(e => empRow(e, date)).join('')}</div>`;
    if (unmarked && date <= tdy) html += `<button class="btn big flat" data-act="markAll">Отметить всех неотмеченных: вышли (${unmarked})</button>`;
  } else html += `<div class="card empty">На этот день никого нет по графику</div>`;

  if (off.length) {
    html += `<h3 data-act="toggleOff" style="cursor:pointer">Выходной по графику (${off.length}) ${ui.showOff ? '▾' : '▸'}</h3>`;
    if (ui.showOff) html += `<div class="card">${off.map(e => empRow(e, date)).join('')}</div>`;
  }
  return html;
}

/* ================= Экран «Табель» ================= */
function visibleEmps(ym) {
  return S.employees.filter(e => e.active !== false || Object.keys(S.att[e.id] || {}).some(d => d.startsWith(ym)));
}
function viewSheet() {
  const ym = ui.month, [y, m] = ym.split('-').map(Number), n = L.daysInMonth(y, m), tdy = L.today();
  const emps = visibleEmps(ym);
  let html = `<div class="navbar"><button class="iconbtn" data-act="month" data-d="-1">‹</button>
    <div class="lbl">${monthLabel(ym)}<small>Табель выходов</small></div>
    <button class="iconbtn" data-act="month" data-d="1">›</button></div>`;
  if (!emps.length) return html + `<div class="card empty">Добавьте сотрудников на вкладке «Люди»</div>`;

  const dates = Array.from({ length: n }, (_, i) => ym + '-' + L.pad2(i + 1));
  const head = dates.map(d => {
    const wd = L.weekday(d);
    return `<th class="${wd === 0 || wd === 6 ? 'wknd' : ''} ${d === tdy ? 'today' : ''}"><b>${+d.slice(8)}</b>${WD_SHORT[wd]}</th>`;
  }).join('');
  const footCounts = dates.map(() => 0);
  const body = emps.map(e => {
    let tot = 0;
    const cells = dates.map((d, i) => {
      const rec = L.getRec(S.att, e.id, d);
      let cls = '', g = '';
      if (rec) { cls = rec.s; g = ST[rec.s].short; if (rec.s === 'w') { tot++; footCounts[i]++; } }
      else if (e.hired && d < e.hired) return '<td></td>';
      else { const p = L.planned(e, d); cls = p === true ? 'plan' : p === false ? 'offp' : ''; if (p === false) g = '·'; }
      return `<td class="${d > tdy ? 'fut' : ''}"><button class="cell ${cls}" data-act="dayMenu" data-emp="${e.id}" data-date="${d}">${g}</button></td>`;
    }).join('');
    return `<tr><td class="nm" data-act="empDetail" data-emp="${e.id}">${esc(shortName(e.name))}</td>${cells}<td class="tot">${tot}</td></tr>`;
  }).join('');
  html += `<div class="matrix-wrap"><table class="matrix"><thead><tr><th class="nm" style="text-align:left">Сотрудник</th>${head}<th class="tot">Дни</th></tr></thead>
    <tbody>${body}</tbody><tfoot><tr><td class="nm">Вышло</td>${footCounts.map(c => `<td>${c || ''}</td>`).join('')}<td></td></tr></tfoot></table></div>`;
  html += `<div class="legend">${Object.entries(ST).map(([k, v]) => `<span><span class="cell ${k}">${v.short}</span>${v.label}</span>`).join('')}
    <span><span class="cell plan"></span>по графику, не отмечен</span></div>
    <button class="btn big flat" data-act="csvSheet">Скачать табель (Excel)</button>`;
  return html;
}

/* ================= Экран «Зарплата» ================= */
function viewPay() {
  const tdy = L.today(), N = S.settings.payEvery;
  let html = `<div class="topbar"><h1>Зарплата</h1></div>
    <div class="segtabs"><button class="${ui.salView === 'due' ? 'on' : ''}" data-act="salView" data-v="due">К выплате</button>
    <button class="${ui.salView === 'report' ? 'on' : ''}" data-act="salView" data-v="report">Отчёт</button>
    <button class="${ui.salView === 'stats' ? 'on' : ''}" data-act="salView" data-v="stats">Итоги</button></div>`;
  if (ui.salView === 'report') return html + reportHtml();
  if (ui.salView === 'stats') return html + statsHtml();

  const rows = S.employees.map(e => ({ e, bal: balance(e.id), d: L.dueInfo(S, e, tdy, N) }))
    .filter(r => r.e.active !== false || Math.abs(r.bal) > 0.5);
  if (!rows.length) return html + `<div class="card empty">Добавьте сотрудников на вкладке «Люди»</div>`;
  rows.sort((a, b) => (b.d.due - a.d.due) || b.bal - a.bal);
  const total = rows.reduce((s, r) => s + Math.max(0, r.bal), 0);
  const ym = tdy.slice(0, 7);
  const paidM = S.payments.filter(p => (p.type === 'pay' || p.type === 'adv') && p.date.startsWith(ym)).reduce((s, p) => s + p.amount, 0);
  html += `<div class="stat-grid"><div class="stat"><div class="k">Должен выплатить</div><div class="v">${money(total)}</div></div>
    <div class="stat"><div class="k">Выплачено в этом месяце</div><div class="v">${money(paidM)}</div></div></div>`;
  const dim = L.daysInMonth(+tdy.slice(0, 4), +tdy.slice(5, 7));
  html += `<div class="card">` + rows.map(({ e, bal, d }) => {
    const due = d.due;
    const sub = d.monthly
      ? (due ? `<b style="color:var(--warn)">оклад по ${fmtShort(d.through)} — пора платить</b>` : `оклад ${money(rateNow(e))}/мес · начислено на сегодня`)
      : (due ? `<b style="color:var(--warn)">${days(d.days)} — пора платить</b>` : `${d.days} из ${N} дн. до выплаты`);
    const pct = due ? 100 : d.monthly ? +tdy.slice(8) / dim * 100 : d.days / N * 100;
    return `<div class="row tap" data-act="empDetail" data-emp="${e.id}">${avatar(e)}
      <div class="grow"><div class="name">${esc(e.name)}${e.active === false ? ' <span class="chip">уволен</span>' : ''}</div>
        <div class="sub">${sub}</div>
        <div class="progress ${due ? 'due' : ''}"><i style="width:${Math.min(100, pct)}%"></i></div></div>
      <div style="text-align:right"><div class="amt ${bal < 0 ? 'minus' : ''}">${money(bal)}</div>
        ${bal >= 0.5 ? `<button class="btn small ${due ? 'primary' : ''}" style="margin-top:4px" data-act="money" data-emp="${e.id}" data-type="pay">Выплатить</button>` : ''}</div></div>`;
  }).join('') + '</div>';
  return html;
}

function reportHtml() {
  const ym = ui.month, rows = L.monthReport(S, ym);
  let html = `<div class="navbar"><button class="iconbtn" data-act="month" data-d="-1">‹</button><div class="lbl">${monthLabel(ym)}</div><button class="iconbtn" data-act="month" data-d="1">›</button></div>`;
  if (!rows.length) return html + `<div class="card empty">За этот месяц нет данных</div>`;
  const t = rows.reduce((a, r) => (a.days += r.days, a.earned += r.earned, a.paid += r.paid, a.bonus += r.bonus, a.fine += r.fine, a), { days: 0, earned: 0, paid: 0, bonus: 0, fine: 0 });
  html += `<div class="stat-grid"><div class="stat"><div class="k">Начислено</div><div class="v">${money(t.earned)}</div></div>
    <div class="stat"><div class="k">Выплачено</div><div class="v">${money(t.paid)}</div></div></div>
    <div class="card">` + rows.map(r => `<div class="row tap" data-act="empDetail" data-emp="${r.emp.id}">
      <div class="grow"><div class="name">${esc(r.emp.name)}</div>
      <div class="sub">${r.monthly ? 'оклад' : days(r.days)} · начислено ${money(r.earned)}${r.bonus ? ` · премии +${money(r.bonus)}` : ''}${r.fine ? ` · штрафы −${money(r.fine)}` : ''}${r.absent ? ` · прогулов ${r.absent}` : ''}</div></div>
      <div style="text-align:right"><div class="amt">${money(r.paid)}</div><div class="sub">выплачено</div></div></div>`).join('') + '</div>' +
    `<button class="btn big flat" data-act="csvReport">Скачать отчёт (Excel)</button>`;
  return html;
}

/* ================= Итоги по магазину ================= */
const MON_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const niceMax = v => {
  if (v <= 0) return 1000;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
};
const compact = n => n >= 1e6 ? nf.format(Math.round(n / 1e5) / 10) + ' млн' : n >= 1000 ? nf.format(Math.round(n / 100) / 10) + ' тыс' : String(Math.round(n));

// Столбики: фонд оплаты труда по месяцам. Один ряд данных — одна краска, значение подписано только у выбранного месяца.
function fotChart(series, sel) {
  const top = niceMax(Math.max(0, ...series.map(s => s.fot)));
  const cols = series.map(s => {
    const on = s.ym === sel, pct = s.fot > 0 ? Math.max(s.fot / top * 100, 1.5) : 0;
    return `<button class="col ${on ? 'on' : ''}" data-act="statMonth" data-ym="${s.ym}" aria-label="${monthLabel(s.ym)}: ${money(s.fot)}">
      ${on && s.fot > 0 ? `<span class="val" style="bottom:calc(${pct}% + 4px)">${compact(s.fot)}</span>` : ''}<i class="bar" style="height:${pct}%"></i></button>`;
  }).join('');
  const grid = [0, 0.5, 1].map(f => `<div class="gl" style="bottom:${f * 100}%"><span>${f ? compact(top * f) : '0'}</span></div>`).join('');
  const xl = series.map(s => `<span class="${s.ym === sel ? 'on' : ''}">${MON_SHORT[+s.ym.slice(5) - 1]}</span>`).join('');
  return `<div class="chart"><div class="plot">${grid}<div class="cols">${cols}</div></div><div class="xlab">${xl}</div></div>`;
}

function statsHtml() {
  const ym = ui.month, tdy = L.today(), cur = tdy.slice(0, 7), N = S.settings.perDay;
  const st = L.storeStats(S, ym, tdy, N);
  const end = ym < L.addMonths(cur, -5) ? L.addMonths(ym, 5) : cur;
  const series = L.fotSeries(S, end, 6, tdy);
  const debt = S.employees.reduce((s, e) => s + Math.max(0, balance(e.id)), 0);
  const avg = st.elapsed ? nf.format(Math.round(st.avg * 10) / 10) + ' чел.' : '—';
  let html = `<div class="navbar"><button class="iconbtn" data-act="month" data-d="-1">‹</button><div class="lbl">${monthLabel(ym)}<small>Итоги по магазину</small></div><button class="iconbtn" data-act="month" data-d="1">›</button></div>`;

  html += `<div class="card pad"><div class="sub">Фонд оплаты труда</div><div class="hero">${money(st.fot)}</div>
    <div class="sub">начислено ${money(st.earned)}${st.bonus ? ` · премии +${money(st.bonus)}` : ''}${st.fine ? ` · штрафы −${money(st.fine)}` : ''}</div></div>
    <div class="stat-grid" style="margin-top:10px">
      <div class="stat"><div class="k">Выплачено за месяц</div><div class="v">${money(st.paid)}</div></div>
      <div class="stat"><div class="k">Должны сотрудникам сейчас</div><div class="v">${money(debt)}</div></div>
      <div class="stat"><div class="k">Средняя явка в день</div><div class="v">${avg}</div><div class="sub">нужно ${N}</div></div>
      <div class="stat"><div class="k">Дней с нехваткой людей</div><div class="v">${st.elapsed ? st.below + ' из ' + st.elapsed : '—'}</div><div class="sub">вышло меньше ${N}</div></div></div>`;

  html += `<h3>Фонд оплаты труда по месяцам</h3><div class="card pad">${fotChart(series, ym)}
    <details class="tbl"><summary>Показать таблицей</summary>${series.map(s => `<div class="hist"><div class="grow">${monthLabel(s.ym)}</div>
      <div class="amt">${money(s.fot)}</div><div class="sub" style="min-width:104px;text-align:right">выплачено ${compact(s.paid)}</div></div>`).join('')}</details></div>`;

  if (st.byPos.length) {
    const mx = Math.max(...st.byPos.map(p => p.amount), 1);
    html += `<h3>По должностям</h3><div class="card">` + st.byPos.map(p => `<div class="row"><div class="grow">
      <div class="name">${esc(p.name)}</div><div class="sub">${p.staff} ${plural(p.staff, 'сотрудник', 'сотрудника', 'сотрудников')}${st.fot > 0 ? ' · ' + Math.round(p.amount / st.fot * 100) + '%' : ''}</div>
      <div class="share"><i style="width:${Math.max(0, p.amount) / mx * 100}%"></i></div></div><div class="amt">${money(p.amount)}</div></div>`).join('') + '</div>';
  }

  html += `<h3>Пропуски · прогулы ${st.absent}, больничные ${st.sick}, отпуск ${st.vac}</h3>`;
  html += st.absences.length
    ? `<div class="card">` + st.absences.map(a => `<div class="row tap" data-act="empDetail" data-emp="${a.emp.id}"><div class="grow"><div class="name">${esc(a.emp.name)}</div></div>
        <div>${a.absent ? `<span class="chip bad">прогулы ${a.absent}</span> ` : ''}${a.sick ? `<span class="chip warn">больничный ${a.sick}</span> ` : ''}${a.vac ? `<span class="chip info">отпуск ${a.vac}</span>` : ''}</div></div>`).join('') + '</div>'
    : `<div class="card empty">В этом месяце пропусков нет</div>`;
  return html;
}

/* ================= Экран «Люди» ================= */
function viewStaff() {
  const act = activeEmps(), fired = S.employees.filter(e => e.active === false), tdy = L.today();
  let html = `<div class="topbar"><h1>Люди</h1><button class="btn primary small" data-act="editEmp" data-id="new">+ Сотрудник</button></div>`;
  if (act.length) {
    const target = S.settings.perDay;
    html += `<div class="sub" style="margin:0 4px 6px">Сколько человек по графику в ближайшие дни (нужно ${target}):</div><div class="weekstrip">` +
      Array.from({ length: 7 }, (_, i) => {
        const d = L.addDays(tdy, i), n = act.filter(e => L.planned(e, d) === true).length;
        return `<div class="wd ${n === target ? 'ok' : n < target ? 'low' : 'high'}"><small>${WD_SHORT[L.weekday(d)]} ${+d.slice(8)}</small><b>${n}</b></div>`;
      }).join('') + '</div>';
  }
  const row = e => {
    const p = L.planned(e, tdy);
    return `<div class="row tap" data-act="editEmp" data-id="${e.id}">${avatar(e)}
      <div class="grow"><div class="name">${esc(e.name)}</div><div class="sub">${esc(posName(e))} · ${schedLabel(e)} · ${rateLabel(e)}</div></div>
      ${p === true ? '<span class="chip ok">сегодня</span>' : p === false ? '<span class="chip">выходной</span>' : ''}</div>`;
  };
  html += `<h3>Работают (${act.length})</h3>` + (act.length ? `<div class="card">${act.map(row).join('')}</div>` : `<div class="card empty">Никого нет. Нажмите «+ Сотрудник».</div>`);
  if (fired.length) html += `<h3>Уволенные (${fired.length})</h3><div class="card">${fired.map(row).join('')}</div>`;
  return html;
}

/* ================= Экран «Ещё» ================= */
function viewMore() {
  const item = (act, t, sub) => `<button class="menu-item" data-act="${act}"><div class="grow"><div>${t}</div><div class="sub">${sub}</div></div><span class="chev">›</span></button>`;
  return `<div class="topbar"><h1>Ещё</h1></div><div class="card">
    ${item('branding', 'Название и логотип', esc(S.settings.shopName || ''))}
    ${item('positions', 'Должности и ставки', 'Оплата за день по должностям')}
    ${item('settings', 'Настройки', `Выплата каждые ${S.settings.payEvery} дн., PIN-код, ${S.settings.perDay} чел. в смену`)}
    ${item('backup', 'Резервная копия', S.meta.lastBackup ? 'Последняя: ' + fmtShort(localIso(S.meta.lastBackup)) : 'Ещё не делалась')}
    ${item('install', 'Как установить на iPhone', 'Иконка на экране «Домой»')}
  </div><div class="sub" style="text-align:center;margin-top:18px">Данные хранятся только на этом телефоне.</div>`;
}

const VIEWS = { today: viewToday, sheet: viewSheet, pay: viewPay, staff: viewStaff, more: viewMore };

function render() {
  const v = $('#view'), top = v.scrollTop;
  const old = $('.matrix-wrap'), left = old && !ui.matrixFresh ? old.scrollLeft : null;
  v.innerHTML = VIEWS[ui.tab]();
  v.scrollTop = top;
  const mw = $('.matrix-wrap');
  if (mw) {
    if (left !== null) mw.scrollLeft = left;
    else {
      const th = $('.matrix th.today');
      mw.scrollLeft = th ? Math.max(0, th.offsetLeft - 140) : 0;
      ui.matrixFresh = false;
    }
  }
  renderTabs();
}

/* ================= Окна: день, сотрудник, деньги ================= */
function dayMenu(empId, date) {
  const e = getEmp(empId), cur = (L.getRec(S.att, empId, date) || {}).s;
  const rec = L.getRec(S.att, empId, date);
  openSheet(esc(e.name), `<div class="sub" style="margin:-4px 0 12px">${fmtLong(date)}${rec && rec.s === 'w' ? ` · ${money(rec.r)}` : ''}</div>
    <div class="card">` + Object.entries(ST).map(([k, v]) =>
      `<button class="menu-item" data-act="setDay" data-emp="${empId}" data-date="${date}" data-st="${k}"><span class="chip ${v.cls}" style="min-width:26px;text-align:center">${v.short}</span>
      <div class="grow">${v.label}${k === 'w' && !isMonthly(e) ? ` <span class="sub">· ${money(rateNow(e))}</span>` : ''}</div>${cur === k ? '✓' : ''}</button>`).join('') +
    `</div>${cur ? `<button class="btn big flat danger" data-act="setDay" data-emp="${empId}" data-date="${date}" data-st="">Снять отметку</button>` : ''}`);
}

function empDetail(empId) {
  const e = getEmp(empId); if (!e) return closeSheet();
  const tdy = L.today(), bal = balance(empId), d = L.dueInfo(S, e, tdy, S.settings.payEvery);
  const ym = tdy.slice(0, 7);
  const mrow = L.monthReport(S, ym).find(r => r.emp.id === empId);
  const pays = S.payments.filter(p => p.empId === empId).sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts);
  openSheet(esc(e.name), `<div class="sub" style="margin:-4px 0 12px">${esc(posName(e))} · ${rateLabel(e)} · ${schedLabel(e)}</div>
    <div class="stat-grid"><div class="stat"><div class="k">К выплате сейчас</div><div class="v" style="${bal < 0 ? 'color:var(--bad)' : ''}">${money(bal)}</div></div>
      ${d.monthly ? `<div class="stat"><div class="k">Оклад в месяц</div><div class="v">${money(rateNow(e))}</div></div>`
        : `<div class="stat"><div class="k">Дней без выплаты</div><div class="v">${d.days}<span class="sub"> / ${S.settings.payEvery}</span></div></div>`}
      <div class="stat"><div class="k">В этом месяце вышел</div><div class="v">${mrow ? mrow.days : 0} дн.</div></div>
      <div class="stat"><div class="k">Начислено в месяце</div><div class="v">${money(mrow ? mrow.earned : 0)}</div></div></div>
    <div class="btn-row"><button class="btn primary" data-act="money" data-emp="${empId}" data-type="pay" data-back="1">Выплата</button>
      <button class="btn" data-act="money" data-emp="${empId}" data-type="adv" data-back="1">Аванс</button>
      <button class="btn" data-act="money" data-emp="${empId}" data-type="bonus" data-back="1">Премия</button>
      <button class="btn danger" data-act="money" data-emp="${empId}" data-type="fine" data-back="1">Штраф</button></div>
    <h3>История</h3>` + (pays.length ? `<div class="card pad" style="padding-top:4px;padding-bottom:4px">` + pays.map(p => {
      const sign = p.type === 'bonus' ? 'plus' : p.type === 'fine' ? 'minus' : '';
      return `<div class="hist"><div class="grow"><b>${p.type === 'pay' ? 'Выплата' : PAY_TYPES[p.type]}</b> · ${fmtShort(p.date)}
        <div class="sub">${p.type === 'pay' && p.through ? 'закрыто по ' + fmtShort(p.through) : ''}${p.note ? (p.type === 'pay' && p.through ? ' · ' : '') + esc(p.note) : ''}</div></div>
        <div class="amt ${sign}">${p.type === 'bonus' ? '+' : p.type === 'fine' ? '−' : ''}${money(p.amount)}</div>
        <button class="x" data-act="delPay" data-id="${p.id}" data-emp="${empId}" aria-label="Удалить">✕</button></div>`;
    }).join('') + '</div>' : `<div class="card empty">Выплат пока не было</div>`) +
    `<button class="btn big flat" data-act="editEmp" data-id="${empId}">Изменить данные сотрудника</button>`);
}

function moneySheet(empId, type, back) {
  const e = getEmp(empId), tdy = L.today(), bal = balance(empId);
  const sg = L.payoutSuggest(S, e, tdy, S.settings.payEvery), d = sg.info;
  let amount = '', through = '', hint = '';
  if (type === 'pay') {
    amount = Math.round(sg.amount); through = sg.through;
    hint = d.monthly
      ? `Оклад ${money(rateNow(e))}/мес. Начислено на сегодня: <b>${money(bal)}</b>. ${d.due ? `Предлагаю выплатить оклад по ${fmtShort(d.through)}: этот месяц уже закрыт.` : 'Месяц ещё не закончился: можно выплатить всё начисленное или часть.'}`
      : `Сейчас должны: <b>${money(bal)}</b>. Отработано без выплаты: ${days(d.days)} (${money(d.amount)}).`;
  } else if (type === 'adv') hint = 'Аванс уменьшает сумму к выплате, но не закрывает рабочие дни.';
  else if (type === 'bonus') hint = 'Премия добавляется к сумме к выплате.';
  else hint = 'Штраф вычитается из суммы к выплате.';
  openSheet(PAY_TYPES[type] + ' — ' + esc(e.name), `<form data-form="money" data-emp="${empId}" data-type="${type}" data-back="${back || ''}">
    <div class="hint">${hint}</div>
    <label class="f">Сумма, ${esc(S.settings.currency)}<input name="amount" type="number" inputmode="decimal" step="any" min="0" required value="${amount}"></label>
    <div class="two"><label class="f">Дата<input name="date" type="date" required value="${tdy}"></label>
    ${type === 'pay' ? `<label class="f">${d.monthly ? 'Закрывает оклад по' : 'Закрывает дни по'}<input name="through" type="date" required value="${through}"></label>` : '<div></div>'}</div>
    <label class="f">Комментарий (необязательно)<input name="note" type="text" maxlength="120"></label>
    <button class="btn primary big">Записать</button></form>`);
}

/* ================= Формы: сотрудник, должность, настройки ================= */
function cycleOptions(sched, sel) {
  const sc = L.SCHEDULES[sched]; if (!sc) return '<option value="0">— графика нет —</option>';
  const c = sc.work + sc.off;
  return Array.from({ length: c }, (_, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${i < sc.work ? `Сегодня ${i + 1}-й рабочий день из ${sc.work}` : `Сегодня ${i - sc.work + 1}-й выходной из ${sc.off}`}</option>`).join('');
}
function editEmp(id) {
  const isNew = id === 'new';
  const e = isNew ? { name: '', phone: '', positionId: S.positions[0] && S.positions[0].id, rate: null, schedule: '2/2', start: L.today(), hired: L.today(), active: true } : getEmp(id);
  const idx = L.cycleIndex(e, L.today()) || 0;
  openSheet(isNew ? 'Новый сотрудник' : 'Сотрудник', `<form data-form="emp" data-id="${isNew ? '' : id}">
    <label class="f">ФИО<input name="name" required value="${esc(e.name)}" autocomplete="off"></label>
    <label class="f">Телефон<input name="phone" type="tel" value="${esc(e.phone)}"></label>
    <label class="f">Должность<select name="positionId" data-role="pos">${S.positions.map(p => `<option value="${p.id}" data-pay="${p.pay || 'day'}" ${p.id === e.positionId ? 'selected' : ''}>${esc(p.name)} — ${money(p.rate)}${p.pay === 'month' ? '/мес' : '/день'}</option>`).join('')}</select></label>
    <label class="f">Своя ставка (за день или оклад за месяц — как у должности), если отличается<input name="rate" type="number" inputmode="decimal" step="any" min="0" value="${e.rate == null ? '' : e.rate}" placeholder="по должности"></label>
    <div id="payfrom-wrap" ${isMonthly(e) ? '' : 'hidden'}><label class="f">Начислять оклад с даты<input name="payFrom" type="date" value="${e.payFrom || L.today()}"></label>
    <div class="hint">Оклад накапливается по дням с этой даты. Если раньше вы платили вне приложения, оставьте сегодняшнюю дату — прошлое не попадёт в долг.</div></div>
    <label class="f">График<select name="schedule" data-role="sched">${Object.keys(L.SCHEDULES).map(k => `<option value="${k}" ${k === e.schedule ? 'selected' : ''}>${k === 'free' ? 'Свободный (без графика)' : k}</option>`).join('')}</select></label>
    <label class="f">Где сотрудник в графике<select name="cycle">${cycleOptions(e.schedule, idx)}</select></label>
    <div class="hint">Чтобы каждый день выходило поровну, ставьте половине сотрудников «1-й рабочий день», а другой половине «1-й выходной» (для 2/2). Сколько человек по графику — видно на вкладке «Люди».</div>
    <div class="two"><label class="f">Дата приёма<input name="hired" type="date" value="${e.hired || ''}"></label>
    <label class="f">Статус<select name="active"><option value="1" ${e.active !== false ? 'selected' : ''}>Работает</option><option value="0" ${e.active === false ? 'selected' : ''}>Уволен</option></select></label></div>
    <button class="btn primary big">Сохранить</button>
    ${isNew ? '' : `<button type="button" class="btn big flat danger" data-act="delEmp" data-id="${id}">Удалить сотрудника</button>`}</form>`);
}

function editPos(id) {
  const isNew = id === 'new', p = isNew ? { name: '', rate: '', pay: 'day' } : S.positions.find(x => x.id === id);
  const used = S.employees.filter(e => e.positionId === id).length;
  openSheet(isNew ? 'Новая должность' : 'Должность', `<form data-form="pos" data-id="${isNew ? '' : id}">
    <label class="f">Название<input name="name" required value="${esc(p.name)}"></label>
    <label class="f">Как оплачивается<select name="pay"><option value="day" ${p.pay !== 'month' ? 'selected' : ''}>За каждый отработанный день</option><option value="month" ${p.pay === 'month' ? 'selected' : ''}>Фиксированный оклад за месяц</option></select></label>
    <label class="f">Сумма, ${esc(S.settings.currency)} (за день или за месяц — по выбранному способу)<input name="rate" type="number" inputmode="decimal" step="any" min="0" required value="${p.rate}"></label>
    ${isNew ? '' : `<label class="f">Изменения действуют с даты<input name="from" type="date" value="${L.today()}"></label>
    <div class="hint">${p.rate ? 'За даты до этого дня останется прежняя сумма.' : 'Сумма сейчас 0 — при сохранении она применится ко всем уже отмеченным дням.'} Способ оплаты лучше не менять, когда по должности уже идут начисления.</div>`}
    <button class="btn primary big">Сохранить</button>
    ${isNew ? '' : `<button type="button" class="btn big flat danger" data-act="delPos" data-id="${id}">${used ? `Удалить (используется: ${used})` : 'Удалить'}</button>`}</form>`);
}
function positionsSheet() {
  openSheet('Должности и ставки', `<div class="card">${S.positions.map(p => `<button class="menu-item" data-act="editPos" data-id="${p.id}">
    <div class="grow"><div>${esc(p.name)}</div><div class="sub">${S.employees.filter(e => e.positionId === p.id && e.active !== false).length} чел.${p.pay === 'month' ? ' · оклад за месяц' : ''}</div></div>
    <b class="amt" style="${p.rate ? '' : 'color:var(--warn)'}">${p.rate ? money(p.rate) + (p.pay === 'month' ? '/мес' : '/день') : 'указать ставку'}</b><span class="chev">›</span></button>`).join('')}</div>
    <button class="btn big primary" data-act="editPos" data-id="new">+ Должность</button>`);
}

function brandingSheet() {
  openSheet('Название и логотип', `<form data-form="brand">
    <div style="display:flex;justify-content:center;margin:4px 0 14px"><img src="${logoSrc()}" alt="" style="width:96px;height:96px;border-radius:22px;object-fit:cover;box-shadow:var(--shadow)"></div>
    <label class="f">Название магазина<input name="shopName" required maxlength="40" value="${esc(S.settings.shopName)}"></label>
    <button class="btn primary big">Сохранить название</button></form>
    <button class="btn big flat" data-act="pickLogo">Загрузить свой логотип</button>
    ${S.settings.logo ? '<button class="btn big flat danger" data-act="resetLogo">Вернуть стандартный логотип</button>' : ''}
    <div class="hint" style="margin-top:12px">Логотип показывается в шапке и на экране PIN. Иконка на экране «Домой» задаётся при установке — её можно заменить, если прислать файл логотипа.</div>`);
}
function setLogo(file) {
  const img = new Image(), url = URL.createObjectURL(file);
  img.onload = () => {
    const s = 256, c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d'), k = Math.max(s / img.width, s / img.height);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
    g.drawImage(img, (s - img.width * k) / 2, (s - img.height * k) / 2, img.width * k, img.height * k);
    URL.revokeObjectURL(url);
    S.settings.logo = c.toDataURL('image/jpeg', 0.85); save(); brandingSheet(); render(); toast('Логотип обновлён');
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('Не удалось открыть картинку'); };
  img.src = url;
}

function settingsSheet() {
  const s = S.settings;
  openSheet('Настройки', `<form data-form="settings">
    <label class="f">Валюта<input name="currency" value="${esc(s.currency)}" maxlength="6"></label>
    <label class="f">Выплата каждые N рабочих дней<input name="payEvery" type="number" inputmode="numeric" min="1" max="31" required value="${s.payEvery}"></label>
    <label class="f">Сколько человек нужно в смену<input name="perDay" type="number" inputmode="numeric" min="1" max="200" required value="${s.perDay}"></label>
    <button class="btn primary big">Сохранить</button></form>
    <h3>Защита</h3><div class="card">
    <button class="menu-item" data-act="setPin"><div class="grow">${s.pinHash ? 'Сменить PIN-код' : 'Включить PIN-код'}</div><span class="chev">›</span></button>
    ${s.pinHash ? `<button class="menu-item" data-act="clearPin"><div class="grow" style="color:var(--bad)">Отключить PIN-код</div></button>` : ''}</div>
    <div class="sub" style="margin:8px 4px">PIN закрывает приложение на экране. Он не шифрует данные — для сохранности используйте резервные копии.</div>`);
}
function pinSheet() {
  openSheet('PIN-код', `<form data-form="pin"><label class="f">Новый PIN (4 цифры)<input name="p1" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required></label>
    <label class="f">Повторите PIN<input name="p2" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required></label>
    <button class="btn primary big">Включить</button></form>`);
}

function backupSheet() {
  const t = S.meta.lastBackup;
  openSheet('Резервная копия', `<div class="hint">Копия — это файл со всеми данными. Сохраните его в «Файлы» или отправьте себе в мессенджер. Если телефон потеряется или приложение удалят, данные можно вернуть из файла.<br><br>Последняя копия: <b>${t ? fmtShort(localIso(t)) : 'нет'}</b></div>
    <button class="btn primary big" data-act="exportJson">Сохранить копию</button>
    <button class="btn big flat" data-act="importJson">Восстановить из файла</button>
    ${S.employees.length ? '' : `<button class="btn big flat" data-act="demo">Загрузить демо-данные</button>`}
    <button class="btn big flat danger" data-act="resetAll">Стереть все данные</button>`);
}
function installSheet() {
  openSheet('Установка на iPhone', `<div class="card pad"><ol style="margin:0;padding-left:20px;line-height:1.7">
    <li>Откройте ссылку на приложение в <b>Safari</b>.</li><li>Нажмите кнопку «Поделиться» (квадрат со стрелкой).</li>
    <li>Выберите «На экран “Домой”» и нажмите «Добавить».</li><li>Запускайте приложение <b>с иконки на экране</b>.</li></ol></div>
    <div class="banner" style="margin-top:12px"><div class="grow"><b>Важно</b>Вводите данные только после установки на экран «Домой». Данные из Safari и из иконки хранятся отдельно.</div></div>`);
}

/* ================= Файлы: резервная копия и Excel ================= */
async function saveFile(name, mime, text) {
  const blob = new Blob([text], { type: mime });
  try {
    const file = new File([blob], name, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return true;
    }
  } catch (err) { if (err && err.name === 'AbortError') return false; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  return true;
}
const csvCell = v => { const s = String(v == null ? '' : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = rows => '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');

function csvReport() {
  const ym = ui.month, rows = L.monthReport(S, ym);
  const data = [['Сотрудник', 'Должность', 'Дней вышел', 'Начислено', 'Премии', 'Штрафы', 'Выплачено', 'Прогулы', 'Больничные', 'Отпуск', 'Остаток к выплате (всего)']]
    .concat(rows.map(r => [r.emp.name, posName(r.emp), r.days, r.earned, r.bonus, r.fine, r.paid, r.absent, r.sick, r.vac, r.balance]));
  saveFile(`Зарплата_${ym}.csv`, 'text/csv', csv(data));
}
function csvSheet() {
  const ym = ui.month, [y, m] = ym.split('-').map(Number), n = L.daysInMonth(y, m);
  const dates = Array.from({ length: n }, (_, i) => ym + '-' + L.pad2(i + 1));
  const code = { w: 'В', a: 'П', o: 'Вых', s: 'Б', v: 'О' };
  const data = [['Сотрудник'].concat(dates.map(d => +d.slice(8)), ['Итого дней'])];
  visibleEmps(ym).forEach(e => {
    let t = 0;
    data.push([e.name].concat(dates.map(d => { const r = L.getRec(S.att, e.id, d); if (r && r.s === 'w') t++; return r ? code[r.s] : ''; }), [t]));
  });
  saveFile(`Табель_${ym}.csv`, 'text/csv', csv(data));
}
async function exportJson() {
  const ok = await saveFile(`персонал-копия-${L.today()}.json`, 'application/json', JSON.stringify(S, null, 1));
  if (ok) { S.meta.lastBackup = Date.now(); save(); toast('Копия сохранена'); backupSheet(); render(); }
}
function importJson(text) {
  let d;
  try { d = JSON.parse(text); } catch (e) { return toast('Файл повреждён'); }
  if (!d || !Array.isArray(d.employees) || !Array.isArray(d.positions) || typeof d.att !== 'object') return toast('Это не файл копии приложения');
  if (!confirm(`Заменить текущие данные данными из файла?\nСотрудников в файле: ${d.employees.length}`)) return;
  S = Object.assign(defaults(), d);
  S.settings = Object.assign(defaults().settings, d.settings);
  save(); closeSheet(); render(); toast('Данные восстановлены');
}

/* ================= Демо-данные ================= */
function loadDemo() {
  if (S.employees.length && !confirm('Добавить демо-данные к существующим?')) return;
  const rates = { 'Продавец': 1500, 'Кассир': 1600, 'Грузчик': 1400, 'Администратор': 45000, 'Уборщица': 1000 };
  S.positions.forEach(p => { if (!p.rate && rates[p.name]) p.rate = rates[p.name]; if (p.name === 'Администратор') p.pay = 'month'; });
  const P = n => (S.positions.find(p => p.name === n) || S.positions[0]).id;
  const tdy = L.today();
  const people = [['Иванова Мария', 'Продавец', '2/2', 0], ['Петров Алексей', 'Продавец', '2/2', 2], ['Сидорова Анна', 'Кассир', '2/2', 1],
    ['Козлов Дмитрий', 'Грузчик', '2/2', 3], ['Смирнова Ольга', 'Продавец', '2/2', 2], ['Морозов Игорь', 'Грузчик', '3/3', 1],
    ['Волкова Елена', 'Кассир', '2/2', 0], ['Новиков Сергей', 'Продавец', '3/3', 4], ['Фёдорова Ирина', 'Уборщица', '2/2', 1],
    ['Кузнецов Павел', 'Администратор', '6/1', 2]];
  const added = people.map(([name, pos, sched, idx]) => {
    const e = { id: uid(), name, phone: '', positionId: P(pos), rate: null, schedule: sched, start: L.addDays(tdy, -idx), hired: L.addDays(tdy, -40), payFrom: L.addDays(tdy, -40), active: true };
    S.employees.push(e); return e;
  });
  let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  added.forEach(e => {
    S.att[e.id] = {};
    for (let i = 20; i >= 1; i--) {
      const d = L.addDays(tdy, -i), p = L.planned(e, d);
      if (p) S.att[e.id][d] = rnd() < 0.94 ? { s: 'w', r: L.dayRate(e, S.positions) } : { s: 'a' };
    }
  });
  added.slice(0, 5).forEach(e => {
    const w = L.workedDates(S.att, e.id);
    if (w.length >= 10) {
      const through = w[4], a = S.att[e.id];
      S.payments.push({ id: uid(), empId: e.id, type: 'pay', amount: w.slice(0, 5).reduce((s, d) => s + a[d].r, 0), date: L.addDays(through, 1), through, note: '', ts: Date.now() });
    }
  });
  save(); closeSheet(); render(); toast('Демо-данные добавлены');
}

/* ================= Блокировка PIN ================= */
async function hashPin(p) {
  try {
    if (window.crypto && crypto.subtle) {
      const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('shopstaff:' + p));
      return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) {}
  return 'plain:' + p;
}
let pinBuf = '';
function showLock() {
  if (!S.settings.pinHash) return;
  pinBuf = '';
  const el = $('#lock'); el.hidden = false;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  el.innerHTML = `<img src="${logoSrc()}" alt="" style="width:88px;height:88px;border-radius:20px;object-fit:cover"><h2>${esc(S.settings.shopName)}</h2><div class="sub">Введите PIN</div><div class="dots" id="dots">${'<i></i>'.repeat(4)}</div>
    <div class="keys">${keys.map(k => k ? `<button data-act="key" data-k="${k}">${k}</button>` : '<button class="ghost" disabled></button>').join('')}</div>`;
}
async function pressKey(k) {
  if (k === '⌫') pinBuf = pinBuf.slice(0, -1);
  else if (pinBuf.length < 4) pinBuf += k;
  [...document.querySelectorAll('#dots i')].forEach((d, i) => d.classList.toggle('on', i < pinBuf.length));
  if (pinBuf.length === 4) {
    if (await hashPin(pinBuf) === S.settings.pinHash) { $('#lock').hidden = true; pinBuf = ''; }
    else {
      const d = $('#dots'); d.classList.add('shake'); pinBuf = '';
      setTimeout(() => { d.classList.remove('shake'); [...d.children].forEach(i => i.classList.remove('on')); }, 350);
    }
  }
}
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else {
    if (S.settings.pinHash && hiddenAt && Date.now() - hiddenAt > 30000) showLock();
    render();
  }
});

/* ================= Действия (нажатия) ================= */
const actions = {
  tab: d => { ui.tab = d.tab; ui.matrixFresh = true; $('#view').scrollTop = 0; render(); },
  dateNav: d => { ui.date = d.d === 'today' ? null : L.addDays(curDate(), +d.d); if (ui.date === L.today()) ui.date = null; render(); },
  mark: d => {
    const cur = (L.getRec(S.att, d.emp, curDate()) || {}).s;
    if (setStatus(d.emp, curDate(), cur === d.st ? null : d.st)) render();
  },
  markAll: () => {
    const date = curDate();
    activeEmps().filter(e => L.planned(e, date) !== false && !L.getRec(S.att, e.id, date)).forEach(e => setStatus(e.id, date, 'w'));
    render(); toast('Отмечено');
  },
  toggleOff: () => { ui.showOff = !ui.showOff; render(); },
  dayMenu: d => dayMenu(d.emp, d.date),
  setDay: d => { if (setStatus(d.emp, d.date, d.st || null)) { closeSheet(); render(); } },
  month: d => { ui.month = L.addMonths(ui.month, +d.d); ui.matrixFresh = true; render(); },
  salView: d => { ui.salView = d.v; render(); },
  statMonth: d => { ui.month = d.ym; render(); },
  empDetail: d => empDetail(d.emp),
  money: d => moneySheet(d.emp, d.type, d.back),
  delPay: d => {
    if (!confirm('Удалить эту запись?')) return;
    S.payments = S.payments.filter(p => p.id !== d.id); save(); empDetail(d.emp); render();
  },
  editEmp: d => editEmp(d.id),
  delEmp: d => {
    const e = getEmp(d.id);
    if (!confirm(`Удалить «${e.name}» вместе со всеми отметками и выплатами?\nЕсли человек просто ушёл — лучше поставьте статус «Уволен».`)) return;
    S.employees = S.employees.filter(x => x.id !== d.id); delete S.att[d.id];
    S.payments = S.payments.filter(p => p.empId !== d.id); save(); closeSheet(); render();
  },
  branding: brandingSheet,
  pickLogo: () => $('#logo-in').click(),
  resetLogo: () => { S.settings.logo = null; save(); brandingSheet(); render(); },
  positions: positionsSheet,
  editPos: d => editPos(d.id),
  delPos: d => {
    if (S.employees.some(e => e.positionId === d.id)) return toast('Должность используется сотрудниками');
    if (!confirm('Удалить должность?')) return;
    S.positions = S.positions.filter(p => p.id !== d.id); save(); positionsSheet(); render();
  },
  settings: settingsSheet,
  setPin: pinSheet,
  clearPin: () => { if (confirm('Отключить PIN-код?')) { S.settings.pinHash = null; save(); settingsSheet(); toast('PIN отключён'); } },
  backup: backupSheet,
  install: installSheet,
  exportJson,
  importJson: () => $('#file-in').click(),
  csvReport, csvSheet,
  demo: loadDemo,
  resetAll: () => {
    if (!confirm('Стереть ВСЕ данные? Это нельзя отменить.')) return;
    if (!confirm('Точно стереть? Сделайте резервную копию, если данные ещё нужны.')) return;
    S = defaults(); save(); closeSheet(); render(); toast('Данные стёрты');
  },
  key: d => pressKey(d.k),
  closeSheet
};

document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  ev.preventDefault();
  const fn = actions[el.dataset.act];
  if (fn) fn(el.dataset);
});

/* ================= Формы ================= */
const forms = {
  emp: f => {
    const fd = new FormData(f), id = f.dataset.id, name = fd.get('name').trim();
    if (!name) return toast('Укажите имя');
    const sched = fd.get('schedule');
    const data = {
      name, phone: fd.get('phone').trim(), positionId: fd.get('positionId'),
      rate: fd.get('rate') === '' ? null : Number(fd.get('rate')),
      schedule: sched, start: L.SCHEDULES[sched] ? L.addDays(L.today(), -Number(fd.get('cycle') || 0)) : null,
      hired: fd.get('hired') || null, active: fd.get('active') === '1'
    };
    const payFrom = fd.get('payFrom') || L.today();
    let e;
    if (id) {
      e = getEmp(id);
      const beforeRate = rateNow(e), beforeM = isMonthly(e);
      Object.assign(e, data);
      const afterRate = rateNow(e), afterM = isMonthly(e);
      if (afterM) {
        if (!beforeM || e.payFrom == null) e.payFrom = payFrom;
        else if (fd.get('payFrom')) e.payFrom = payFrom;
        if (beforeM && afterRate !== beforeRate) L.addSalarySegment(e, L.today(), beforeRate);
      }
      if (afterRate !== beforeRate || afterM !== beforeM) L.reprice(S, e, beforeRate === 0 && afterM === beforeM ? '' : L.today());
    } else {
      e = Object.assign({ id: uid() }, data);
      if (isMonthly(e)) e.payFrom = payFrom;
      S.employees.push(e);
    }
    if (!data.active) { if (!e.left) e.left = L.today(); } else e.left = null;
    save(); closeSheet(); render(); toast('Сохранено');
  },
  pos: f => {
    const fd = new FormData(f), id = f.dataset.id, name = fd.get('name').trim(), rate = Number(fd.get('rate'));
    const pay = fd.get('pay') === 'month' ? 'month' : 'day';
    if (!name) return toast('Укажите название');
    if (id) {
      const p = S.positions.find(x => x.id === id), old = Number(p.rate) || 0, oldPay = p.pay || 'day';
      const from = fd.get('from') || L.today(), payChanged = pay !== oldPay;
      const affected = S.employees.filter(e => e.positionId === id);
      const noOwnRate = e => e.rate === null || e.rate === undefined || e.rate === '';
      if (payChanged && affected.length && !confirm(`Изменить способ оплаты у должности «${name}»? Это затронет сотрудников: ${affected.length}.` +
        (oldPay === 'month' ? '\nНачисленный, но не выплаченный оклад пропадёт из расчёта — сначала выплатите его.' : ''))) return;
      // прежний оклад сохраняем для прошлых дат
      if (!payChanged && pay === 'month' && rate !== old) affected.filter(noOwnRate).forEach(e => L.addSalarySegment(e, from, old));
      p.name = name; p.rate = rate; p.pay = pay;
      if (payChanged && pay === 'month') affected.forEach(e => { e.payFrom = from; });
      if (payChanged || rate !== old) {
        const since = old === 0 && !payChanged ? '' : from;
        (payChanged ? affected : affected.filter(noOwnRate)).forEach(e => L.reprice(S, e, since));
      }
    } else S.positions.push({ id: uid(), name, rate, pay });
    save(); positionsSheet(); render();
  },
  money: f => {
    const fd = new FormData(f), { emp, type, back } = f.dataset, amount = Number(fd.get('amount'));
    if (!(amount > 0)) return toast('Введите сумму');
    S.payments.push({ id: uid(), empId: emp, type, amount, date: fd.get('date'), through: type === 'pay' ? fd.get('through') : null, note: (fd.get('note') || '').trim(), ts: Date.now() });
    save(); render();
    if (type === 'pay' && amount < balance(emp) - 0.01) toast('Записано. Остаток: ' + money(balance(emp)));
    else toast('Записано');
    if (back) empDetail(emp); else closeSheet();
  },
  brand: f => {
    S.settings.shopName = new FormData(f).get('shopName').trim() || 'Магазин';
    save(); brandingSheet(); render(); toast('Сохранено');
  },
  settings: f => {
    const fd = new FormData(f);
    S.settings.currency = fd.get('currency').trim();
    S.settings.payEvery = Math.max(1, parseInt(fd.get('payEvery'), 10) || 5);
    S.settings.perDay = Math.max(1, parseInt(fd.get('perDay'), 10) || 10);
    save(); closeSheet(); render(); toast('Сохранено');
  },
  pin: async f => {
    const fd = new FormData(f), p1 = fd.get('p1'), p2 = fd.get('p2');
    if (!/^\d{4}$/.test(p1)) return toast('PIN — ровно 4 цифры');
    if (p1 !== p2) return toast('PIN не совпадает');
    S.settings.pinHash = await hashPin(p1); save(); settingsSheet(); toast('PIN включён');
  }
};
document.addEventListener('submit', ev => {
  const f = ev.target.closest('form[data-form]');
  if (!f) return;
  ev.preventDefault();
  forms[f.dataset.form](f);
});
document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.matches && t.matches('select[data-role="sched"]')) t.form.elements.cycle.innerHTML = cycleOptions(t.value, 0);
  if (t.matches && t.matches('select[data-role="pos"]')) {
    const w = $('#payfrom-wrap');
    if (w) w.hidden = t.selectedOptions[0].dataset.pay !== 'month';
  }
});
$('#logo-in').addEventListener('change', ev => {
  const file = ev.target.files[0]; ev.target.value = '';
  if (file) setLogo(file);
});
$('#file-in').addEventListener('change', ev => {
  const file = ev.target.files[0]; ev.target.value = '';
  if (!file) return;
  const r = new FileReader();
  r.onload = () => importJson(String(r.result));
  r.readAsText(file);
});

/* ================= Запуск ================= */
render();
showLock();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
window.__app = { get S() { return S; }, ui, render, actions, forms };
})();
