# DESIGN.md — Flip7 บนโครง Hillkoff Enterprise

ระบบดีไซน์ของ scan-to-sheet ไฟล์นี้เป็น **แหล่งอ้างอิงเดียว** ของค่าสี ตัวเลข contrast ตาราง component และกฎที่ต้องผ่านก่อนถือว่างาน UI เสร็จ ห้ามคิดค่าใหม่ที่ไม่มีในไฟล์นี้ และห้ามคัดลอกค่าจากไฟล์นี้ไป hardcode ที่ call site — ทุกสีต้องเรียกผ่าน CSS variable ใน `src/styles.css`

---

## 1. หลักการผสม — โครง Hillkoff + สำเนียง Flip7

ระบบนี้เกิดจากการรวมสองสิ่งที่ปรัชญาต่างกัน จึงต้องระบุให้ชัดว่าใครชนะเรื่องอะไร ไม่ปล่อยให้ตีความเอง

**โครง (structure) มาจาก Hillkoff Enterprise — ชนะเสมอเมื่อขัดกัน**

แอปนี้คือ operational tool ที่พนักงานมองจอทั้งวันเพื่อสแกนพัสดุ ความหนาแน่นของข้อมูล ความอ่านออก และความนิ่งของภาพจึงมาก่อนความสนุก สิ่งที่ห้ามเปลี่ยน:

- `:root` **ชุดเดียว** ที่ต้นไฟล์ `src/styles.css` (เคยมี 4 ชุดในไฟล์เดียว ชุดล่างชนะเงียบๆ ตาม source order → สีเพี้ยนซ้ำๆ หาสาเหตุไม่เจอ)
- **มี dark mode** และต้อง set ก่อน paint แรกด้วย inline script ใน `<head>` (Flip7 ต้นฉบับไม่มีโหมดมืดเลย ส่วนนี้ Flip7 ไม่มีสิทธิ์ออกเสียง)
- **การ์ดทึบ** ห้าม `backdrop-filter: blur()` บนการ์ด อนุญาตเฉพาะ overlay หลัง modal (3px)
- **เงาชั้นเดียว** ไม่ซ้อนหลายชั้นเพื่อความลึกแบบ marketing
- **ห้าม hover lift/scale ที่เป็นแค่การตกแต่ง** — ตารางที่มี 40 แถวขยับตอนเอาเมาส์ผ่านคือ noise ไม่ใช่ feedback
- **ห้าม blanket transition** ครอบทุก element (เคยทำให้ UI หน่วงทั้งแอป)
- ความหนาแน่น: padding และ font-size ระดับ dashboard ไม่ใช่ระดับ landing page

**สำเนียง (accent) มาจาก Flip7 — ใช้ได้เมื่อไม่ชนกฎข้างบน**

- **จานสีอุ่นสามสี**: gold เป็น CTA/celebration, coral เป็นภาวะเสียหาย/ต้องรีบ, sky เป็นข้อมูลแจ้งให้ทราบ — สื่อสาร "สถานะ" ด้วยสีที่แยกจากกันชัดแทนที่จะเป็น teal ล้วนทั้งจอ
- **ปุ่มทรง pill** สำหรับ action button และ badge (การ์ด/พาเนล/ตารางยังเป็นสี่เหลี่ยมมุมมน)
- **มุมโค้งตรงสเกล Flip7** (8/16/24/32rpx → 4/8/12/16px)
- **glow เงาสีติดค้าง** บน element ที่กดได้ (ปุ่มหลัก, CTA, สถานะที่เลือกอยู่) — ไม่ใช่บนการ์ดหรือพาเนล
- **เงาการ์ดเป็นสีแบรนด์** (`--shadow-card`) ไม่ใช่เงาดำ ตาม Flip7 shadow-card
- **ปุ่มเพิ่ม/ลบทรงสี่เหลี่ยมมน 40px** ตาม Flip7 counter button (80rpx)
- **แถบสีขอบซ้ายการ์ด** บอกสถานะ (Flip7: "use left-border color accents on cards for state communication") — ตรงกับที่โปรเจกต์นี้ทำอยู่แล้วบางจุด ให้ทำให้ครบ
- **หัวข้อ section เส้นประ** ใต้หัวข้อ
- **press feedback** `scale(0.96)` + ease แบบ bounce
- **input พื้นครีม `#FFF8E7`** ตรงสเปก แยกพื้นที่กรอกออกจากพื้นที่อ่าน
- **หัวข้อหนา 800** พร้อม letter-spacing

