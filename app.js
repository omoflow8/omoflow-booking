// Omo Flow Booking — client
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const deviceId = store.get('deviceId') || (() => { const id = crypto.randomUUID(); store.set('deviceId', id); return id; })();
const ICON = { pickup: '🛻', pickup_box: '🚐', truck4: '🚚', truck6: '🚛', truck10: '🚛', cold: '❄️' };

let CFG, vehicle = 'pickup', points = { pickup: null }, dropCount = 0, map, markers = {}, distanceManual = false;

function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2600); }
const baht = n => n.toLocaleString('th-TH') + ' ฿';

// ---------- tabs ----------
$$('.bottom button').forEach(b => b.onclick = () => {
  $$('.bottom button').forEach(x => x.classList.toggle('on', x === b));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'list') loadList();
  if (b.dataset.tab === 'book' && map) setTimeout(() => map.invalidateSize(), 50);
  scrollTo(0, 0);
});

// ---------- init ----------
(async function init() {
  CFG = await fetch('/api/config').then(r => r.json());
  const vEl = $('#vehicles');
  for (const [k, v] of Object.entries(CFG.vehicles)) {
    const b = document.createElement('button');
    b.className = 'veh' + (k === vehicle ? ' on' : ''); b.dataset.v = k;
    b.innerHTML = `<div class="ic">${ICON[k] || '🚚'}</div><b>${v.name}</b><small>เริ่ม ${baht(v.base)} · ${v.perKm} ฿/กม.</small>`;
    b.onclick = () => { vehicle = k; $$('.veh').forEach(x => x.classList.toggle('on', x === b)); updatePrices(); };
    vEl.append(b);
  }
  $$('[data-ex]').forEach(e => e.textContent = '+' + baht(CFG.extras[e.dataset.ex]));
  if (CFG.lineAddFriendUrl) { $('#addFriend').href = CFG.lineAddFriendUrl; $('#addFriend').hidden = false; }
  $('#lineId').value = store.get('lineId', '');
  lineState();
  const c = store.get('contact', {}); $('#cName').value = c.name || ''; $('#cPhone').value = c.phone || '';
  addDrop();
  initMap();
  updatePrices();
})();

// ---------- addresses ----------
function addDrop() {
  const i = ++dropCount, key = 'drop' + i;
  const d = document.createElement('div'); d.className = 'drop'; d.dataset.key = key;
  d.innerHTML = `<label class="lbl">🏁 จุดส่งของ ${$$('.drop').length + 1}</label>
    <div class="addr"><input placeholder="ที่อยู่ / ชื่อสถานที่" autocomplete="off">
    <button class="btn ghost small" data-geo="${key}">ค้นหา</button>
    ${i > 1 ? '<button class="btn danger small" data-rm>ลบ</button>' : ''}</div>`;
  $('#drops').append(d);
  d.querySelector('[data-rm]')?.addEventListener('click', () => {
    d.remove(); delete points[key]; if (markers[key]) { map.removeLayer(markers[key]); delete markers[key]; }
    $$('.drop .lbl').forEach((l, n) => l.textContent = `🏁 จุดส่งของ ${n + 1}`); recalc();
  });
  points[key] = null; updatePrices();
}
$('#addDrop').onclick = addDrop;
const inputFor = key => key === 'pickup' ? $('#pickup') : $(`.drop[data-key="${key}"] input`);

