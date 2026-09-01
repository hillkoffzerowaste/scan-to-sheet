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
        onReady();
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
      <QrImage label={label} value={value} onReady={() => onReady(id)} />
    </article>
  );
}

export default function QrPrintSheet({ couriers, staff, onClose }) {
  const [readyIds, setReadyIds] = useState(() => new Set());
  const packers = useMemo(() => staff.filter((person) => (
    person.active !== false
    && ['leader', 'checker', 'packer'].includes(person.position)
    && String(person.nickname ?? '').trim()
  )), [staff]);
  const cardCount = couriers.length * 2 + packers.length;
  const markReady = (id) => setReadyIds((current) => (
    current.has(id) ? current : new Set([...current, id])
  ));
  const printReady = readyIds.size === cardCount;
  const handlePrint = () => {
    if (!printReady) return;
    window.print();
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
          <button className="primary-action" type="button" onClick={handlePrint} disabled={!printReady}>
            <Printer size={17} /> {printReady ? 'พิมพ์ A4' : 'กำลังสร้าง QR...'}
          </button>
          <button className="secondary-button" type="button" onClick={onClose}>ปิด</button>
        </div>

        <div className="qr-print-sheet" aria-label="เอกสาร QR สำหรับพิมพ์">
          <section className="qr-print-section">
            <header>
              <h2>Admin — รับเข้า Drive</h2>
              <p>1. สแกน QR ขนส่ง  2. สแกน Tracking ต่อเนื่อง</p>
            </header>
            <div className="qr-print-grid">
              {couriers.map((courier) => (
                <QrCard
                  key={`admin-${courier}`}
                  id={`admin-${courier}`}
                  label={courier}
                  detail="Admin • ขนส่ง"
                  value={createCourierQrCommand('admin', courier)}
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
              {couriers.map((courier) => (
                <QrCard
                  key={`packer-courier-${courier}`}
                  id={`packer-courier-${courier}`}
                  label={courier}
                  detail="Packer • ขนส่ง"
                  value={createCourierQrCommand('packer', courier)}
                  onReady={markReady}
                />
              ))}
            </div>
            <h3 className="qr-print-subheading">QR Packer</h3>
            <div className="qr-print-grid">
              {packers.map((person) => (
                <QrCard
                  key={`packer-${person.id}`}
                  id={`packer-${person.id}`}
                  label={person.nickname}
                  detail={`Packer • ${person.fullName}`}
                  value={createPackerQrCommand(person.id)}
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