**สีแบรนด์เป็น teal ของ Flip7 แล้ว**

`--primary-fill` = `#2BA8A2` ตรงสเปก Flip7 ส่วนค่าที่ต้องอ่านเป็น **ตัวหนังสือ** ใช้เฉดเดียวกันที่ไล่ให้เข้มลงจนผ่านเกณฑ์ เพราะ `#2BA8A2` บนขาววัดได้เพียง 2.906 และ Primary Dark `#1E8C86` ของ Flip7 เองได้ 4.077 (ผ่านเฉพาะตัวใหญ่)

ทุกค่าคือการคูณ `#2BA8A2` ด้วยอัตราส่วนคงเฉด (คง R:G:B เดิม) จึงเป็น teal ของ Flip7 ทั้งตระกูล:

| ใช้เป็น | ค่า | ที่มา |
|---|---|---|
| ตัวหนังสือ/ขอบ (light) | `#1e7671` | k=0.70 ของ `#2BA8A2` |
| ตัวหนังสือเน้น (light) | `#1a6561` | k=0.60 |
| พื้น (ทั้งสองธีม) | `#2BA8A2` | ตรงสเปก |
| ตัวหนังสือบนพื้นนั้น | `#0a2320` | 5.671 |
| tint | `#E8F6F5` | Flip7 Primary BG ตรงสเปก |
| topbar | `#1a6561` / `#0d3231` | ขาวทับได้ 6.823 / 13.837 |
| ตัวหนังสือ (dark) | `#3CC4BD` | Flip7 Primary Light ตรงสเปก |
| ตัวหนังสือเน้น (dark) | `#3ae3db` | k=1.35 |

**ข้อควรรู้: จานสี Flip7 ทั้ง 12 สี ไม่มีสีใดใช้เป็นตัวหนังสือปกติบนพื้นสว่างของ Flip7 ได้**

วัดครบทุกคู่แล้ว: ดีที่สุดคือ primary-dark `#1E8C86` = 4.077 (ผ่านเฉพาะตัวใหญ่) · teal 2.906 · coral 3.037 · sky 2.459 · gold 1.444 และ **ตัวหนังสือขาวบนพื้นสี Flip7 ก็ไม่ผ่านสักสีเดียว** (สูงสุด 4.155) ส่วนตัวหนังสือ**เข้ม**บนพื้นสีเดียวกันผ่าน 9 จาก 12 — นี่คือเหตุผลที่ทุก token สีสดในระบบนี้ต้องมี `--on-*` เป็นตัวหนังสือเข้ม สเปก Flip7 เองไม่ได้กำหนดสีตัวหนังสือไว้เลย เพราะบนมินิโปรแกรม WeChat ค่านั้นมาจาก default ของแพลตฟอร์ม

**สิ่งที่ Flip7 มีแต่ตัดออก พร้อมเหตุผล**

| ของ Flip7 | เหตุผลที่ไม่เอา |
|---|---|
| หน่วย `rpx` | ไม่มีใน CSS ของเว็บ (เป็นของ WeChat mini-program) แปลงเป็น px ที่ 1rpx = 0.5px แล้วปัดเข้าสเกล 4px |
| confetti, crown bounce, glow pulse, BOOM pulse | animation วนไม่สิ้นสุดบนหน้าจอที่เปิดทิ้งไว้ทั้งวัน — กินแบตแท็บเล็ตหน้างานและดึงสายตาออกจากช่องสแกน |
| โลโก้การ์ดกางพัด / ribbon banner พับ | เป็นภาษาของกล่องบอร์ดเกม ไม่ใช่ของ topbar เครื่องมือทำงาน |
| gold `#FFD23F` เป็นสีตัวหนังสือ | 1.44–2.56 บนพื้นขาว อ่านไม่ออกสิ้นเชิง → gold เป็น **พื้น** เท่านั้น ส่วนตัวหนังสือใช้ `--accent` ที่เข้มลงมา |
| ตัวหนังสือขาวบน coral | ขาวบน `#EF6C4A` = 3.037 ตก → coral เป็นพื้นต้องใช้ **ตัวหนังสือเข้ม** `--on-coral` |
| medal/podium tier (silver/bronze) | ไม่มี concept การจัดอันดับในแอปนี้ |

---

## 2. Token contract

ทุกค่าอยู่ใน `:root` และ `:root[data-theme="dark"]` ที่ต้นไฟล์ `src/styles.css` เท่านั้น

