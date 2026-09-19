/* Логика учёта: даты, графики, расчёт зарплаты. Без DOM — можно тестировать в Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(this, function () {
  'use strict';

  const pad2 = n => String(n).padStart(2, '0');

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

  function rateOf(emp, positions) {
    if (emp.rate !== null && emp.rate !== undefined && emp.rate !== '' && !isNaN(emp.rate)) return Number(emp.rate);
    const p = positions.find(p => p.id === emp.positionId);
    return p ? Number(p.rate) || 0 : 0;
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

  // Рабочие дни без выплаты: { days, amount, dates }
  function unpaid(S, empId, upto) {
    const pt = paidThrough(S.payments, empId);
    const a = S.att[empId] || {};
    const dates = workedDates(S.att, empId).filter(d => d > pt && (!upto || d <= upto));
    return { days: dates.length, amount: dates.reduce((s, d) => s + (a[d].r || 0), 0), dates };
  }

  // Сколько должен сотрудникам: начислено за выходы + премии − штрафы − выплаты − авансы
  function balanceOf(S, empId) {
    const a = S.att[empId] || {};
    let sum = 0;
    for (const d in a) if (a[d].s === 'w') sum += a[d].r || 0;
    for (const p of S.payments) {
      if (p.empId !== empId) continue;
      if (p.type === 'bonus') sum += p.amount;
      else sum -= p.amount; // pay, adv, fine
    }
    return Math.round(sum * 100) / 100;
  }

  function monthReport(S, ym) {
    const rows = [];
    for (const e of S.employees) {
      const a = S.att[e.id] || {};
      let days = 0, earned = 0, absent = 0, sick = 0, vac = 0;
      for (const d in a) {
        if (d.slice(0, 7) !== ym) continue;
        const r = a[d];
        if (r.s === 'w') { days++; earned += r.r || 0; }
        else if (r.s === 'a') absent++;
        else if (r.s === 's') sick++;
        else if (r.s === 'v') vac++;
      }
      let bonus = 0, fine = 0, paid = 0;
      for (const p of S.payments) {
        if (p.empId !== e.id || p.date.slice(0, 7) !== ym) continue;
        if (p.type === 'bonus') bonus += p.amount;
        else if (p.type === 'fine') fine += p.amount;
        else paid += p.amount;
      }
      if (days || absent || sick || vac || bonus || fine || paid) {
        rows.push({ emp: e, days, earned, absent, sick, vac, bonus, fine, paid, balance: balanceOf(S, e.id) });
      }
    }
    return rows;
  }

  // Пересчитать сохранённую ставку в отметках «вышел» начиная с даты from ('' — все дни)
  function reprice(S, emp, from) {
    const a = S.att[emp.id];
    if (!a) return;
    const rate = rateOf(emp, S.positions);
    for (const d in a) if (a[d].s === 'w' && (!from || d >= from)) a[d].r = rate;
  }

  return {
    pad2, today, dayNum, addDays, daysInMonth, weekday, addMonths,
    SCHEDULES, cycleIndex, planned, rateOf, getRec, workedDates,
    paidThrough, unpaid, balanceOf, monthReport, reprice
  };
});
