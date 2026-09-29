/* Зеркалирование локальных данных в Firestore для приложения-кабинета сотрудника.
   Все записи — fire-and-forget (см. safe()): отсутствие сети/входа не должно ломать офлайн-работу. */
(() => {
'use strict';
const auth = firebase.auth();
const db = firebase.firestore();
const secondaryAuth = secondaryApp.auth();
// Без этого secondaryAuth иногда перезаписывает сохранённую сессию основного admin-логина
// в общем хранилище браузера (собственный баг Firebase JS SDK для именованных app-инстансов),
// из-за чего запросы к Firestore внезапно уходят от имени только что созданного сотрудника.
secondaryAuth.setPersistence(firebase.auth.Auth.Persistence.NONE).catch(() => {});
const nowTs = () => firebase.firestore.FieldValue.serverTimestamp();
const PUSH_ENDPOINT = 'https://td-materik-push.td-materik.workers.dev/send';

let authUser = null, authReady = false;
const authListeners = [];
auth.onAuthStateChanged(u => {
  authUser = u; authReady = true;
  authListeners.forEach(cb => cb(u));
});

function safe(promise) {
  return promise.catch(err => console.warn('[cloud]', (err && err.message) || err));
}

const Cloud = {
  onAuthChange(cb) { authListeners.push(cb); if (authReady) cb(authUser); },
  get user() { return authUser; },
  signIn(email, password) { return auth.signInWithEmailAndPassword(email, password); },
  signOut() { return auth.signOut(); },

  upsertEmployee(e) {
    const data = {
      name: e.name, phone: e.phone || '', positionId: e.positionId || null,
      schedule: e.schedule || null, start: e.start || null, hired: e.hired || null,
      payFrom: e.payFrom || null, left: e.left || null, salHist: e.salHist || null,
      rate: e.rate == null ? null : Number(e.rate), active: e.active !== false,
      authUid: e.authUid || null, authEmail: e.authEmail || null,
      updatedAt: nowTs()
    };
    return safe(Promise.all([
      db.collection('employees').doc(e.id).set(data, { merge: true }),
      db.collection('directory').doc(e.id).set({ name: e.name, authEmail: e.authEmail || null }, { merge: true })
    ]));
  },

  // Подколлекции (attendance/fines/payments/pushSubscriptions) Firestore не удаляет каскадно —
  // для v1 осиротевшие записи остаются, но они никому не видны без родительского документа.
  deleteEmployee(id) {
    return safe(Promise.all([
      db.collection('employees').doc(id).delete(),
      db.collection('directory').doc(id).delete()
    ]));
  },

  setAttendance(empId, date, status, rate) {
    if (!empId) return;
    const ref = db.collection('employees').doc(empId).collection('attendance').doc(date);
    return safe(status ? ref.set({ status, rate: rate == null ? null : rate }, { merge: true }) : ref.delete());
  },

  // Штрафы отдельной коллекции не имеют — это запись в payments с type:'fine' (как и в локальной модели S.payments)
  addPayment(empId, p) {
    return safe(db.collection('employees').doc(empId).collection('payments').doc(p.id).set({
      date: p.date, amount: p.amount, type: p.type, through: p.through || null, note: p.note || '', createdAt: nowTs()
    }));
  },
  deleteMoneyRecord(empId, id) {
    return safe(db.collection('employees').doc(empId).collection('payments').doc(id).delete());
  },

  // Воркер доверяет только валидному Firebase ID-токену текущего админа (проверяет его через
  // собственное правило Firestore admins/{uid}) — статичного секрета в клиентском коде нет.
  async notify(empId, title, message) {
    if (!authUser) return;
    let token;
    try { token = await authUser.getIdToken(); } catch { return; }
    let subsSnap;
    try { subsSnap = await db.collection('employees').doc(empId).collection('pushSubscriptions').get(); }
    catch { return; }
    await Promise.all(subsSnap.docs.map(async doc => {
      const subscription = doc.data();
      try {
        const resp = await fetch(PUSH_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ subscription, title, message })
        });
        if (resp.status === 404 || resp.status === 410) await doc.ref.delete();
      } catch (err) { console.warn('[push]', err); }
    }));
  },

  upsertPosition(p) {
    return safe(db.collection('positions').doc(p.id).set({ name: p.name, rate: Number(p.rate) || 0, pay: p.pay || 'day' }, { merge: true }));
  },
  deletePosition(id) { return safe(db.collection('positions').doc(id).delete()); },

  // Логотип (base64) намеренно не отправляем в config/public — раздувает документ, сотруднику он не нужен
  upsertConfig(settings) {
    return safe(db.collection('config').doc('public').set({
      shopName: settings.shopName || '', currency: settings.currency || '₽', payEvery: settings.payEvery || 5
    }, { merge: true }));
  },
  // Переносит текущее состояние в облако разово при входе — сотрудников, должности, настройки
  // и ВСЮ накопленную историю табеля и выплат (например, с телефона, где приложением реально
  // пользовались до этого), чтобы кабинет сотрудника и восстановление видели полную картину.
  fullSync(S) {
    S.positions.forEach(p => this.upsertPosition(p));
    S.employees.forEach(e => this.upsertEmployee(e));
    this.upsertConfig(S.settings);
    for (const empId in S.att) {
      const days = S.att[empId];
      for (const date in days) this.setAttendance(empId, date, days[date].s, days[date].r);
    }
    S.payments.forEach(p => this.addPayment(p.empId, p));
  },

  // Обратный ход: восстанавливает локальный S из облака (например, после случайной очистки
  // данных браузера — localStorage и IndexedDB общие для всех страниц одного домена, так что
  // очистка сайта задевает оба приложения сразу, хотя ломает по факту только это, локальное).
  async pullAll() {
    const [posSnap, empSnap, cfgDoc] = await Promise.all([
      db.collection('positions').get(),
      db.collection('employees').get(),
      db.collection('config').doc('public').get()
    ]);
    const positions = posSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const employees = empSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const att = {}, payments = [];
    await Promise.all(employees.map(async e => {
      const [attSnap, paySnap] = await Promise.all([
        db.collection('employees').doc(e.id).collection('attendance').get(),
        db.collection('employees').doc(e.id).collection('payments').get()
      ]);
      const empAtt = {};
      attSnap.forEach(d => { const v = d.data(); empAtt[d.id] = { s: v.status, r: v.rate }; });
      if (Object.keys(empAtt).length) att[e.id] = empAtt;
      paySnap.forEach(d => { const v = d.data(); payments.push({ id: d.id, empId: e.id, ...v, ts: v.createdAt ? v.createdAt.toMillis() : Date.now() }); });
    }));
    const settings = cfgDoc.exists ? cfgDoc.data() : {};
    return { positions, employees, att, payments, settings };
  },

  // Firebase не даёт сменить чужой пароль без Admin SDK/Cloud Functions (недоступны без Blaze-биллинга),
  // поэтому единственный путь на чистом клиенте — временно войти под сотрудником через secondaryAuth,
  // зная старый PIN. Если старый PIN на этом устройстве неизвестен (например, после восстановления
  // резервной копии на новом телефоне) — сменить его отсюда нельзя, нужно удалить и создать заново
  // (вручную, через консоль Firebase) — не покрыто в v1.
  async ensureEmployeeAuth(emp, newPin, oldPin) {
    if (!/^\d{6}$/.test(newPin || '')) throw new Error('PIN должен быть ровно 6 цифр');
    const authEmail = 'emp_' + emp.id + '@td-materik.internal';
    try {
      const cred = await secondaryAuth.createUserWithEmailAndPassword(authEmail, newPin);
      await secondaryAuth.signOut();
      return { authUid: cred.user.uid, authEmail };
    } catch (err) {
      if (err.code !== 'auth/email-already-in-use') throw err;
      if (!oldPin) throw new Error('Старый PIN неизвестен на этом устройстве — смена недоступна');
      const cred = await secondaryAuth.signInWithEmailAndPassword(authEmail, oldPin);
      await cred.user.updatePassword(newPin);
      const authUid = cred.user.uid;
      await secondaryAuth.signOut();
      return { authUid, authEmail };
    }
  }
};

window.Cloud = Cloud;
})();