### พื้นและตัวหนังสือ (Hillkoff เดิม ไม่เปลี่ยน)

| Token | Light | Dark | ใช้ทำอะไร |
|---|---|---|---|
| `--page` | `#eaf4f3` | `#04120f` | พื้นหลังหน้า |
| `--page-soft` | `#dcede9` | `#0c211e` | พื้นรองบนหน้า |
| `--surface` | `#ffffff` | `#14201f` | พื้นการ์ด/พาเนล |
| `--surface-soft` | `#f3f8f7` | `#0f1918` | พื้นรองในการ์ด, หัวตาราง |
| `--text` | `#1c1c1e` | `#f5f5f7` | ตัวหนังสือหลัก |
| `--muted` | `#5c6b69` | `#9aa5a3` | ตัวหนังสือรอง |
| `--line` / `--line-strong` | `#dde3e2` / `#c7d0ce` | `#223330` / `#2f4642` | เส้นขอบ |

### แบรนด์ teal (เฉด Flip7)

| Token | Light | Dark | หมายเหตุ |
|---|---|---|---|
| `--primary` | `#1e7671` | `#3CC4BD` | teal สำหรับ text/border |
| `--primary-strong` | `#1a6561` | `#3ae3db` | เน้นกว่า |
| `--primary-soft` | `#E8F6F5` | `rgba(60,196,189,0.16)` | tint (light ใช้ Flip7 Primary BG ตรงสเปก เป็นสีทึบ) |
| `--primary-fill` | `#2BA8A2` | `#2BA8A2` | **พื้นตรงสเปก Flip7** เท่ากันสองธีมเพราะมีตัวหนังสือเข้มทับ |
| `--on-primary` | `#0a2320` | `#0a2320` | ตัวหนังสือบน `--primary-fill` — **ห้ามเป็นขาว** (ขาวบน `#2BA8A2` = 2.906) |
| `--on-danger` | `#ffffff` | `#ffffff` | ตัวหนังสือบน `--danger-fill` แยกจาก `--on-primary` ที่เป็นตัวเข้มแล้ว |
| `--on-topbar` | `#ffffff` | `#ffffff` | ตัวหนังสือบน `--topbar-bg` |
| `--topbar-bg` | `#1a6561` | `#0d3231` | เข้มทั้งสองธีม เพื่อให้ตัวขาวและ pill ของ theme toggle อ่านได้ |

### สำเนียง Flip7 — gold / coral / sky (ของใหม่)

หลักการเดียวกับ `--primary` / `--primary-fill`: **สีตัวหนังสือกับสีพื้นเป็น token แยกกัน** เพราะค่าที่อ่านออกเป็นตัวหนังสือกับค่าที่เอาอะไรทับได้ ไม่ใช่ค่าเดียวกัน

| Token | Light | Dark | ใช้ทำอะไร |
|---|---|---|---|
| `--accent` | `#7a5600` | `#FFD23F` | gold เป็น **ตัวหนังสือ/ไอคอน/ขอบ** |
| `--accent-fill` | `#FFD23F` | `#FFD23F` | gold เป็น **พื้น** (CTA, badge เน้น) — เท่ากันสองธีมเพราะเป็นพื้นที่มีตัวเข้มทับ |
| `--on-accent` | `#2a2100` | `#2a2100` | ตัวหนังสือบน `--accent-fill` |
| `--accent-soft` | `rgba(255,210,63,0.18)` | `rgba(255,210,63,0.16)` | tint อ่อน |
| `--accent-line` | `rgba(201,155,60,0.5)` | `rgba(255,210,63,0.38)` | ขอบของพื้น tint |
| `--coral` | `#a83620` | `#FF8A6A` | coral เป็น **ตัวหนังสือ/ไอคอน/แถบขอบซ้าย** |
| `--coral-fill` | `#EF6C4A` | `#EF6C4A` | coral เป็น **พื้น** |
| `--on-coral` | `#2a0d06` | `#2a0d06` | ตัวหนังสือบน `--coral-fill` — **ต้องเข้ม** ตัวขาวตก (3.037) |
| `--coral-soft` | `rgba(239,108,74,0.10)` | `rgba(239,108,74,0.12)` | tint อ่อน |
| `--coral-line` | `rgba(239,108,74,0.34)` | `rgba(255,138,106,0.35)` | ขอบ |
| `--info` | `#14567f` | `#7cc0ea` | sky เป็น **ตัวหนังสือ/ไอคอน/ขอบ** |
| `--info-fill` | `#5DADE2` | `#5DADE2` | sky เป็น **พื้น** |
| `--on-info` | `#0a2433` | `#0a2433` | ตัวหนังสือบน `--info-fill` |
| `--info-soft` | `rgba(93,173,226,0.14)` | `rgba(93,173,226,0.14)` | tint อ่อน |
| `--info-line` | `rgba(93,173,226,0.38)` | `rgba(124,192,234,0.35)` | ขอบ |
| `--field` | `#FFF8E7` | `#1d2320` | **พื้น input** ครีมตรงสเปก Flip7 ใช้ได้เพราะไม่มี `--primary` เป็นตัวหนังสือทับแล้ว |
| `--control-line` | `#788784` | `#637d78` | **ขอบของ control** ต้องได้ 3:1 ตาม WCAG 1.4.11 |
| `--topbar-control-line` | `rgba(255,255,255,0.55)` | (ค่าเดียวกัน) | ขอบของ control ที่นั่งบน `--topbar-bg` ซึ่งเข้มทั้งสองธีม |

