# Omo Flow จองรถขนส่ง (PWA + LINE)

แอปจองรถที่ติดตั้งได้ทั้งคอมพิวเตอร์และมือถือ (Progressive Web App) พร้อมแจ้งเตือนผ่าน LINE

## ฟีเจอร์
- เลือกประเภทรถ 6 แบบ, จุดรับ + หลายจุดส่ง, ค้นหาที่อยู่/ปักหมุดบนแผนที่ (OpenStreetMap)
- ประมาณระยะทางอัตโนมัติ หรือกรอกเอง, จองด่วนหรือล่วงหน้าไม่เกิน 14 วัน
- บริการเสริม: ช่วยยกของ, ผู้ช่วยยกของ, POD — คำนวณราคาทันที
- ประวัติการจอง, ยกเลิกได้ขณะรอยืนยัน, แจ้งเตือนบนเครื่อง
- หน้าแอดมิน `/admin` เปลี่ยนสถานะการจอง → ส่ง LINE หาลูกค้าและทีมอัตโนมัติ
- ทำงานออฟไลน์ได้ (หน้าแอป) ด้วย Service Worker

## เริ่มใช้งาน
1. ติดตั้ง Node.js 18 ขึ้นไป
2. `cp .env.example .env` แล้วแก้ค่า
3. `npm start` → เปิด http://localhost:3000

> การติดตั้งเป็นแอปต้องรันบน **HTTPS** (ยกเว้น localhost) เช่น deploy บน Render, Railway, Fly.io หรือ VPS + Nginx/Caddy

## ตั้งค่า LINE (Messaging API)
> LINE Notify ปิดบริการแล้ว จึงใช้ LINE Messaging API แทน
1. สร้าง LINE Official Account และเปิด Messaging API ที่ https://developers.line.biz
2. คัดลอก **Channel access token** และ **Channel secret** ใส่ใน `.env`
3. ตั้ง Webhook URL เป็น `https://โดเมนของคุณ/webhook` แล้วเปิด "Use webhook"
4. เพิ่มเพื่อน OA หรือเชิญเข้ากลุ่ม บอทจะตอบรหัสกลับมา (พิมพ์ "id" เพื่อขอรหัสอีกครั้ง)
   - ลูกค้า: นำรหัสไปวางในแอป เมนู ตั้งค่า
   - ทีมงาน: ใส่รหัสใน `LINE_ADMIN_TO` (เชิญบอทเข้ากลุ่มเพื่อได้ groupId ก็ได้)
5. ใส่ลิงก์เพิ่มเพื่อนใน `LINE_ADD_FRIEND_URL` เพื่อให้แสดงปุ่มในแอป

## ปรับราคา
แก้ตาราง `VEHICLES` และ `EXTRAS` ใน `server.js` (ราคาที่ใส่ไว้เป็นตัวอย่าง)

## โครงสร้าง
- `server.js` — เว็บเซิร์ฟเวอร์ + API + LINE (ไม่ต้องติดตั้งแพ็กเกจ)
- `public/` — แอป (index.html, app.js, style.css, sw.js, manifest, icons), admin.html
- `data/bookings.json` — ที่เก็บการจอง (ใช้งานจริงควรเปลี่ยนเป็นฐานข้อมูล)
