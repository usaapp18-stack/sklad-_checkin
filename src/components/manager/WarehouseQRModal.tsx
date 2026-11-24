import React, { useEffect, useState, useRef } from 'react';
import QRCode from 'qrcode';
import { PickupPoint } from '../../types';
import { QrCode, Printer, Download, X, Copy, Check, ShieldCheck } from 'lucide-react';
import { BrandLogo } from '../common/BrandLogo';

interface WarehouseQRModalProps {
  isOpen: boolean;
  onClose: () => void;
  warehouse: PickupPoint | null;
}

export const WarehouseQRModal: React.FC<WarehouseQRModalProps> = ({
  isOpen,
  onClose,
  warehouse,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [isCopied, setIsCopied] = useState(false);
  const printAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!warehouse) return;

    const secret = warehouse.qrSecret || `sec_${warehouse.id.slice(0, 8)}`;
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://skladin.app';
    const payloadUrl = `${origin}/?checkin_warehouse=${encodeURIComponent(warehouse.code)}&token=${encodeURIComponent(secret)}`;

    QRCode.toDataURL(payloadUrl, {
      width: 480,
      margin: 2,
      color: {
        dark: '#111111',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'H',
    })
      .then(url => setQrDataUrl(url))
      .catch(err => console.error('Error generating QR Code', err));
  }, [warehouse]);

  if (!isOpen || !warehouse) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `QR_${warehouse.code}_${warehouse.name.replace(/\s+/g, '_')}.png`;
    a.click();
  };

  const handleCopyCode = () => {
    const secret = warehouse.qrSecret || `sec_${warehouse.id.slice(0, 8)}`;
    navigator.clipboard.writeText(`${warehouse.code}:${secret}`);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-[#111111]/55 animate-fade-in overflow-y-auto"
    >
      <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-lg overflow-hidden my-auto text-[#111111]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#e5e7eb] bg-[#f7f9ff]">
          <div className="flex items-center gap-2.5">
            <QrCode className="w-4 h-4 text-[#2f63ff] shrink-0" />
            <div>
              <h3 className="text-sm sm:text-base font-semibold text-[#111111]">
                QR-код склада для проходной
              </h3>
              <p className="text-xs text-[#5d6270] truncate max-w-xs sm:max-w-md">
                {warehouse.name} ({warehouse.code})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#5d6270] hover:text-[#111111] rounded hover:bg-[#eef2ff] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 space-y-5">

          {/* Printable Card Preview */}
          <div
            ref={printAreaRef}
            className="bg-white text-[#111111] p-6 rounded-md border border-[#d9dbe0] flex flex-col items-center text-center space-y-3"
          >
            {/* Brand Header */}
            <div className="flex items-center gap-2">
              <BrandLogo className="w-6 h-6 shrink-0" showFrame={false} />
              <span className="font-bold text-sm tracking-tight text-[#111111]">
                SKLADIN <span className="text-[#5d6270] font-normal">| Проходная</span>
              </span>
            </div>

            {/* Warehouse title */}
            <div className="space-y-0.5">
              <h4 className="text-base sm:text-lg font-bold text-[#111111]">
                {warehouse.name}
              </h4>
              <p className="text-xs text-[#2d313b] font-mono">
                Код склада: <strong className="text-[#111111] font-bold">{warehouse.code}</strong>
              </p>
              {warehouse.address && (
                <p className="text-[11px] text-[#5d6270] max-w-xs mx-auto">
                  {warehouse.address}
                </p>
              )}
            </div>

            {/* QR Image */}
            <div className="p-2 bg-white rounded-md border border-[#d9dbe0]">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={`QR-код склада ${warehouse.name}`}
                  className="w-48 h-48 sm:w-56 sm:h-56 object-contain"
                />
              ) : (
                <div className="w-48 h-48 flex items-center justify-center text-[#5d6270] text-xs">
                  Генерация QR-кода...
                </div>
              )}
            </div>

            {/* Step-by-step instructions */}
            <div className="bg-[#f7f9ff] border border-[#d9dbe0] p-3 rounded-md text-left w-full text-[11px] text-[#2d313b] space-y-1">
              <div className="font-semibold text-[#111111] text-center mb-1">
                Инструкция для начала смены:
              </div>
              <div>1. Откройте приложение <strong className="text-[#111111]">SKLADIN</strong> на смартфоне.</div>
              <div>2. Нажмите кнопку <strong className="text-[#111111]">«Отсканировать QR склада»</strong>.</div>
              <div>3. Наведите камеру на этот QR-код и подтвердите смену.</div>
            </div>

            {/* Security Notice */}
            <div className="flex items-center gap-1.5 text-[10px] text-[#5d6270] font-medium">
              <ShieldCheck className="w-3.5 h-3.5 text-[#2f63ff] shrink-0" />
              <span>Защита: чекин работает только на территории склада с проверкой GPS</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              onClick={handlePrint}
              className="py-2.5 px-3 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-bold rounded text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>Распечатать лист</span>
            </button>

            <button
              onClick={handleDownload}
              className="py-2.5 px-3 bg-[#111111] hover:bg-[#2d313b] text-white font-semibold rounded text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Скачать PNG</span>
            </button>
          </div>

          {/* Secret Token & Info */}
          <div className="p-3 bg-[#f7f9ff] rounded-md border border-[#d9dbe0] text-xs space-y-1 text-[#2d313b]">
            <div className="flex items-center justify-between">
              <span className="text-[#111111] font-semibold">Защитный токен склада:</span>
              <button
                type="button"
                onClick={handleCopyCode}
                className={`text-[11px] flex items-center gap-1 font-mono font-semibold cursor-pointer transition-colors ${
                  isCopied ? 'text-emerald-700' : 'text-[#2f63ff] hover:text-[#1f4fe0]'
                }`}
              >
                {isCopied ? <Check className="w-3 h-3 text-emerald-700" /> : <Copy className="w-3 h-3" />}
                <span>{isCopied ? 'Скопирован' : 'Скопировать'}</span>
              </button>
            </div>
            <p className="text-[11px] text-[#5d6270]">
              Если у рабочего временно не работает камера смартфона, он может подтвердить присутствие ручным вводом кода на проходной.
            </p>
          </div>

        </div>

      </div>
    </div>
  );
};