### สถานะ (Hillkoff เดิม ไม่เปลี่ยน)

`--warning` `#9c5205` / `#e8942f` · `--danger` `#b02b23` / `#ef6a60` · `--success` `#1b7a3d` / `#45b96c` พร้อม `-bg` `-line` และ `--danger-fill`
ค่าเหล่านี้ถูกดันให้เข้มขึ้นจากค่าเดิมเพราะวัดแล้วตก — `--warning` เดิม `#b45f06` ได้ 4.03 บน tint ตัวเอง, `--danger` เดิม `#c0342b` ได้ 4.293, dark `--danger-bg` เดิม 0.16 ได้ 4.443 ลดเป็น 0.12 ได้ 4.72

**`--coral` ไม่ใช่ `--danger`** — `--danger` คือ "ทำงานล้มเหลว/ข้อมูลผิด" (แดง) ส่วน `--coral` คือ "เร่งด่วน/ต้องเข้าไปดู" ที่ยังไม่ใช่ error เช่นรายการที่หาไม่เจอในรอบตรวจ ห้ามใช้สลับกัน

### รูปทรง

| Token | ค่า | ที่มา Flip7 | ใช้กับ |
|---|---|---|---|
| `--radius-sm` | `4px` | 8rpx | tag, ป้ายเล็ก, `.code-cell` |
| `--radius-md` | `8px` | 16rpx | ปุ่มทั่วไป, ช่องกรอก |
| `--radius-lg` | `12px` | 24rpx | การ์ด, พาเนล |
| `--radius-xl` | `16px` | 32rpx | modal, การ์ดหลัก |
| `--radius-full` | `999px` | round | **ปุ่ม action ทุกตัว, badge, chip, avatar** |

### เงาและ glow

| Token | Light | ใช้กับ |
|---|---|---|
| `--shadow-sm` | `0 1px 2px rgba(16,24,32,0.06)` | การ์ดปกติ |
| `--shadow-md` | `0 1px 3px rgba(16,24,32,0.08)` | การ์ดที่ลอยกว่าเล็กน้อย |
| `--shadow-modal` | `0 12px 32px rgba(16,24,32,0.18)` | modal เท่านั้น |
| `--shadow-card` | `0 2px 10px rgba(4,129,125,0.12)` | **การ์ดและพาเนล** — เงาเป็นสีแบรนด์ ไม่ใช่ดำ ตาม Flip7 shadow-card |
| `--glow-primary` | `0 2px 12px rgba(4,129,125,0.30)` | ปุ่มหลักตอน hover/focus |
| `--glow-accent` | `0 2px 12px rgba(201,155,60,0.40)` | CTA gold |
| `--glow-coral` | `0 2px 12px rgba(239,108,74,0.32)` | ปุ่ม/การ์ดภาวะเร่งด่วน |
| `--glow-info` | `0 2px 12px rgba(93,173,226,0.30)` | element ข้อมูล |
| `--shadow-focus` | `0 0 0 4px var(--focus-ring)` | ring ตอน focus |

glow ใช้ได้ **เฉพาะ element ที่กดได้** และตาม Flip7 ("Do use colored glow shadows for interactive elements") จะ **ติดค้างอยู่ตลอด** ไม่ใช่เฉพาะตอน hover สำหรับ:

