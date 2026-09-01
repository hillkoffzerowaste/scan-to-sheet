import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Printer, X } from 'lucide-react';
import { createCourierQrCommand, createPackerQrCommand } from '../../services/scanQrCommand.js';

function QrImage({ label, value, onReady }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(value, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 300,
    }).then((nextSrc) => {
      if (!cancelled) {
        setSrc(nextSrc);
        onReady(nextSrc);
      }
    }).catch(() => {
      if (!cancelled) setSrc('');
    });
    return () => { cancelled = true; };
  }, [value]);

  return src
    ? <img src={src} alt={`QR ${label}`} />
    : <div className="qr-print-loading" aria-label={`กำลังสร้าง QR ${label}`}>กำลังสร้าง QR…</div>;
}

function QrCard({ id, label, detail, value, onReady }) {
  return (
    <article className="qr-print-card">
      <h3>{label}</h3>
      <p>{detail}</p>
      <QrImage label={label} value={value} onReady={(src) => onReady(id, src)} />
    </article>
  );
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function printCardMarkup(cards, imageSources) {
  return cards.map((card) => `
    <article class="qr-print-card">
      <h3>${escapeHtml(card.label)}</h3>
      <p>${escapeHtml(card.detail)}</p>
      <img src="${escapeHtml(imageSources[card.id])}" alt="">
    </article>
  `).join('');
}

function printSectionMarkup(mode, adminCards, packerCourierCards, packerCards, imageSources) {
  if (mode === 'admin') {
    return `<section class="qr-print-section"><header><h2>Admin — รับเข้า Drive</h2><p>1. สแกน QR ขนส่ง  2. สแกน Tracking ต่อเนื่อง</p></header><div class="qr-print-grid">${printCardMarkup(adminCards, imageSources)}</div></section>`;
  }
  return `<section class="qr-print-section"><header><h2>Packer — แพ็กสินค้า</h2><p>1. สแกน QR ขนส่ง  2. สแกน QR Packer  3. สแกน Tracking ต่อเนื่อง</p></header><h3 class="qr-print-subheading">QR ขนส่ง</h3><div class="qr-print-grid">${printCardMarkup(packerCourierCards, imageSources)}</div><h3 class="qr-print-subheading">QR Packer</h3><div class="qr-print-grid">${printCardMarkup(packerCards, imageSources)}</div></section>`;
}

export default function QrPrintSheet({ couriers, staff, onClose }) {
  const [imageSources, setImageSources] = useState({});
  const [printMessage, setPrintMessage] = useState('');
  const packers = useMemo(() => staff.filter((person) => (
    person.active !== false
    && ['leader', 'checker', 'packer'].includes(person.position)
    && String(person.nickname ?? '').trim()
  )), [staff]);
  const adminCards = couriers.map((courier) => ({
    id: `admin-${courier}`,
    label: courier,
    detail: 'Admin • ขนส่ง',
    value: createCourierQrCommand('admin', courier),
  }));
  const packerCourierCards = couriers.map((courier) => ({
    id: `packer-courier-${courier}`,
    label: courier,
    detail: 'Packer • ขนส่ง',
    value: createCourierQrCommand('packer', courier),
  }));
  const packerCards = packers.map((person) => ({
    id: `packer-${person.id}`,
    label: person.nickname,
    detail: `Packer • ${person.fullName}`,
    value: createPackerQrCommand(person.id),
  }));
  const cardCount = adminCards.length + packerCourierCards.length + packerCards.length;
  const markReady = (id, src) => setImageSources((current) => (
    current[id] === src ? current : { ...current, [id]: src }
  ));
  const printReady = Object.keys(imageSources).length === cardCount;
  const handlePrint = (mode) => {
    if (!printReady) return;
    const printWindow = window.open('', `scan-to-sheet-qr-print-${mode}`, 'popup,width=1000,height=800');
    if (!printWindow) {
      setPrintMessage('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต popup สำหรับระบบนี้แล้วลองใหม่');
      return;
    }

    const stylesheetLinks = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .map((link) => `<link rel="stylesheet" href="${escapeHtml(link.href)}">`)
      .join('');
    const printWhenReady = () => {
      printWindow.focus();
      printWindow.print();
    };
    const sheetMarkup = printSectionMarkup(
      mode,
      adminCards,
      packerCourierCards,
      packerCards,
      imageSources,
    );
    printWindow.addEventListener('load', printWhenReady, { once: true });
    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
      <html lang="th"><head><meta charset="utf-8"><title>QR จุดสแกน</title>${stylesheetLinks}</head>
      <body><div class="qr-print-overlay"><section class="qr-print-dialog"><div class="qr-print-sheet">
        ${sheetMarkup}
      </div></section></div></body></html>`);
    printWindow.document.close();
    setPrintMessage(`เปิดหน้า preview สำหรับพิมพ์ QR ${mode === 'admin' ? 'Admin' : 'Packer'} แล้ว`);
  };

  return (
    <div className="qr-print-overlay" role="presentation">
      <section className="qr-print-dialog" role="dialog" aria-modal="true" aria-labelledby="qr-print-title">
        <header className="qr-print-dialog-header">
          <div>
            <p className="eyebrow">QR operation cards</p>
            <h2 id="qr-print-title">พิมพ์ QR สำหรับจุดสแกน</h2>
            <p>พิมพ์ A4 แล้ววางที่จุดสแกน: เลือกชุดตาม workflow ที่ใช้งาน</p>
          </div>
          <button className="qr-print-close" type="button" onClick={onClose} aria-label="ปิดหน้าพิมพ์ QR">
            <X size={18} />
          </button>
        </header>
        <div className="qr-print-actions">
          <button className="primary-action" type="button" onClick={() => handlePrint('admin')} disabled={!printReady}>
            <Printer size={17} /> {printReady ? 'พิมพ์ Admin A4' : 'กำลังสร้าง QR...'}
          </button>
          <button className="primary-action" type="button" onClick={() => handlePrint('packer')} disabled={!printReady}>
            <Printer size={17} /> {printReady ? 'พิมพ์ Packer A4' : 'กำลังสร้าง QR...'}
          </button>
          <button className="secondary-button" type="button" onClick={onClose}>ปิด</button>
        </div>
        {printMessage && <p className="qr-print-status" role="status">{printMessage}</p>}

        <div className="qr-print-sheet" aria-label="เอกสาร QR สำหรับพิมพ์">
          <section className="qr-print-section">
            <header>
              <h2>Admin — รับเข้า Drive</h2>
              <p>1. สแกน QR ขนส่ง  2. สแกน Tracking ต่อเนื่อง</p>
            </header>
            <div className="qr-print-grid">
              {adminCards.map((card) => (
                <QrCard
                  key={card.id}
                  {...card}
                  onReady={markReady}
                />
              ))}
            </div>
          </section>

          <section className="qr-print-section qr-print-packer-section">
            <header>
              <h2>Packer — แพ็กสินค้า</h2>
              <p>1. สแกน QR ขนส่ง  2. สแกน QR Packer  3. สแกน Tracking ต่อเนื่อง</p>
            </header>
            <h3 className="qr-print-subheading">QR ขนส่ง</h3>
            <div className="qr-print-grid">
              {packerCourierCards.map((card) => (
                <QrCard
                  key={card.id}
                  {...card}
                  onReady={markReady}
                />
              ))}
            </div>
            <h3 className="qr-print-subheading">QR Packer</h3>
            <div className="qr-print-grid">
              {packerCards.map((card) => (
                <QrCard
                  key={card.id}
                  {...card}
                  onReady={markReady}
                />
              ))}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
