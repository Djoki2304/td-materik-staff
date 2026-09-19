/* Логика учёта: даты, графики, расчёт зарплаты. Без DOM — можно тестировать в Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(this, function () {
  'use strict';

  const pad2 = n => String(n).padStart(2, '0');
  const round2 = x => Math.round(x * 100) / 100;

  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function dayNum(s) {
    const [y, m, d] = s.split('-').map(Number);
    return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  }
  function addDays(s, n) {
    const [y, m, d] = s.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return t.getUTCFullYear() + '-' + pad2(t.getUTCMonth() + 1) + '-' + pad2(t.getUTCDate());
  }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); } // m: 1..12
  function weekday(s) { return new Date(dayNum(s) * 86400000).getUTCDay(); }        // 0 = вс
  function addMonths(ym, n) {
    const [y, m] = ym.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1 + n, 1));
    return t.getUTCFullYear() + '-' + pad2(t.getUTCMonth() + 1);
  }
  const monthEnd = ym => ym + '-' + pad2(daysInMonth(+ym.slice(0, 4), +ym.slice(5, 7)));

  // work — рабочих дней подряд, off — выходных подряд
  const SCHEDULES = {
    '2/2': { work: 2, off: 2 },
    '3/3': { work: 3, off: 3 },
    '6/1': { work: 6, off: 1 },
    '5/2': { work: 5, off: 2 },
    'free': null
  };

  // Номер дня внутри цикла графика (0 = первый рабочий день) или null, если графика нет
  function cycleIndex(emp, date) {
    const sc = SCHEDULES[emp.schedule];
    if (!sc || !emp.start) return null;
    const c = sc.work + sc.off;
    return (((dayNum(date) - dayNum(emp.start)) % c) + c) % c;
  }
  // true — рабочий день по графику, false — выходной, null — графика нет
  function planned(emp, date) {
    const i = cycleIndex(emp, date);
    return i === null ? null : i < SCHEDULES[emp.schedule].work;
  }

  /* ---------- Ставки ---------- */

  // Сумма ставки: за день или (если должность с окладом) за месяц
  function rateOf(emp, positions) {
    if (emp.rate !== null && emp.rate !== undefined && emp.rate !== '' && !isNaN(emp.rate)) return Number(emp.rate);
    const p = positions.find(p => p.id === emp.positionId);
    return p ? Number(p.rate) || 0 : 0;
  }
  // Должность с фиксированным окладом за месяц
  function isMonthly(emp, positions) {
    const p = positions.find(x => x.id === emp.positionId);
    return !!p && p.pay === 'month';
  }
  // Сколько записывать за выход в табель: у сотрудников на окладе выход ничего не добавляет
  function dayRate(emp, positions) { return isMonthly(emp, positions) ? 0 : rateOf(emp, positions); }

  // Оклад на конкретную дату (учитывает прошлые изменения оклада: salHist = [{before, amount}])
  function monthlyAmountOn(emp, positions, d) {
    for (const s of emp.salHist || []) if (d < s.before) return s.amount;
    return rateOf(emp, positions);
  }
  // Период, за который начисляется оклад: с payFrom (или даты приёма) по сегодня / дату увольнения
  function monthlyBounds(emp, upto) {
    const from = emp.payFrom || emp.hired || upto;
    const end = emp.left && emp.left < upto ? emp.left : upto;
    return { from, end };
  }
  // Начислено оклада за период from..to включительно: оклад делится на дни календарного месяца
  function accrue(emp, positions, from, to) {
    if (!from || !to || from > to) return 0;
    if (dayNum(to) - dayNum(from) > 3660) from = addDays(to, -3660);
    let sum = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      sum += monthlyAmountOn(emp, positions, d) / daysInMonth(+d.slice(0, 4), +d.slice(5, 7));
    }
    return sum;
  }

  function getRec(att, empId, date) { return (att[empId] || {})[date] || null; }

  function workedDates(att, empId) {
    const a = att[empId] || {};
    return Object.keys(a).filter(d => a[d].s === 'w').sort();
  }

  // Последняя дата, по которую уже выплачена зарплата ('' — выплат не было)
  function paidThrough(payments, empId) {
    let m = '';
    for (const p of payments) if (p.empId === empId && p.type === 'pay' && p.through && p.through > m) m = p.through;
    return m;
  }

  // Рабочие дни без выплаты (для сотрудников «за день»): { days, amount, dates }
  function unpaid(S, empId, upto) {
    const pt = paidThrough(S.payments, empId);
    const a = S.att[empId] || {};
    const dates = workedDates(S.att, empId).filter(d => d > pt && (!upto || d <= upto));
    return { days: dates.length, amount: dates.reduce((s, d) => s + (a[d].r || 0), 0), dates };
  }

  // Сколько должен сотруднику: начислено (за выходы или оклад) + премии − штрафы − выплаты − авансы
  function balanceOf(S, empId, upto) {
    upto = upto || today();
    const emp = S.employees.find(e => e.id === empId);
    const a = S.att[empId] || {};
    let sum = 0;
    for (const d in a) if (a[d].s === 'w') sum += a[d].r || 0;
    if (emp && isMonthly(emp, S.positions)) {
      const b = monthlyBounds(emp, upto);
      sum += accrue(emp, S.positions, b.from, b.end);
    }
    for (const p of S.payments) {
      if (p.empId !== empId) continue;
      if (p.type === 'bonus') sum += p.amount;
      else sum -= p.amount; // pay, adv, fine
    }
    return round2(sum);
  }

  // Пора ли платить. За день: набралось N рабочих дней. Оклад: закончился месяц (или сотрудник уволен)
  function dueInfo(S, emp, upto, payEvery) {
    if (isMonthly(emp, S.positions)) {
      const b = monthlyBounds(emp, upto), pt = paidThrough(S.payments, emp.id);
      const from = pt && addDays(pt, 1) > b.from ? addDays(pt, 1) : b.from;
      const prevEnd = addDays(upto.slice(0, 7) + '-01', -1);
      const left = emp.left && emp.left <= upto;
      const end = left ? b.end : (b.end < prevEnd ? b.end : prevEnd);
      const accDays = from > b.end ? 0 : dayNum(b.end) - dayNum(from) + 1;
      if (from > end) return { monthly: true, due: false, days: 0, accDays, amount: 0, through: null };
      const amount = round2(accrue(emp, S.positions, from, end));
      return { monthly: true, due: amount > 0.5, days: dayNum(end) - dayNum(from) + 1, accDays, amount, through: end };
    }
    const u = unpaid(S, emp.id, upto);
    return { monthly: false, due: u.days >= payEvery, days: u.days, accDays: u.days, amount: u.amount,
      through: u.dates.length ? u.dates[u.dates.length - 1] : null };
  }

  // Что предложить в окне выплаты: сумма и «закрывает дни по»
  function payoutSuggest(S, emp, upto, payEvery) {
    const bal = balanceOf(S, emp.id, upto);
    const info = dueInfo(S, emp, upto, payEvery);
    if (info.monthly) {
      const b = monthlyBounds(emp, upto);
      if (info.due) {
        const rest = accrue(emp, S.positions, addDays(info.through, 1), b.end); // оклад за текущий, ещё не закрытый месяц
        return { amount: Math.max(0, round2(bal - rest)), through: info.through, info };
      }
      return { amount: Math.max(0, bal), through: upto, info };
    }
    return { amount: Math.max(0, bal), through: info.through || upto, info };
  }

  /* ---------- Отчёты ---------- */

  function monthReport(S, ym, upto) {
    upto = upto || today();
    const rows = [];
    for (const e of S.employees) {
      const a = S.att[e.id] || {};
      let days = 0, earned = 0, absent = 0, sick = 0, vac = 0, salary = 0;
      for (const d in a) {
        if (d.slice(0, 7) !== ym) continue;
        const r = a[d];
        if (r.s === 'w') { days++; earned += r.r || 0; }
        else if (r.s === 'a') absent++;
        else if (r.s === 's') sick++;
        else if (r.s === 'v') vac++;
      }
      const monthly = isMonthly(e, S.positions);
      if (monthly) {
        const b = monthlyBounds(e, upto), ms = ym + '-01', me = monthEnd(ym);
        salary = accrue(e, S.positions, ms > b.from ? ms : b.from, me < b.end ? me : b.end);
        earned += salary;
      }
      let bonus = 0, fine = 0, paid = 0;
      for (const p of S.payments) {
        if (p.empId !== e.id || p.date.slice(0, 7) !== ym) continue;
        if (p.type === 'bonus') bonus += p.amount;
        else if (p.type === 'fine') fine += p.amount;
        else paid += p.amount;
      }
      if (days || absent || sick || vac || bonus || fine || paid || earned > 0.5) {
        rows.push({ emp: e, monthly, days, earned: round2(earned), salary: round2(salary), absent, sick, vac, bonus, fine, paid, balance: balanceOf(S, e.id, upto) });
      }
    }
    return rows;
  }

  // Итоги по магазину за месяц
  function storeStats(S, ym, upto, target) {
    upto = upto || today();
    const rows = monthReport(S, ym, upto);
    const t = { earned: 0, bonus: 0, fine: 0, paid: 0, days: 0, absent: 0, sick: 0, vac: 0 };
    rows.forEach(r => { for (const k in t) t[k] += r[k]; });
    t.fot = round2(t.earned + t.bonus - t.fine);
    t.earned = round2(t.earned);

    // Явка по дням: сколько человек вышло в каждый уже прошедший день месяца
    const n = daysInMonth(+ym.slice(0, 4), +ym.slice(5, 7));
    let elapsed = 0, sum = 0, min = Infinity, max = 0, below = 0;
    for (let i = 1; i <= n; i++) {
      const d = ym + '-' + pad2(i);
      if (d > upto) break;
      let c = 0;
      for (const e of S.employees) { const r = (S.att[e.id] || {})[d]; if (r && r.s === 'w') c++; }
      elapsed++; sum += c; if (c < min) min = c; if (c > max) max = c;
      if (target && c < target) below++;
    }
    t.elapsed = elapsed;
    t.avg = elapsed ? sum / elapsed : 0;
    t.min = elapsed ? min : 0;
    t.max = max;
    t.below = below;

    // По должностям
    const map = {};
    rows.forEach(r => {
      const p = S.positions.find(x => x.id === r.emp.positionId);
      const key = p ? p.id : '-';
      const g = map[key] || (map[key] = { name: p ? p.name : 'Без должности', staff: 0, amount: 0 });
      g.staff++; g.amount += r.earned + r.bonus - r.fine;
    });
    t.byPos = Object.values(map).map(g => ({ name: g.name, staff: g.staff, amount: round2(g.amount) })).sort((a, b) => b.amount - a.amount);

    // Кто пропускал
    t.absences = rows.filter(r => r.absent || r.sick || r.vac)
      .sort((a, b) => b.absent - a.absent || b.sick - a.sick || b.vac - a.vac)
      .map(r => ({ emp: r.emp, absent: r.absent, sick: r.sick, vac: r.vac }));
    t.rows = rows;
    return t;
  }

  // Фонд оплаты труда и выплаты за последние count месяцев (по endYm включительно)
  function fotSeries(S, endYm, count, upto) {
    const out = [];
    for (let i = count - 1; i >= 0; i--) {
      const ym = addMonths(endYm, -i);
      let fot = 0, paid = 0;
      monthReport(S, ym, upto).forEach(r => { fot += r.earned + r.bonus - r.fine; paid += r.paid; });
      out.push({ ym, fot: round2(fot), paid: round2(paid) });
    }
    return out;
  }

  // Пересчитать сохранённую дневную ставку в отметках «вышел» начиная с даты from ('' — все дни)
  function reprice(S, emp, from) {
    const a = S.att[emp.id];
    if (!a) return;
    const rate = dayRate(emp, S.positions);
    for (const d in a) if (a[d].s === 'w' && (!from || d >= from)) a[d].r = rate;
  }

  // Запомнить прежний оклад: до даты before действовала сумма amount
  function addSalarySegment(emp, before, amount) {
    if (!(amount > 0)) return;
    emp.salHist = (emp.salHist || []).concat([{ before, amount }]).sort((a, b) => a.before.localeCompare(b.before));
  }

  return {
    pad2, round2, today, dayNum, addDays, daysInMonth, weekday, addMonths, monthEnd,
    SCHEDULES, cycleIndex, planned, rateOf, isMonthly, dayRate, monthlyAmountOn, monthlyBounds, accrue,
    getRec, workedDates, paidThrough, unpaid, balanceOf, dueInfo, payoutSuggest,
    monthReport, storeStats, fotSeries, reprice, addSalarySegment
  };
});