- ปุ่มบันทึกการสแกน (`--glow-accent`)
- `.primary-action` และ `.secondary-button` (`--glow-primary`)
- สถานะที่เลือกอยู่: tab active, ปุ่มขนส่งที่เลือก (`--glow-primary` หรือ `--glow-info` ในโหมด Drive)
- ปุ่มแจ้งปัญหาที่กดค้างไว้ (`--glow-coral`)

**ห้ามใส่ glow บนการ์ดหรือพาเนลที่กดไม่ได้** — การ์ดข้อมูลที่วางเรียงกันหลายใบพร้อม glow ทุกใบจะกลบกันเองจนไม่เหลือความหมาย การ์ดใช้ `--shadow-card` ซึ่งเป็นเงาสีแบรนด์แบบจาง

### จังหวะการเคลื่อนไหว

| Token | ค่า |
|---|---|
| `--ease-bounce` | `cubic-bezier(0.34, 1.35, 0.64, 1)` |
| `--dur-press` | `0.12s` |
| `--dur-ui` | `0.18s` |

- transition ใส่ **เฉพาะ property ที่ต้องการ feedback** (`background-color`, `border-color`, `box-shadow`, `transform`) ห้าม `transition: all`
- press: `transform: scale(0.96)` (Flip7 ใช้ 0.95, ขยับเป็น 0.96 เพราะปุ่มที่นี่เล็กกว่าปุ่มเกมบนมือถือ)
- ห้าม animation ที่วนไม่จบ ยกเว้น `.spin` ของ loading ซึ่งเป็น feedback จริง
- micro-interaction **ห้ามเกิน 500ms** (กฎของ Flip7 เอง) — `flash-success` ตอนสแกนติดใช้ 0.45s
- ต้องเคารพ `prefers-reduced-motion: reduce`

### ระยะห่าง

ฐาน 4px (Flip7 8rpx) — `xs 4` · `sm 8` · `md 12` · `lg 16` · `xl 24` · `2xl 32`
โค้ดเดิมมีค่าดิบ 7/9/10/11px กระจายอยู่ ไม่ต้องไปรื้อทั้งไฟล์ แต่**โค้ดใหม่ต้องอยู่บนสเกลนี้**

### ตัวหนังสือ

- ฟอนต์: **Kanit** (แบรนด์ hillkoff.com) fallback `"Noto Sans Thai", system-ui, -apple-system, sans-serif`
  โหลดแบบ **บันเดิลผ่าน `@fontsource/kanit` ใน `src/main.jsx`** ไม่ใช่จาก CDN โดยเจตนา เพราะแอปนี้เป็น PWA ที่ต้องใช้งานได้ตอนไม่มีเน็ตบนหน้างาน — **ห้ามเพิ่ม `<link>` ไป Google Fonts**
- น้ำหนักที่ใช้: 400 (body) · 500 (label) · 600/700 (เน้น) · 800 (หัวข้อ, ตัวเลข metric, ปุ่ม)
  **ทุกน้ำหนักที่ CSS อ้างถึงต้องมี import ของตัวเองใน `main.jsx`** ถ้าไม่มี เบราว์เซอร์จะสังเคราะห์ตัวหนาจากน้ำหนักที่ใกล้ที่สุด ซึ่งกับพยัญชนะไทยทำให้หัวของ ค ด ต ตันและสระบนหนาไปชนบรรทัดเหนือ
- หัวข้อใช้ 800 ตาม Flip7 แต่ **letter-spacing ติดลบ** (`-0.02em`) ไม่ใช่บวกแบบ Flip7 เพราะพยัญชนะไทยที่ระยะห่างมากจะอ่านช้าลง
- `body { line-height: 1.5 }` · `-webkit-font-smoothing: antialiased` · `-moz-osx-font-smoothing: grayscale` · `text-rendering: optimizeLegibility`
- ตัวเลขในตาราง/metric ใช้ `font-variant-numeric: tabular-nums` เพื่อให้หลักตรงกัน

---

## 3. ตาราง contrast ที่วัดแล้ว

ทุกค่าคำนวณตามสูตร WCAG relative luminance โดย **composite สีที่มี alpha กับพื้นจริงก่อน** ไม่ได้คิดจากค่าดิบ เกณฑ์: ตัวหนังสือปกติ **4.5:1** · ตัวใหญ่ ≥24px หรือ ≥18.66px bold **3:1**

### Light

