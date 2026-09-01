import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Truck, UserRound } from 'lucide-react';
import { createCourierQrCommand, createPackerQrCommand } from '../services/scanQrCommand.js';

function ScanQrImage({ label, value }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(value, {
      errorCorrectionLevel: 'M',
      margin: 1,
      // QR cards are deliberately capped to fit every operational code in one
      // viewport; 320px keeps those compact cards sharp on high-density screens.
      width: 320,
    }).then((nextSrc) => {
      if (!cancelled) setSrc(nextSrc);
    }).catch(() => {
      if (!cancelled) setSrc('');
    });
    return () => { cancelled = true; };
  }, [value]);

  return src
    ? <img src={src} alt={`QR ${label}`} />
    : <div className="scan-qr-loading" aria-label={`กำลังสร้าง QR ${label}`}>QR…</div>;
}

function ScanQrPanel({ title, Icon, items, className = '' }) {
  return (
    <aside className={`scan-qr-panel ${className}`} aria-label={title}>
      <header>
        <Icon size={15} aria-hidden="true" />
        <span>{title}</span>
      </header>
      {items.length ? (
        <div className="scan-qr-grid">
          {items.map((item) => (
            <article className="scan-qr-card" key={item.id}>
              <ScanQrImage label={item.label} value={item.value} />
              <strong title={item.label}>{item.label}</strong>
            </article>
          ))}
        </div>
      ) : (
        <p className="scan-qr-empty">ยังไม่มีรายการ QR ที่ใช้งานได้</p>
      )}
    </aside>
  );
}

export function CourierQrPanel({ couriers, role, className }) {
  const items = useMemo(() => couriers.map((courier) => ({
    id: `courier-${role}-${courier}`,
    label: courier,
    value: createCourierQrCommand(role, courier),
  })), [couriers, role]);
  return <ScanQrPanel title="QR ขนส่ง" Icon={Truck} items={items} className={className} />;
}

export function PackerQrPanel({ packers, className }) {
  const items = useMemo(() => packers.map((packer) => ({
    id: `packer-${packer.id}`,
    label: packer.nickname,
    value: createPackerQrCommand(packer.id),
  })), [packers]);
  return <ScanQrPanel title="QR Packer" Icon={UserRound} items={items} className={className} />;
}
