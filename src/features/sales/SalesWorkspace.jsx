import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, CircleAlert, Plus, RefreshCw, Search, Users, Warehouse } from 'lucide-react';
import { salesApi } from './api/salesApi.js';
import { groupRounds, queueBlocker, rowsOf } from './shared/models.js';

const modules = [
  ['overview', 'ภาพรวม'], ['customers', 'ลูกค้า'], ['orders', 'ออเดอร์'], ['dispatch', 'จัดคิว'], ['outstation', 'ต่างจังหวัด'], ['chiangmai', 'รอบเชียงใหม่'],
];
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
const emptyOrder = () => ({ id: '', customerId: '', deliveryMethod: 'company_driver', workflowType: 'store_first', serviceDate: today(), window: '', boxes: 1, packageUnit: 'กล่อง', paymentType: 'prepaid', cod: 0, bookingNumber: '', salesNote: '' });

function List({ rows, onSelect, actions }) {
  if (!rows.length) return <div className="sales-empty">ยังไม่มีข้อมูลในมุมมองนี้</div>;
  return <div className="sales-list">{rows.map((row) => <article className="sales-row" key={row.id || row.customerId || row.name}>
    <button type="button" className="sales-row-main" onClick={() => onSelect?.(row)}>
      <strong>{row.customerName || row.name || row.id}</strong><span>{row.id || row.phone || '-'}</span>
      <small>{row.status || row.address || row.queueStatus || 'พร้อมตรวจสอบ'}</small>
    </button>{actions?.(row)}
  </article>)}</div>;
}