| คู่สี | ค่า | ผล |
|---|---|---|
| `--accent` `#7a5600` บน `--surface` | 6.648 | ผ่าน |
| `--accent` บน `--page` | 5.931 | ผ่าน |
| `--accent` บน `--accent-soft` เหนือ `--page` | 5.629 | ผ่าน |
| `--accent` บน `--field` | 6.532 | ผ่าน |
| `--on-accent` บน `--accent-fill` | 11.051 | ผ่าน |
| `--coral` `#a83620` บน `--surface` | 6.535 | ผ่าน |
| `--coral` บน `--coral-soft` เหนือ `--page` | 5.283 | ผ่าน |
| `--on-coral` บน `--coral-fill` | 5.967 | ผ่าน |
| `--info` `#14567f` บน `--surface` | 7.873 | ผ่าน |
| `--info` บน `--info-soft` เหนือ `--page` | 6.434 | ผ่าน |
| `--on-info` บน `--info-fill` | 6.505 | ผ่าน |
| `--text` บน `--field` | 16.717 | ผ่าน |
| `--muted` บน `--field` | 5.484 | ผ่าน |
| `--primary` บน `--field` `#FFF8E7` | 4.465 | **ตก — ห้ามใช้** ใช้ `--primary-strong` (6.435) |
| `--primary-strong` บน `--field` | 6.435 | ผ่าน |
| `--control-line` เป็นขอบบน `--field` | 3.543 | ผ่าน (เกณฑ์ control 3:1) |
| `--control-line` เป็นขอบบน `--surface` | 3.752 | ผ่าน |
| `--topbar-control-line` เป็นขอบบน `--topbar-bg` | 3.206 | ผ่าน |

### Dark

| คู่สี | ค่า | ผล |
|---|---|---|
| `--accent` `#FFD23F` บน `--surface` | 11.577 | ผ่าน |
| `--accent` บน `--accent-soft` เหนือ `--surface` | 7.392 | ผ่าน |
| `--accent` บน `--topbar-bg` | 10.098 | ผ่าน |
| `--coral` `#FF8A6A` บน `--surface` | 7.241 | ผ่าน |
| `--coral` บน `--coral-soft` เหนือ `--surface` | 6.221 | ผ่าน |
| `--info` `#7cc0ea` บน `--surface` | 8.427 | ผ่าน |
| `--info` บน `--info-soft` เหนือ `--surface` | 6.599 | ผ่าน |
| `--text` บน `--field` `#1d2320` | 14.683 | ผ่าน |
| `--muted` บน `--field` | 6.307 | ผ่าน |
| `--primary` บน `--field` | 5.154 | ผ่าน |
| `--control-line` เป็นขอบบน `--field` | 3.605 | ผ่าน |
| `--control-line` เป็นขอบบน `--surface` | 3.770 | ผ่าน |
| `--topbar-control-line` เป็นขอบบน `--topbar-bg` | 5.418 | ผ่าน |
| `--accent` บน `--field` | 11.071 | ผ่าน |

### ค่าที่วัดแล้ว **ไม่ผ่าน** จึงห้ามใช้

| คู่สี | ค่า | ทางที่ใช้แทน |
|---|---|---|
| `#ffffff` บน gold `#FFD23F` | 1.444 | ตัวหนังสือเข้ม `--on-accent` |
| gold `#FFD23F` เป็นตัวหนังสือบนพื้นขาว | 2.559 | `--accent` `#7a5600` |
| `--brand-gold` `#c89b3c` เป็นตัวหนังสือบนพื้นขาว | 2.558 | `--accent` (token เดิมนี้ใช้เป็นสีตัวหนังสือไม่ได้) |
| `#ffffff` บน coral `#EF6C4A` | 3.037 | `--on-coral` `#2a0d06` |
| coral `#EF6C4A` เป็นตัวหนังสือบนพื้นขาว | 3.037 | `--coral` `#a83620` |
| coral `#D45233` บนพื้นขาว | 4.155 | `--coral` |
| coral `#b8402a` บน tint 10% เหนือ `--page` | 4.462 | `--coral` `#a83620` (5.283) |
| sky `#5DADE2` เป็นตัวหนังสือบนพื้นขาว | 2.459 | `--info` `#14567f` |
| sky `#2E86C1` บนพื้นขาว | 3.965 | `--info` |
| `#ffffff` บน sky `#5DADE2` | 2.459 | `--on-info` `#0a2433` |
| `--primary` บน cream `#FFF8E7` | 4.465 | `--primary-strong` (6.435) เป็นตัวหนังสือ/ไอคอนในช่องกรอก |
| ตัวขาวบน `--primary-fill` `#2BA8A2` | 2.906 | `--on-primary` `#0a2320` (5.671) |
| `#2BA8A2` เป็นขอบของปุ่มที่ถมสีเดียวกัน | 2.906 | ขอบ `--primary` `#1e7671` (5.405) |
| พื้นขาวของตัวเลือกที่ active บนรางสีอ่อน | 1.072 | ใส่ขอบ `--primary` |
| `--line-strong` `#c7d0ce` เป็นขอบของ control | 1.486 | `--control-line` `#788784` (3.752) |
| ขอบ control บน topbar ที่ขาว 34% | 2.109 light / 2.963 dark | `--topbar-control-line` ขาว 55% |
| ตัวขาวบน `--primary` เดิม `#058581` | 4.489 | `--primary-fill` `#04817d` |

