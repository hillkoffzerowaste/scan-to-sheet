import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { RotateCcw, SlidersHorizontal, Truck, UserRound } from 'lucide-react';
import { createCourierQrCommand, createPackerQrCommand } from '../services/scanQrCommand.js';
import { QR_LAYOUT_OPTIONS } from '../services/qrLayoutPreferences.js';

function ScanQrImage({ label, value }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(value, {
      errorCorrectionLevel: 'M',
      margin: 1,
      // Fixed column counts let cards fill their allotted workspace, so retain
      // enough source detail for the larger QR codes on operational displays.
      width: 512,
    }).then((nextSrc) => {
      if (!cancelled) setSrc(nextSrc);
    }).catch(() => {
      if (!cancelled) setSrc('');
    });
    return () => { cancelled = true; };
  }, [value]);

  return src
    ? <img src={src} alt={`QR ${label}`} />
    : <span className="scan-qr-loading" aria-label={`กำลังสร้าง QR ${label}`}>QR…</span>;
}

function ScanQrPanel({
  title,
  Icon,
  items,
  className = '',
  layout = 'standard',
  onLayoutChange,
  onLayoutReset,
  layoutLabel,
  onSelect,
  selectedLabel,
  disabled = false,
}) {
  return (
    <aside className={`scan-qr-panel qr-layout-${layout} ${className}`} aria-label={title} onClick={(event) => event.stopPropagation()}>
      <header>
        <span className="scan-qr-title"><Icon size={15} aria-hidden="true" /><span>{title}</span></span>
        {onLayoutChange && (
          <span className="scan-qr-layout-controls">
            <SlidersHorizontal size={14} aria-hidden="true" />
            <select aria-label={`ขนาด QR ${layoutLabel}`} value={layout} onChange={(event) => onLayoutChange(event.target.value)}>
              {QR_LAYOUT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <button
              type="button"
              aria-label={`คืนค่า QR ${layoutLabel}`}
              title="คืนค่าเริ่มต้น"
              disabled={layout === 'standard'}
              onClick={onLayoutReset}
            >
              <RotateCcw size={14} aria-hidden="true" />
            </button>
          </span>
        )}
      </header>
      <p className="scan-qr-hint">คลิกหรือสแกน QR เพื่อเลือก</p>
      {items.length ? (
        <div className="scan-qr-grid">
          {items.map((item) => (
            <button
              type="button"
              className="scan-qr-card"
              key={item.id}
              aria-label={`เลือก ${item.label}`}
              aria-pressed={selectedLabel === item.label}
              disabled={disabled || !onSelect}
              onClick={() => onSelect(item.value)}
            >
              <ScanQrImage label={item.label} value={item.value} />
              <strong title={item.label}>{item.label}</strong>
            </button>
          ))}
        </div>
      ) : (
        <p className="scan-qr-empty">ยังไม่มีรายการ QR ที่ใช้งานได้</p>
      )}
    </aside>
  );
}

export function CourierQrPanel({ couriers, role, className, layout, onLayoutChange, onLayoutReset, layoutLabel, onSelect, selectedCourier, disabled }) {
  const items = useMemo(() => couriers.map((courier) => ({
    id: `courier-${role}-${courier}`,
    label: courier,
    value: createCourierQrCommand(role, courier),
  })), [couriers, role]);
  return <ScanQrPanel title="QR ขนส่ง" Icon={Truck} items={items} className={className} layout={layout} onLayoutChange={onLayoutChange} onLayoutReset={onLayoutReset} layoutLabel={layoutLabel} onSelect={onSelect} selectedLabel={selectedCourier} disabled={disabled} />;
}

export function PackerQrPanel({ packers, className, layout, onSelect, selectedPacker, disabled }) {
  const items = useMemo(() => packers.map((packer) => ({
    id: `packer-${packer.id}`,
    label: packer.nickname,
    value: createPackerQrCommand(packer.id),
  })), [packers]);
  return <ScanQrPanel title="QR Packer" Icon={UserRound} items={items} className={className} layout={layout} onSelect={onSelect} selectedLabel={selectedPacker} disabled={disabled} />;
}