export default function SalesWorkspace() {
  const initial = new URLSearchParams(window.location.search).get('sales') || 'overview';
  const [module, setModule] = useState(modules.some(([id]) => id === initial) ? initial : 'overview');
  const [query, setQuery] = useState(''); const [rows, setRows] = useState([]); const [selected, setSelected] = useState(null);
  const [dashboard, setDashboard] = useState(null); const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false); const [order, setOrder] = useState(emptyOrder());
  const [customer, setCustomer] = useState({ id: '', name: '', contact: '', phone: '', zone: '', address: '', mapUrl: '', note: '' });
  const navigate = (next) => { setModule(next); setRows([]); setSelected(null); setError(''); const url = new URL(window.location.href); url.searchParams.set('sales', next); window.history.pushState({}, '', url); };
  const dashboardRows = useMemo(() => rowsOf(dashboard), [dashboard]);
  const loadDashboard = async () => { setBusy(true); setError(''); try { const data = await salesApi.dashboard(date); setDashboard(data); setRows(rowsOf(data)); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  useEffect(() => { if (['overview', 'dispatch', 'chiangmai'].includes(module)) void loadDashboard(); }, [module, date]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const onPop = () => setModule(new URLSearchParams(window.location.search).get('sales') || 'overview'); window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop); }, []);
  const search = async (event) => { event?.preventDefault(); if (query.trim().length < (module === 'customers' ? 3 : 2)) return setError('กรุณากรอกคำค้นหาให้ครบ'); setBusy(true); setError(''); try { const data = module === 'customers' ? await salesApi.customers(query) : await salesApi.orders(query, module === 'outstation' ? 'outstation' : undefined); setRows(rowsOf(data)); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const saveCustomer = async (event) => { event.preventDefault(); setBusy(true); setError(''); try { await salesApi.saveCustomer(customer); setNotice('บันทึกลูกค้าแล้ว'); setCreating(false); setQuery(customer.id); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const createOrder = async (event) => { event.preventDefault(); setBusy(true); setError(''); try { await salesApi.createOrder({ ...order, boxes: Number(order.boxes), cod: Number(order.cod) }); setNotice(`สร้างออเดอร์ ${order.id} แล้ว`); setOrder(emptyOrder()); setCreating(false); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const queue = async (row) => { setBusy(true); setError(''); try { await salesApi.queue(row.id); setNotice(`นำ ${row.id} เข้าคิวแล้ว`); await loadDashboard(); } catch (e) { setError(e.message); setBusy(false); } };
  const assignRound = async (row, roundCode) => { if (!roundCode || (row.chiangmaiRoundCode && !window.confirm(`ย้าย ${row.id} จาก ${row.chiangmaiRoundCode} ไป ${roundCode}?`))) return; setBusy(true); try { await salesApi.assignRound(row.id, roundCode); setNotice(`จัดรอบ ${row.id} แล้ว`); await loadDashboard(); } catch (e) { setError(e.message); setBusy(false); } };

  return <section className="sales-workspace" aria-labelledby="sales-title">
    <header className="sales-header"><div><p className="eyebrow">SALES OPERATIONS</p><h2 id="sales-title">Sales Quick Desk</h2><p>ข้อมูลเดียวกับระบบ Hillkoff จัดวางสำหรับงานฝ่ายขายโดยเฉพาะ</p></div><div className="sales-health"><CheckCircle2 size={17} /> API v1 ผ่านเซิร์ฟเวอร์</div></header>
    <div className="sales-layout"><nav className="sales-nav" aria-label="เมนู Sales Quick Desk">{modules.map(([id, label]) => <button type="button" key={id} className={module === id ? 'active' : ''} aria-current={module === id ? 'page' : undefined} onClick={() => navigate(id)}>{label}</button>)}</nav>
      <main className="sales-content" id="sales-main" tabIndex="-1">
        {notice && <div className="sales-notice" role="status">{notice}<button type="button" onClick={() => setNotice('')}>ปิด</button></div>}
        {error && <div className="sales-error" role="alert"><CircleAlert size={18} /> {error}<button type="button" onClick={() => setError('')}>ปิด</button></div>}
        {['overview','dispatch','chiangmai'].includes(module) && <div className="sales-toolbar"><label>วันที่<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label><button type="button" className="secondary-button" onClick={loadDashboard} disabled={busy}><RefreshCw size={16} /> โหลดใหม่</button></div>}
        {module === 'overview' && <><div className="sales-metrics"><div><CalendarDays /><span>งานวันที่เลือก</span><strong>{dashboardRows.length}</strong></div><div><Warehouse /><span>รอเตรียม/ตรวจ</span><strong>{dashboardRows.filter((r) => queueBlocker(r)).length}</strong></div><div><CheckCircle2 /><span>พร้อมจัดคิว</span><strong>{dashboardRows.filter((r) => !queueBlocker(r)).length}</strong></div><div><Users /><span>ต่างจังหวัด</span><strong>{dashboardRows.filter((r) => r.deliveryMethod === 'outstation').length}</strong></div></div><List rows={dashboardRows.slice(0, 20)} onSelect={setSelected} /></>}
        {['customers','orders','outstation'].includes(module) && <><div className="sales-toolbar"><form className="sales-search" onSubmit={search}><Search size={18} /><input aria-label="คำค้นหา" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={module === 'customers' ? 'ชื่อ โทรศัพท์ รหัสลูกค้า หรือที่อยู่' : 'รหัสออเดอร์ Booking ลูกค้า หรือที่อยู่'} /><button type="submit" disabled={busy}>ค้นหา</button></form>{module !== 'outstation' && <button type="button" className="secondary-button" onClick={() => setCreating(true)}><Plus size={16} /> สร้างใหม่</button>}</div><List rows={rows} onSelect={setSelected} /></>}
        {module === 'dispatch' && <List rows={dashboardRows} onSelect={setSelected} actions={(row) => { const blocker = queueBlocker(row); return <div className="sales-action"><button type="button" disabled={busy || Boolean(blocker)} title={blocker} onClick={() => queue(row)}>เข้าคิว</button>{blocker && <small>{blocker}</small>}</div>; }} />}
        {module === 'chiangmai' && <div className="sales-rounds">{Object.entries(groupRounds(dashboardRows)).map(([round, items]) => <section key={round}><h3>{round === 'unassigned' ? 'ยังไม่จัดรอบ' : `รอบ ${round}`} <span>{items.length}</span></h3><List rows={items} onSelect={setSelected} actions={(row) => <select aria-label={`เลือกรอบสำหรับ ${row.id}`} defaultValue={row.chiangmaiRoundCode || ''} disabled={busy} onChange={(e) => assignRound(row, e.target.value)}><option value="">เลือกรอบ</option><option value="tue">อังคาร</option><option value="thu">พฤหัสบดี</option><option value="sat">เสาร์</option></select>} /></section>)}</div>}
      </main></div>
    {(creating || selected) && <div className="sales-drawer-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) { setCreating(false); setSelected(null); } }}><aside className="sales-drawer" role="dialog" aria-modal="true" aria-label={creating ? 'สร้างข้อมูล' : 'รายละเอียด'}><button className="sales-close" type="button" onClick={() => { setCreating(false); setSelected(null); }}>ปิด</button>{selected ? <pre>{JSON.stringify(selected, null, 2)}</pre> : module === 'customers' ? <CustomerForm value={customer} setValue={setCustomer} onSubmit={saveCustomer} busy={busy} /> : <OrderForm value={order} setValue={setOrder} onSubmit={createOrder} busy={busy} />}</aside></div>}
  </section>;
}

function Fields({ value, setValue, fields }) { return <>{fields.map(([name, label, type = 'text']) => <label key={name}>{label}{type === 'textarea' ? <textarea value={value[name]} onChange={(e) => setValue({ ...value, [name]: e.target.value })} /> : <input type={type} value={value[name]} onChange={(e) => setValue({ ...value, [name]: e.target.value })} />}</label>)}</>; }
function CustomerForm({ value, setValue, onSubmit, busy }) { return <form className="sales-form" onSubmit={onSubmit}><h3>ลูกค้า</h3><Fields value={value} setValue={setValue} fields={[["id","รหัสลูกค้า"],["name","ชื่อลูกค้า"],["contact","ผู้ติดต่อ"],["phone","โทรศัพท์"],["zone","พื้นที่"],["address","ที่อยู่","textarea"],["mapUrl","ลิงก์แผนที่"],["note","หมายเหตุ","textarea"]]} /><button type="submit" disabled={busy}>บันทึกลูกค้า</button></form>; }
function OrderForm({ value, setValue, onSubmit, busy }) { return <form className="sales-form" onSubmit={onSubmit}><h3>เปิดออเดอร์</h3><Fields value={value} setValue={setValue} fields={[["id","รหัสออเดอร์"],["customerId","รหัสลูกค้า"],["serviceDate","วันที่บริการ","date"],["window","ช่วงเวลา"],["boxes","จำนวนแพ็ก","number"],["bookingNumber","Booking"],["cod","ยอด COD","number"],["salesNote","หมายเหตุฝ่ายขาย","textarea"]]} /><label>ประเภทจัดส่ง<select value={value.deliveryMethod} onChange={(e) => setValue({ ...value, deliveryMethod: e.target.value })}><option value="company_driver">รถบริษัท</option><option value="grab_pickup">Grab</option><option value="customer_pickup">ลูกค้ารับเอง</option><option value="outstation">ต่างจังหวัด</option></select></label><button type="submit" disabled={busy}>ยืนยันเปิดออเดอร์</button></form>; }