**เวลาแตะเรื่องสี ต้องวัดจาก DOM จริงทั้งสองธีม ห้ามเดา** เหตุผล: กรณี 4.489 กับ 4.465 ข้างบนคือตกเกณฑ์แบบมองด้วยตาไม่เห็นเลย และทั้งสองกรณีทำให้ element หลักทั้งแอปตกมาตรฐานพร้อมกัน

---

## 4. Component

| Component | รูปทรง | สีพื้น | สถานะ |
|---|---|---|---|
| ปุ่มหลัก (primary action) | pill, สูง ≥36px | `--primary-fill` + `--on-primary` | hover `--glow-primary`, active `scale(0.96)` |
| CTA เน้นสุด (ยืนยันงานสำคัญ) | pill | `--accent-fill` + `--on-accent` | hover `--glow-accent` |
| ปุ่มรอง (secondary) | pill | `--surface` + ขอบ `--line-strong` | hover พื้น `--surface-soft` |
| ปุ่มโปร่ง (ghost) | pill | โปร่งใส + `--primary` | hover พื้น `--primary-soft` |
| ปุ่มอันตราย | pill | `--danger-fill` + `--on-danger` | hover `--glow-coral` |
| ปุ่มแจ้งปัญหาที่กดค้าง | pill | `--coral-fill` + `--on-coral` (5.967) | glow `--glow-coral` — เทียบได้กับ BOOM button ของ Flip7 |
| ช่องติ๊ก / เรดิโอ | หน้าตา native ของระบบ | `accent-color: var(--primary-fill)` | **ต้องถูกกันออกจากกฎรวมของช่องกรอก** ไม่งั้น `accent-color` ไม่มีผลและกล่องกลายเป็นสี่เหลี่ยมเปล่า |
| ปุ่มไอคอน | วงกลม `--radius-full` | `--surface` | ขนาดกดได้ ≥36px |
| input / select / textarea | `--radius-md` | **`--field`** | ขอบ `--control-line` · focus: ขอบ `--primary` + `--shadow-focus` |
| ปุ่มเพิ่ม/ลบ (counter) | สี่เหลี่ยมมน `--radius-md` 40px | เพิ่ม: `--primary-soft` · ลบ: ตัวหนังสือ `--coral` | Flip7 counter button 80rpx |
| กล่อง input ประกอบ (มีปุ่มในกรอบ) | `--radius-md` | `--field` | `:focus-within` ต้องได้ ring เดียวกัน |
| การ์ด / พาเนล | `--radius-lg`, ทึบ | `--surface` + ขอบ `--line` | `--shadow-sm` ไม่มี glow ไม่มี hover lift |
| การ์ดบอกสถานะ | เพิ่ม `border-inline-start: 3px` (Flip7 6rpx) | แถบ: `--primary` ปกติ · `--accent` เน้น · `--coral` เร่งด่วน · `--danger` ผิดพลาด · `--success` เรียบร้อย | — |
| badge / chip / status | pill | `-soft` + ตัวหนังสือสีเดียวกัน + ขอบ `-line` | — |
| tab | pill ในราง | active: `--primary-fill` + ขาว | — |
| segmented control | pill ในราง | active: `--primary-soft` + `--primary-strong` | — |
| หัวข้อ section | — | — | `border-bottom: 2px dashed var(--line-strong)` |
| ตาราง | หัว `--surface-soft` | แถวคู่ `--surface-soft` | hover เปลี่ยนพื้นได้ **ห้ามขยับ** |
| modal | `--radius-xl` | `--surface` + `--shadow-modal` | overlay blur ได้ไม่เกิน 3px |
| avatar | วงกลม | `--primary-soft` + `--primary-strong` | น้ำหนัก 800 |

