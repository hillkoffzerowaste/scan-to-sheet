import React, { useEffect, useMemo, useState } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { Download, X } from 'lucide-react';
import { buildQrPackerMembers } from './staffDirectory.js';
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

const PDF_CARDS_PER_PAGE = 9;

function splitCardsIntoPdfPages(cards) {
  return Array.from(
    { length: Math.ceil(cards.length / PDF_CARDS_PER_PAGE) },
    (_, index) => cards.slice(index * PDF_CARDS_PER_PAGE, (index + 1) * PDF_CARDS_PER_PAGE),
  );
}

function pdfPageMarkup({ title, instructions, subheading, cards, pageNumber, pageCount }, imageSources) {
  const pageLabel = pageCount > 1 ? ` • หน้า ${pageNumber} / ${pageCount}` : '';
  return `<section class="qr-print-section qr-pdf-export-page"><header><h2>${escapeHtml(title)}</h2><p>${escapeHtml(instructions)}${pageLabel}</p></header>${subheading ? `<h3 class="qr-print-subheading">${escapeHtml(subheading)}</h3>` : ''}<div class="qr-print-grid">${printCardMarkup(cards, imageSources)}</div></section>`;
}

function pdfSectionMarkup(mode, adminCards, packerCourierCards, packerCards, imageSources) {
  if (mode === 'admin') {
    const pages = splitCardsIntoPdfPages(adminCards);
    return pages.map((cards, index) => pdfPageMarkup({
      title: 'Admin — รับเข้า Drive',
      instructions: '1. สแกน QR ขนส่ง  2. สแกน Tracking ต่อเนื่อง',
      cards,
      pageNumber: index + 1,
      pageCount: pages.length,
    }, imageSources)).join('');
  }

  const sections = [
    { subheading: 'QR ขนส่ง', cards: packerCourierCards },
    { subheading: 'QR Packer', cards: packerCards },
  ].filter((section) => section.cards.length > 0);
  const pages = sections.flatMap((section) => splitCardsIntoPdfPages(section.cards).map((cards) => ({
    ...section,
    cards,
  })));
  return pages.map((page, index) => pdfPageMarkup({
    title: 'Packer — แพ็กสินค้า',
    instructions: '1. สแกน QR ขนส่ง  2. สแกน QR Packer  3. สแกน Tracking ต่อเนื่อง',
    subheading: page.subheading,
    cards: page.cards,
    pageNumber: index + 1,
    pageCount: pages.length,
  }, imageSources)).join('');
}

export default function QrPrintSheet({ couriers, staff, onClose }) {
  const [imageSources, setImageSources] = useState({});
  const [printMessage, setPrintMessage] = useState('');
  const [exportingPdf, setExportingPdf] = useState(false);
  const packers = useMemo(() => buildQrPackerMembers(staff), [staff]);
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
  const handlePdfExport = async (mode) => {
    if (!printReady) return;
    setExportingPdf(true);
    setPrintMessage('กำลังสร้างไฟล์ PDF...');
    const sheetMarkup = pdfSectionMarkup(
      mode,
      adminCards,
      packerCourierCards,
      packerCards,
      imageSources,
    );
    const exportSheet = document.createElement('section');
    exportSheet.className = 'qr-pdf-export';
    exportSheet.setAttribute('aria-hidden', 'true');
    exportSheet.innerHTML = sheetMarkup;
    document.body.append(exportSheet);

    try {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      const margin = 8;
      const pageWidth = 210 - margin * 2;
      const pages = [...exportSheet.querySelectorAll('.qr-pdf-export-page')];
      for (const [index, page] of pages.entries()) {
        const canvas = await html2canvas(page, {
          backgroundColor: null,
          scale: 2,
          useCORS: true,
        });
        const pageHeight = (canvas.height * pageWidth) / canvas.width;
        if (pageHeight > 297 - margin * 2) {
          throw new Error('ไม่สามารถจัด QR ลงหน้า A4 ได้ กรุณาลองลดขนาดการ์ด');
        }
        if (index > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, margin, pageWidth, pageHeight);
      }
      pdf.save(`scan-to-sheet-qr-${mode}.pdf`);
      setPrintMessage(`ดาวน์โหลด PDF QR ${mode === 'admin' ? 'Admin' : 'Packer'} แล้ว`);
    } catch (error) {
      setPrintMessage(error.message === 'ไม่สามารถจัด QR ลงหน้า A4 ได้ กรุณาลองลดขนาดการ์ด'
        ? error.message
        : 'สร้าง PDF ไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      exportSheet.remove();
      setExportingPdf(false);
    }
  };

  return (
    <div className="qr-print-overlay" role="presentation">
      <section className="qr-print-dialog" role="dialog" aria-modal="true" aria-labelledby="qr-print-title">
        <header className="qr-print-dialog-header">
          <div>
            <p className="eyebrow">QR operation cards</p>
            <h2 id="qr-print-title">พิมพ์ QR สำหรับจุดสแกน</h2>
            <p>ส่งออก PDF A4 แนวตั้ง แล้ววางที่จุดสแกนตาม workflow</p>
          </div>
          <button className="qr-print-close" type="button" onClick={onClose} aria-label="ปิดหน้าพิมพ์ QR">
            <X size={18} />
          </button>
        </header>
        <div className="qr-print-actions">
          <button className="primary-action" type="button" onClick={() => { void handlePdfExport('admin'); }} disabled={!printReady || exportingPdf}>
            <Download size={17} /> {exportingPdf ? 'กำลังสร้าง PDF...' : printReady ? 'PDF Admin A4' : 'กำลังสร้าง QR...'}
          </button>
          <button className="primary-action" type="button" onClick={() => { void handlePdfExport('packer'); }} disabled={!printReady || exportingPdf}>
            <Download size={17} /> {exportingPdf ? 'กำลังสร้าง PDF...' : printReady ? 'PDF Packer A4' : 'กำลังสร้าง QR...'}
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
