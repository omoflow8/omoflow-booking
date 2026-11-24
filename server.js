// Omo Flow Booking — server (ไม่ต้องติดตั้งแพ็กเกจเพิ่ม ใช้ Node 18+)
// เสิร์ฟแอป PWA + API การจอง + แจ้งเตือนผ่าน LINE Messaging API
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

loadEnv(path.join(__dirname, '.env'));
const PORT = process.env.PORT || 3000;
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const LINE_SECRET = process.env.LINE_CHANNEL_SECRET || '';
const LINE_ADMIN_TO = (process.env.LINE_ADMIN_TO || '').split(',').map(s => s.trim()).filter(Boolean);
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me';
const DATA_FILE = path.join(__dirname, 'data', 'bookings.json');
const PUBLIC = path.join(__dirname, 'public');
const WEB_FILES = new Set(['index.html', 'admin.html', 'app.js', 'style.css', 'sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png']);

// ---------- ราคา (ตัวอย่าง ปรับได้ตามจริง) ----------
const VEHICLES = {
  pickup:      { name: 'รถกระบะ',            base: 350,  perKm: 12, helper: 300 },
  pickup_box:  { name: 'กระบะตู้ทึบ',         base: 400,  perKm: 13, helper: 300 },
  truck4:      { name: 'รถ 4 ล้อใหญ่',         base: 800,  perKm: 18, helper: 400 },
  truck6:      { name: 'รถ 6 ล้อ',             base: 1600, perKm: 25, helper: 500 },
  truck10:     { name: 'รถ 10 ล้อ',            base: 3500, perKm: 35, helper: 600 },
  cold:        { name: 'รถเย็น (กระบะตู้เย็น)', base: 700,  perKm: 16, helper: 300 },
};
const EXTRAS = { loading: 150, pod: 50, extraStop: 100 };
const STATUS = {
  pending: 'รอยืนยัน', confirmed: 'ยืนยันแล้ว', assigned: 'ได้คนขับแล้ว',
  picking: 'กำลังไปรับของ', delivering: 'กำลังจัดส่ง', done: 'ส่งสำเร็จ', cancelled: 'ยกเลิก',
};

function quote(b) {
  const v = VEHICLES[b.vehicle];
  if (!v) throw new Error('ประเภทรถไม่ถูกต้อง');
  const km = Math.max(0, Number(b.distanceKm) || 0);
  const stops = Math.max(1, (b.drops || []).length);
  const lines = [
    ['ค่าเริ่มต้น ' + v.name, v.base],
    [`ระยะทาง ${km.toFixed(1)} กม. × ${v.perKm}`, Math.round(km * v.perKm)],
  ];
  if (stops > 1) lines.push([`จุดส่งเพิ่ม ${stops - 1} จุด`, (stops - 1) * EXTRAS.extraStop]);
  if (b.extras?.loading) lines.push(['คนขับช่วยยกของขึ้น-ลง', EXTRAS.loading]);
  if (b.extras?.helpers) lines.push([`ผู้ช่วยยกของ ${b.extras.helpers} คน`, b.extras.helpers * v.helper]);
  if (b.extras?.pod) lines.push(['ส่งคืนเอกสาร (POD)', EXTRAS.pod]);
  const total = lines.reduce((s, l) => s + l[1], 0);
  return { lines, total };
}

// ---------- storage ----------
function readAll() { try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return []; } }
function writeAll(list) { fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2)); }