**ขนาดที่กดได้**: Flip7 กำหนด 72rpx = 36px เป็นขั้นต่ำ ใช้ค่านี้เป็นขั้นต่ำของทุกปุ่ม/ช่องกรอก และบนหน้าจอ ≤700px (แท็บเล็ตหน้างาน สแกนด้วยนิ้ว) ปุ่มหลักต้อง ≥44px

**สีสำหรับพิมพ์** (`--print-*`) อยู่นอกระบบนี้ทั้งหมด และ **ไม่มีใน block ธีมมืดโดยเจตนา** — ใบตารางเวรที่พิมพ์ออกมาคือหมึกบนกระดาษขาวเสมอ การพิมพ์จากโหมดมืดต้องไม่ลากพื้นเข้มลงกระดาษ ห้ามเอา gold/coral/sky ไปใช้ในบล็อก `@media print`

---

## 5. เกณฑ์ที่ต้องผ่านก่อนถือว่างาน UI เสร็จ

1. contrast ผ่าน 4.5:1 (ตัวใหญ่ 3:1) และ **ขอบเขตของ control ผ่าน 3:1** — รวมถึง **ปุ่มที่ถมสีทึบ**: สีพื้นของ Flip7 เทียบพื้นรอบข้างไม่ผ่านด้วยตัวเอง (teal 2.906 · gold 1.444) ปุ่มพวกนี้จึงต้องมีขอบเฉดเข้มของสีเดียวกัน และ **ตัวเลือกที่ active ใน segmented control** ก็ต้องมีขอบ เพราะพื้นขาวบนรางสีอ่อนวัดได้ 1.072 (WCAG 1.4.11 — control ที่ `disabled` ได้รับการยกเว้นตามข้อกำหนด) **วัดจาก DOM จริงทั้ง light และ dark** ไม่ใช่จากตาราง §3 เพียงอย่างเดียว เพราะการ์ดอาจซ้อนพื้นหลายชั้นจนค่าเปลี่ยน
2. overflow แนวนอน = 0px ที่ **375 / 700 / 1000 / 1400px** และไม่มีข้อความถูกตัด — ช่วง 701–1199px คือจุดที่บั๊กเกิดบ่อยที่สุดเพราะไม่มี media query ครอบ
3. มี **skip link** เป็น focusable ตัวแรก ชี้ไป `<main id="main" tabindex="-1">`
4. ทุก element ที่ focus ได้ต้องมองเห็นวงแหวน focus — **ห้าม `outline: 0` โดยไม่มีตัวแทน**
5. `:root` ยังมีชุดเดียว: `grep -c "^:root" src/styles.css` ต้องได้ 2 (light + dark) เท่านั้น
6. ไม่มี hex/rgba ใหม่นอก `:root` และ **ไม่มีค่ามุมโค้งดิบ** — `grep -n "border-radius: [0-9]" src/styles.css` ต้องเหลือเฉพาะ `0`, เส้นคาด 3px และหน่วย mm ของใบพิมพ์
7. `npm run test:marketplace` และ `npm run build` เขียวทั้งคู่

---

## 6. กับดักของไฟล์ `src/styles.css`

- **`.enterprise-shell` ครอบทั้งแอป** กฎที่ scope ด้วย class นี้ชนะกฎ unscoped เสมอ ถ้าแก้กฎ unscoped แล้วไม่เห็นผล ให้ไปหากฎ `.enterprise-shell` ที่ทับอยู่
- ไฟล์นี้มีกฎ **`.enterprise-shell *` ที่สั่ง `animation: none !important; transition: none !important`** ซึ่งกวาดทั้งแอป ถ้าจะเพิ่ม transition ให้ element ใด ต้องไปยกเว้นที่กฎนั้น **ห้ามแก้ด้วยการใส่ `!important` ซ้อนอีกชั้น** — แก้ที่ต้นเหตุ
- มี legacy hardcode `rgba(4,129,125,...)` ค้างอยู่ในบล็อกบนของไฟล์ (`.app-title`, `.title-badge`, `.title-accent`) แปลงเป็น token เมื่อแตะไฟล์บริเวณนั้น
- **ห้ามให้เทสต์ผูกกับข้อความหรือค่าสีที่แสดงผล** ใช้ `error.code` / class name แทน