document.addEventListener('click', async e => {
  const key = e.target.dataset?.geo; if (!key) return;
  const q = inputFor(key).value.trim(); if (!q) return toast('กรอกที่อยู่ก่อนกดค้นหา');
  e.target.disabled = true;
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=th&accept-language=th&q=${encodeURIComponent(q)}`).then(r => r.json());
    if (!r[0]) toast('ไม่พบสถานที่ ลองพิมพ์ให้ละเอียดขึ้น หรือแตะบนแผนที่');
    else setPoint(key, +r[0].lat, +r[0].lon, false);
  } catch { toast('ค้นหาไม่สำเร็จ กรุณากรอกระยะทางเอง'); }
  e.target.disabled = false;
});

function initMap() {
  if (!window.L) { $('#map').hidden = true; return; }
  map = L.map('map').setView([13.7563, 100.5018], 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
  map.on('click', async ev => {
    // แตะแผนที่ = ปักหมุดช่องแรกที่ยังว่าง (ถ้าครบแล้ว ใช้จุดส่งสุดท้าย)
    const keys = orderedKeys(); const key = keys.find(k => !points[k]) || keys[keys.length - 1];
    setPoint(key, ev.latlng.lat, ev.latlng.lng, true);
  });
}
async function setPoint(key, lat, lon, reverse) {
  points[key] = [lat, lon];
  if (map) {
    if (markers[key]) markers[key].setLatLng([lat, lon]);
    else markers[key] = L.marker([lat, lon], { title: key }).addTo(map).bindTooltip(key === 'pickup' ? 'รับ' : 'ส่ง', { permanent: true, direction: 'top' });
    const ll = Object.values(points).filter(Boolean);
    ll.length > 1 ? map.fitBounds(ll, { padding: [30, 30] }) : map.setView([lat, lon], 14);
  }
  if (reverse && !inputFor(key).value) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&accept-language=th&lat=${lat}&lon=${lon}`).then(r => r.json());
      if (r.display_name) inputFor(key).value = r.display_name;
    } catch {}
  }
  recalc();
}
function orderedKeys() { return ['pickup', ...$$('.drop').map(d => d.dataset.key)]; }
function hav([a, b], [c, d]) {
  const R = 6371, r = x => x * Math.PI / 180, dl = r(c - a), dn = r(d - b);
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dl / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dn / 2) ** 2));
}
function recalc() {
  if (distanceManual) return updatePrices();
  const pts = orderedKeys().map(k => points[k]).filter(Boolean);
  let km = 0; for (let i = 1; i < pts.length; i++) km += hav(pts[i - 1], pts[i]) * 1.3; // ×1.3 เผื่อระยะถนนจริง
  if (pts.length > 1) $('#distance').value = km.toFixed(1);
  updatePrices();
}
$('#distance').oninput = () => { distanceManual = $('#distance').value !== ''; updatePrices(); };

// ---------- when / extras ----------
$$('input[name=when]').forEach(r => r.onchange = () => {
  const later = $('input[name=when]:checked').value === 'later';
  const w = $('#whenAt'); w.hidden = !later;
  const now = new Date(), max = new Date(now.getTime() + 14 * 864e5);
  const fmt = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  w.min = fmt(new Date(now.getTime() + 36e5)); w.max = fmt(max); if (!w.value) w.value = w.min;
});
['#exLoading', '#exHelpers', '#exPod'].forEach(s => $(s).onchange = updatePrices);

// ---------- quote ----------
function formData() {
  const later = $('input[name=when]:checked').value === 'later';
  return {
    vehicle, pickup: $('#pickup').value.trim(),
    drops: $$('.drop input').map(i => i.value.trim()).filter(Boolean),
    distanceKm: +$('#distance').value || 0,
    when: later && $('#whenAt').value ? new Date($('#whenAt').value).toISOString() : 'now',
    extras: { loading: $('#exLoading').checked, helpers: +$('#exHelpers').value, pod: $('#exPod').checked },
    contact: { name: $('#cName').value.trim(), phone: $('#cPhone').value.trim() },
    note: $('#note').value.trim(), lineUserId: store.get('lineId', ''), deviceId,
  };
}
let qTimer;
function updatePrices() {
  if (!CFG) return;
  $('#helperPrice').textContent = '+' + baht(CFG.vehicles[vehicle].helper) + '/คน';
  clearTimeout(qTimer);
  qTimer = setTimeout(async () => {
    const d = formData(); if (!d.drops.length) d.drops = ['-'];
    const q = await fetch('/api/quote', { method: 'POST', body: JSON.stringify(d) }).then(r => r.json()).catch(() => null);
    if (!q?.lines) return;
    $('#quoteLines').innerHTML = q.lines.filter(l => l[1]).map(([t, v]) => `<div><span>${t}</span><span>${baht(v)}</span></div>`).join('');
    $('#total').textContent = baht(q.total);
  }, 150);
}