// ---------- LINE ----------
async function linePush(to, text) {
  if (!LINE_TOKEN || !to) { console.log('[LINE ปิดอยู่]', to || '-', '\n' + text); return; }
  try {
    const r = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + LINE_TOKEN },
      body: JSON.stringify({ to, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
    });
    if (!r.ok) console.error('LINE push error', r.status, await r.text());
  } catch (e) { console.error('LINE push failed', e.message); }
}
function bookingText(b, head) {
  return [
    head,
    `เลขที่: ${b.id}`,
    `สถานะ: ${STATUS[b.status]}`,
    `รถ: ${VEHICLES[b.vehicle].name}`,
    `รับของ: ${b.pickup}`,
    ...b.drops.map((d, i) => `ส่งจุด ${i + 1}: ${d}`),
    `เวลา: ${b.when === 'now' ? 'ด่วน (เร็วที่สุด)' : new Date(b.when).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`,
    `ผู้ติดต่อ: ${b.contact.name} ${b.contact.phone}`,
    `ราคาประเมิน: ${b.quote.total.toLocaleString()} บาท`,
    b.note ? `หมายเหตุ: ${b.note}` : '',
  ].filter(Boolean).join('\n');
}
async function notify(b, head) {
  const text = bookingText(b, head);
  const targets = new Set([...LINE_ADMIN_TO, b.lineUserId].filter(Boolean));
  if (!targets.size) return linePush('', text);
  await Promise.all([...targets].map(t => linePush(t, text)));
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function send(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function body(req) {
  return new Promise((ok, bad) => { let d = ''; req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); }); req.on('end', () => ok(d)); req.on('error', bad); });
}
const isAdmin = req => req.headers['x-admin-key'] === ADMIN_KEY;

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/config' && req.method === 'GET')
      return send(res, 200, { vehicles: VEHICLES, extras: EXTRAS, status: STATUS, lineAddFriendUrl: process.env.LINE_ADD_FRIEND_URL || '' });

    if (url.pathname === '/api/quote' && req.method === 'POST')
      return send(res, 200, quote(JSON.parse(await body(req))));

    if (url.pathname === '/api/bookings' && req.method === 'POST') {
      const b = JSON.parse(await body(req));
      if (!b.pickup || !b.drops?.length || !b.contact?.name || !b.contact?.phone) return send(res, 400, { error: 'กรอกข้อมูลไม่ครบ' });
      const booking = {
        id: 'OF' + Date.now().toString(36).toUpperCase(),
        createdAt: new Date().toISOString(), status: 'pending',
        vehicle: b.vehicle, pickup: String(b.pickup), drops: b.drops.map(String), distanceKm: Number(b.distanceKm) || 0,
        when: b.when || 'now', extras: b.extras || {}, contact: b.contact, note: b.note || '',
        lineUserId: (b.lineUserId || '').trim(), deviceId: b.deviceId || '',
      };
      booking.quote = quote(booking);
      const all = readAll(); all.unshift(booking); writeAll(all);
      notify(booking, '🚚 มีการจองรถใหม่');
      return send(res, 201, booking);
    }

    if (url.pathname === '/api/bookings' && req.method === 'GET') {
      const all = readAll();
      if (isAdmin(req)) return send(res, 200, all);
      const dev = url.searchParams.get('device');
      return send(res, 200, dev ? all.filter(b => b.deviceId === dev) : []);
    }

    const m = url.pathname.match(/^\/api\/bookings\/([\w]+)\/status$/);
    if (m && req.method === 'POST') {
      const { status } = JSON.parse(await body(req));
      const all = readAll(); const b = all.find(x => x.id === m[1]);
      if (!b) return send(res, 404, { error: 'ไม่พบการจอง' });
      // ลูกค้ายกเลิกเองได้ตอนยังรอยืนยัน, สถานะอื่นต้องเป็นแอดมิน
      const customerCancel = status === 'cancelled' && b.status === 'pending';
      if (!isAdmin(req) && !customerCancel) return send(res, 403, { error: 'ไม่มีสิทธิ์' });
      if (!STATUS[status]) return send(res, 400, { error: 'สถานะไม่ถูกต้อง' });
      b.status = status; b.updatedAt = new Date().toISOString(); writeAll(all);
      notify(b, '🔔 อัปเดตสถานะการจอง');
      return send(res, 200, b);
    }

    // LINE webhook: ทักบอทเพื่อรับ "รหัส LINE" ไปใส่ในแอป
    if (url.pathname === '/webhook' && req.method === 'POST') {
      const raw = await body(req);
      if (LINE_SECRET) {
        const sig = crypto.createHmac('sha256', LINE_SECRET).update(raw).digest('base64');
        if (sig !== req.headers['x-line-signature']) return send(res, 401, { error: 'bad signature' });
      }
      for (const ev of JSON.parse(raw).events || []) {
        const id = ev.source?.groupId || ev.source?.userId;
        console.log('[LINE webhook]', ev.type, 'source id =', id);
        // ตอบรหัสเมื่อ: เพิ่มเพื่อน, บอทถูกเชิญเข้ากลุ่ม, หรือมีคนพิมพ์ "id" / "รหัส" (กลุ่มจะได้ไม่โดนตอบทุกข้อความ)
        const askId = ev.type === 'message' && /^(id|รหัส)$/i.test((ev.message?.text || '').trim());
        if (ev.replyToken && (ev.type === 'follow' || ev.type === 'join' || askId)) {
          await fetch('https://api.line.me/v2/bot/message/reply', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + LINE_TOKEN },
            body: JSON.stringify({ replyToken: ev.replyToken, messages: [{ type: 'text',
              text: `สวัสดีครับ 👋 รหัส LINE ของ${ev.source?.groupId ? "กลุ่มนี้ (ใส่ใน LINE_ADMIN_TO)" : "คุณ (วางในแอป เมนู ตั้งค่า)"}:\n\n${id}` }] }),
          }).catch(() => {});
        }
      }
      return send(res, 200, { ok: true });
    }

    // static files
    let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[\/\\])+/, '');
    if (p === '/' || p === '\\') p = '/index.html';
    if (p === '/admin') p = '/admin.html';
    let file = path.join(PUBLIC, p);
    // สำรอง: ถ้าไฟล์หน้าเว็บถูกอัปโหลดไว้ชั้นนอกสุด (ไม่มีโฟลเดอร์ public) ให้หาจากชั้นนอกสุด เฉพาะไฟล์หน้าเว็บที่อนุญาตเท่านั้น
    const base = path.basename(p);
    if (!fs.existsSync(file) && WEB_FILES.has(base) && fs.existsSync(path.join(__dirname, base))) file = path.join(__dirname, base);
    if (!(file.startsWith(PUBLIC) || WEB_FILES.has(path.basename(file))) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.existsSync(path.join(PUBLIC, 'index.html')) || fs.existsSync(path.join(__dirname, 'index.html'))
        ? '<p>ไม่พบหน้านี้ <a href="/">กลับหน้าแรก</a></p>'
        : '<h3>ไม่พบโฟลเดอร์ public/index.html บนเซิร์ฟเวอร์</h3><p>ตรวจว่าอัปโหลดโฟลเดอร์ public ขึ้น GitHub ครบ</p>');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': p === '/sw.js' ? 'no-cache' : 'public, max-age=300' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e); send(res, 500, { error: e.message });
  }
}).listen(PORT, () => {
  if (!fs.existsSync(path.join(PUBLIC, 'index.html'))) console.error('❌ ไม่พบ public/index.html — ตรวจว่าอัปโหลดโฟลเดอร์ public ขึ้น GitHub แล้ว');
  console.log(`Omo Flow Booking เปิดที่ http://localhost:${PORT}  (แอดมิน: /admin)`);
  if (!LINE_TOKEN) console.log('ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN — ข้อความแจ้งเตือนจะแสดงในคอนโซลแทน');
});

function loadEnv(f) {
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