// ---------- submit ----------
$('#submit').onclick = async () => {
  const d = formData();
  if (!d.pickup) return toast('กรุณากรอกจุดรับของ');
  if (!d.drops.length) return toast('กรุณากรอกจุดส่งของอย่างน้อย 1 จุด');
  if (!d.distanceKm) return toast('กรุณาระบุระยะทาง (กดค้นหาที่อยู่ หรือกรอกเอง)');
  if (!d.contact.name || !/^0\d{8,9}$/.test(d.contact.phone.replace(/\D/g, ''))) return toast('กรุณากรอกชื่อและเบอร์โทรให้ถูกต้อง');
  store.set('contact', d.contact);
  $('#submit').disabled = true;
  try {
    const r = await fetch('/api/bookings', { method: 'POST', body: JSON.stringify(d) });
    const b = await r.json(); if (!r.ok) throw new Error(b.error);
    toast(`จองสำเร็จ เลขที่ ${b.id}` + (d.lineUserId ? ' · แจ้งเตือนส่งเข้า LINE แล้ว' : ''));
    notifyLocal('จองรถสำเร็จ', `${b.id} · ${baht(b.quote.total)}`);
    $('#note').value = '';
    $('[data-tab=list]').click();
  } catch (e) { toast('จองไม่สำเร็จ: ' + e.message); }
  $('#submit').disabled = false;
};

// ---------- list ----------
async function loadList() {
  const el = $('#list'); el.innerHTML = '<p class="hint">กำลังโหลด…</p>';
  try {
    const list = await fetch('/api/bookings?device=' + deviceId).then(r => r.json());
    const prev = store.get('lastStatus', {});
    list.forEach(b => { if (prev[b.id] && prev[b.id] !== b.status) notifyLocal('อัปเดตสถานะ ' + b.id, CFG.status[b.status]); prev[b.id] = b.status; });
    store.set('lastStatus', prev);
    el.innerHTML = list.length ? list.map(b => `
      <div class="card bk">
        <div class="bk-head"><b>${b.id}</b><span class="pill ${b.status}">${CFG.status[b.status]}</span></div>
        <p>${ICON[b.vehicle] || ''} ${CFG.vehicles[b.vehicle].name} · ${b.distanceKm} กม. · <b>${baht(b.quote.total)}</b></p>
        <p>📍 ${esc(b.pickup)}</p>${b.drops.map(x => `<p>🏁 ${esc(x)}</p>`).join('')}
        <p class="hint">${b.when === 'now' ? 'ด่วน' : new Date(b.when).toLocaleString('th-TH')} · จองเมื่อ ${new Date(b.createdAt).toLocaleString('th-TH')}</p>
        ${b.status === 'pending' ? `<button class="btn danger small" data-cancel="${b.id}">ยกเลิกการจอง</button>` : ''}
      </div>`).join('') : '<p class="hint">ยังไม่มีการจอง</p>';
  } catch { el.innerHTML = '<p class="hint">โหลดไม่สำเร็จ (ออฟไลน์?)</p>'; }
}
$('#refresh').onclick = loadList;
document.addEventListener('click', async e => {
  const id = e.target.dataset?.cancel; if (!id || !confirm('ยืนยันยกเลิกการจอง ' + id + ' ?')) return;
  const r = await fetch(`/api/bookings/${id}/status`, { method: 'POST', body: JSON.stringify({ status: 'cancelled' }) });
  toast(r.ok ? 'ยกเลิกแล้ว' : 'ยกเลิกไม่สำเร็จ'); loadList();
});
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- LINE settings ----------
$('#saveLine').onclick = () => {
  const v = $('#lineId').value.trim();
  if (v && !/^[UCR][0-9a-f]{32}$/.test(v)) return toast('รหัส LINE ไม่ถูกต้อง (ขึ้นต้นด้วย U และยาว 33 ตัว)');
  store.set('lineId', v); lineState(); toast(v ? 'บันทึกแล้ว จะได้รับแจ้งเตือนทาง LINE' : 'ปิดการแจ้งเตือน LINE');
};
function lineState() { const v = store.get('lineId', ''); $('#lineState').textContent = v ? '✅ เชื่อมต่อ LINE แล้ว' : 'ยังไม่ได้เชื่อมต่อ LINE'; }

// ---------- PWA ----------
let deferred;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('#installBtn').hidden = false; });
$('#installBtn').onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('#installBtn').hidden = true; };
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
function notifyLocal(title, body) {
  if (!('Notification' in window)) return;
  const show = () => navigator.serviceWorker?.ready.then(r => r.showNotification(title, { body, icon: '/icons/icon-192.png' }));
  if (Notification.permission === 'granted') show();
  else if (Notification.permission === 'default') Notification.requestPermission().then(p => p === 'granted' && show());
}
// เช็คสถานะใหม่ทุก 60 วิ ขณะเปิดแอป
setInterval(() => { if ($('#tab-list').classList.contains('active')) loadList(); }, 60000);
