import React, { useState, useEffect, useId } from 'react';
import { ShiftType, LocationType } from '../../types';
import {
  X,
  Clock,
  Building2,
  MapPin,
  Check,
  AlertCircle,
  Camera,
  ShieldCheck,
  QrCode,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useBottomSheetGesture } from '../../hooks/useBottomSheetGesture';
import { QRScannerModal } from './QRScannerModal';
import { getCurrentBrowserPosition, verifyWarehouseLocation } from '../../utils/geo';

interface CheckInModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCheckIn: (
    shiftType: ShiftType,
    location: LocationType,
    initialCash?: number,
    cashNotes?: string,
    options?: {
      qrVerified?: boolean;
      geoVerified?: boolean;
      zone?: string;
    }
  ) => Promise<{ success: boolean; error?: string }> | void;
  onCancelCheckIn?: () => Promise<{ success: boolean; error?: string }> | void;
  currentShift: ShiftType | null;
  currentLocation?: LocationType | null;
  currentZone?: string | null;
  currentQrVerified?: boolean;
  currentGeoVerified?: boolean;
  availableLocations: LocationType[];
  initialCashVal?: number;
  editCount?: number;
  cancelCount?: number;
  hasCancelledToday?: boolean;
  onContactManager?: () => void;
}

export const CheckInModal: React.FC<CheckInModalProps> = ({
  isOpen,
  onClose,
  onCheckIn,
  onCancelCheckIn,
  currentShift,
  currentLocation,
  currentZone,
  currentQrVerified = false,
  currentGeoVerified = false,
  availableLocations,
  editCount = 0,
  hasCancelledToday = false,
}) => {
  const warehouseGroupId = useId();
  const zoneGroupId = useId();
  const shiftGroupId = useId();
  const { dragOffset, handleProps } = useBottomSheetGesture({ isOpen, onClose });
  const { pickupPoints = [] } = useApp();
  const hasExceededEditLimit = !!currentShift && editCount >= 1;

  const [step, setStep] = useState<1 | 2>(1);
  const [isQRScannerOpen, setIsQRScannerOpen] = useState(false);
  const [isQRVerified, setIsQRVerified] = useState(false);
  const [isGeoChecking, setIsGeoChecking] = useState(false);
  const [geoStatusMsg, setGeoStatusMsg] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<string>(currentZone || 'Приёмка');

  const warehouseShiftOptions: { type: ShiftType; label: string; desc: string; isNight?: boolean }[] = [
    {
      type: 'day12',
      label: 'Дневная смена (12ч)',
      desc: '08:00 – 20:00 (11 часов работы + 1 час обед)',
    },
    {
      type: 'night12',
      label: 'Ночная смена (12ч)',
      desc: '20:00 – 08:00 · +Ночная надбавка',
      isNight: true,
    },
    {
      type: 'standard8',
      label: 'Стандартная (8ч)',
      desc: '09:00 – 18:00 (8 рабочих часов)',
    },
    {
      type: 'part4',
      label: 'Подработка (4ч)',
      desc: 'Сокращённый график смены (4 часа)',
    },
    {
      type: 'part6',
      label: 'Подработка (6ч)',
      desc: 'Смена пикового усиления (6 часов)',
    },
    {
      type: 'daily24',
      label: 'Суточная (24ч)',
      desc: 'Дежурство / охрана склада (24 часа)',
    },
  ];

  const activePickupPointCodes = new Set(
    (pickupPoints || [])
      .filter(p => p.active !== false && !p.isArchived)
      .map(p => p.code)
  );

  const rawLocations = Array.from(new Set([...availableLocations]));

  const effectiveAvailableLocations = rawLocations.filter(
    locCode => activePickupPointCodes.has(locCode) || locCode === currentLocation
  );

  const displayLocations = effectiveAvailableLocations.length > 0
    ? effectiveAvailableLocations
    : Array.from(activePickupPointCodes);

  const [selectedShift, setSelectedShift] = useState<ShiftType | null>(() => {
    if (currentShift) return currentShift;
    return 'day12';
  });

  const [selectedLocation, setSelectedLocation] = useState<LocationType | null>(() => {
    if (currentLocation) return currentLocation;
    if (displayLocations.length === 1) return displayLocations[0];
    return null;
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      setGeoStatusMsg(null);
      setIsConfirmingCancel(false);
      setIsSubmitting(false);
      setIsCancelling(false);
      setStep(currentShift ? 2 : 1);
      if (currentShift) {
        setSelectedShift(currentShift);
      } else {
        setSelectedShift('day12');
      }
      if (currentLocation) {
        setSelectedLocation(currentLocation);
      } else if (displayLocations.length === 1) {
        setSelectedLocation(displayLocations[0]);
      } else {
        setSelectedLocation(null);
      }
      if (currentZone) {
        setSelectedZone(currentZone);
      }
      setIsQRVerified(Boolean(currentQrVerified));
    }
  }, [isOpen, currentShift, currentLocation, currentZone, currentQrVerified, displayLocations.length]);

  const selectedWarehousePoint = pickupPoints.find(
    p => p.code === selectedLocation || p.id === selectedLocation || p.name === selectedLocation
  );
  const warehouseZones =
    Array.isArray(selectedWarehousePoint?.zones) && selectedWarehousePoint.zones.length > 0
      ? selectedWarehousePoint.zones
      : ['Приёмка', 'Комплектация', 'Упаковка', 'Отгрузка'];

  useEffect(() => {
    if (currentZone && selectedLocation === currentLocation && warehouseZones.includes(currentZone)) {
      return;
    }
    if (warehouseZones.length > 0 && !warehouseZones.includes(selectedZone)) {
      setSelectedZone(warehouseZones[0]);
    }
  }, [selectedLocation, isOpen]);

  const canConfirm = !!selectedShift && !!selectedLocation && !isSubmitting && !isCancelling && !isGeoChecking;

  const handleQRSuccess = (scannedCode: string) => {
    const matched = pickupPoints.find(
      p => p.code.toLowerCase() === scannedCode.toLowerCase() || p.id === scannedCode || p.name.toLowerCase().includes(scannedCode.toLowerCase())
    );

    if (matched) {
      setSelectedLocation(matched.code);
      setIsQRVerified(true);
      setGeoStatusMsg(`QR-код склада «${matched.name}» подтверждён`);
    } else {
      setSelectedLocation(scannedCode.toUpperCase());
      setIsQRVerified(true);
      setGeoStatusMsg(`QR-код склада «${scannedCode}» принят`);
    }
    setStep(2);
  };

  const handleConfirm = async () => {
    if (hasExceededEditLimit) {
      setErrorMsg('Работник может изменять свою смену только один раз. Для изменения смены обратитесь к руководителю.');
      return;
    }

    if (!selectedShift || !selectedLocation) return;

    setIsSubmitting(true);
    setErrorMsg(null);

    const matchedWarehouse = pickupPoints.find(p => p.code === selectedLocation || p.id === selectedLocation);
    const keepExistingGeo = Boolean(currentGeoVerified && selectedLocation === currentLocation);
    let geoVerifiedResult = keepExistingGeo;

    if (!keepExistingGeo && matchedWarehouse && matchedWarehouse.latitude && matchedWarehouse.longitude) {
      setIsGeoChecking(true);
      setGeoStatusMsg('Определение геопозиции GPS...');

      try {
        const browserPos = await getCurrentBrowserPosition();
        const verification = verifyWarehouseLocation(
          matchedWarehouse,
          browserPos.latitude,
          browserPos.longitude
        );

        if (!verification.isWithinRange) {
          setIsSubmitting(false);
          setIsGeoChecking(false);
          setErrorMsg(
            `${verification.error || 'Геолокация не совпадает.'}\nЧекин разрешён только на территории склада.`
          );
          return;
        }

        geoVerifiedResult = true;
        setGeoStatusMsg(`GPS подтверждён (точность: ${verification.distanceMeters} м)`);
      } catch (geoErr: any) {
        console.warn('[CheckIn] Geolocation check warning:', geoErr);
        if (!isQRVerified) {
          setIsSubmitting(false);
          setIsGeoChecking(false);
          setErrorMsg(
            `Требуется проверка местоположения: ${geoErr.message || 'включите GPS или отсканируйте QR-код на проходной склада.'}`
          );
          return;
        }
      } finally {
        setIsGeoChecking(false);
      }
    }

    try {
      const res = await onCheckIn(selectedShift, selectedLocation, undefined, undefined, {
        qrVerified: isQRVerified,
        geoVerified: geoVerifiedResult,
        zone: selectedZone,
      });

      setIsSubmitting(false);
      if (res && typeof res === 'object' && res.success === false) {
        setErrorMsg(res.error || 'Ошибка при фиксации смены');
        return;
      }
      onClose();
    } catch (err: any) {
      setIsSubmitting(false);
      setErrorMsg(err.message || 'Ошибка сети');
    }
  };

  const handleCancel = async () => {
    if (onCancelCheckIn) {
      setIsCancelling(true);
      setErrorMsg(null);
      const res = await onCancelCheckIn();
      setIsCancelling(false);
      if (res && typeof res === 'object' && res.success === false) {
        setErrorMsg(res.error || 'Ошибка отмены Check-in');
        setIsConfirmingCancel(false);
        return;
      }
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#111111]/55 animate-fade-in overflow-hidden"
      >
        <div
          style={{
            transform: dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined,
            transition: dragOffset === 0 ? 'transform 0.2s ease-out' : 'none',
          }}
          className="bg-white border-t sm:border border-[#d9dbe0] rounded-t-md sm:rounded-md w-full max-w-lg max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden text-[#111111]"
        >
          {/* Mobile Drag Handle */}
          <div
            {...handleProps}
            className="sm:hidden pt-3 pb-3 px-8 flex justify-center shrink-0 cursor-grab active:cursor-grabbing select-none touch-none"
          >
            <div className="w-12 h-1 bg-[#d9dbe0] rounded pointer-events-none" />
          </div>

          {/* Header & 2-Step Indicator */}
          <div className="p-4 border-b border-[#e5e7eb] bg-[#f7f9ff] shrink-0 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-base text-[#111111]">
                <Building2 className="w-4 h-4 text-[#2f63ff]" />
                <span>{currentShift ? 'Параметры смены' : 'Начало смены (Check-in)'}</span>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 text-[#5d6270] hover:text-[#111111] rounded hover:bg-[#eef2ff] transition-colors cursor-pointer"
                aria-label="Закрыть"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setStep(1)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-semibold border transition-colors cursor-pointer ${
                  step === 1
                    ? 'bg-[#111111] text-white border-[#111111]'
                    : 'bg-white text-[#2d313b] border-[#d9dbe0] hover:bg-[#eef2ff]'
                }`}
              >
                <span className={`font-mono tabular-nums text-[11px] font-bold ${
                  step === 1 ? 'text-[#2f63ff]' : 'text-[#5d6270]'
                }`}>
                  {step > 1 ? '✓' : '01.'}
                </span>
                <span className="truncate">Склад и QR/GPS</span>
              </button>

              <button
                type="button"
                disabled={!selectedLocation}
                onClick={() => selectedLocation && setStep(2)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${
                  !selectedLocation
                    ? 'opacity-45 cursor-not-allowed bg-white text-[#5d6270] border-[#d9dbe0]'
                    : step === 2
                    ? 'bg-[#111111] text-white border-[#111111] cursor-pointer'
                    : 'bg-white text-[#2d313b] border-[#d9dbe0] hover:bg-[#eef2ff] cursor-pointer'
                }`}
              >
                <span className={`font-mono tabular-nums text-[11px] font-bold ${
                  step === 2 ? 'text-[#2f63ff]' : 'text-[#5d6270]'
                }`}>
                  02.
                </span>
                <span className="truncate">Зона и смена</span>
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="p-4 space-y-4 flex-1 overflow-y-auto overscroll-contain">
            
            {/* Error message */}
            {errorMsg && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800 flex items-start gap-2 animate-fade-in">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold whitespace-pre-line">{errorMsg}</p>
                </div>
              </div>
            )}

            {/* Status Feedback (GPS / QR) */}
            {geoStatusMsg && (
              <div className="p-2.5 bg-[#eef2ff] rounded-md border border-[#a9bcff] text-xs font-medium text-[#111111] flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#2f63ff] shrink-0" />
                <span className="truncate">{geoStatusMsg}</span>
              </div>
            )}

            {step === 1 ? (
              <div className="space-y-4 animate-fade-in">
                {/* QR Scanner Card */}
                <div className="p-3.5 bg-[#f7f9ff] rounded-md border border-[#d9dbe0] flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-semibold text-xs text-[#111111]">
                      <QrCode className="w-3.5 h-3.5 text-[#2f63ff]" />
                      <span>Чекин на проходной по QR</span>
                    </div>
                    <p className="text-[11px] text-[#5d6270] truncate mt-0.5">
                      {isQRVerified ? 'QR склада подтверждён' : 'Отсканируйте код на проходной или выберите склад ниже'}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsQRScannerOpen(true)}
                    className={`py-2 px-3 rounded text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer ${
                      isQRVerified
                        ? 'bg-[#eef2ff] text-[#2f63ff] border border-[#a9bcff]'
                        : 'bg-[#2f63ff] hover:bg-[#1f4fe0] text-white'
                    }`}
                  >
                    <Camera className="w-4 h-4" />
                    <span>{isQRVerified ? 'QR готов' : 'Сканировать QR'}</span>
                  </button>
                </div>

                {/* Warehouse Selection */}
                <div className="space-y-2" role="group" aria-labelledby={warehouseGroupId}>
                  <div className="flex items-center justify-between">
                    <div id={warehouseGroupId} className="text-xs font-semibold text-[#2d313b] uppercase tracking-wider">
                      Выберите склад *
                    </div>
                    {selectedLocation && (
                      <span className="text-xs font-semibold font-mono text-[#2f63ff]">
                        {selectedLocation}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {displayLocations.map(loc => {
                      const isSelected = selectedLocation === loc;
                      const matchedPoint = pickupPoints.find(p => p.code === loc || p.id === loc || p.name === loc);
                      const locName = matchedPoint ? matchedPoint.name : `Склад ${loc}`;
                      const locAddress = matchedPoint?.address || 'Территория склада';

                      return (
                        <button
                          key={loc}
                          type="button"
                          onClick={() => setSelectedLocation(loc)}
                          className={`w-full p-3 rounded text-left transition-colors flex items-center justify-between gap-2.5 min-w-0 border cursor-pointer ${
                            isSelected
                              ? 'bg-[#eef2ff] border-[#2f63ff] text-[#111111]'
                              : 'bg-[#f7f9ff] border-[#d9dbe0] hover:bg-[#eef2ff]/60 text-[#2d313b]'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <MapPin className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-[#2f63ff]' : 'text-[#5d6270]'}`} />
                              <span className="font-mono text-xs font-bold text-[#2f63ff] shrink-0">
                                {loc}
                              </span>
                              <span className="font-semibold text-xs text-[#111111] truncate">
                                · {locName}
                              </span>
                            </div>
                            <div className="text-[11px] text-[#5d6270] truncate mt-0.5 pl-5">
                              {locAddress}
                            </div>
                          </div>
                          <div className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${
                            isSelected ? 'bg-[#2f63ff] text-white' : 'bg-white border border-[#d9dbe0]'
                          }`}>
                            {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4 animate-fade-in">
                {/* Selected Warehouse Summary Bar */}
                <div className="p-2.5 px-3 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <MapPin className="w-3.5 h-3.5 text-[#2f63ff] shrink-0" />
                    <span className="font-semibold text-[#111111] truncate">
                      {selectedWarehousePoint?.name || `Склад ${selectedLocation}`}
                    </span>
                    <span className="font-mono text-[#5d6270]">({selectedLocation})</span>
                    {isQRVerified && (
                      <span className="text-[11px] font-semibold text-emerald-700">· QR ✓</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="text-xs font-semibold text-[#2f63ff] hover:underline cursor-pointer shrink-0"
                  >
                    Сменить
                  </button>
                </div>

                {/* Zone Selection */}
                <div className="space-y-2" role="group" aria-labelledby={zoneGroupId}>
                  <div id={zoneGroupId} className="text-xs font-semibold text-[#2d313b] uppercase tracking-wider block">
                    Зона / Участок работы *
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {warehouseZones.map(zone => {
                      const isChosen = selectedZone === zone;
                      return (
                        <button
                          key={zone}
                          type="button"
                          onClick={() => setSelectedZone(zone)}
                          className={`py-2 px-2.5 rounded text-xs font-semibold border text-center transition-colors cursor-pointer truncate ${
                            isChosen
                              ? 'bg-[#111111] border-[#111111] text-white'
                              : 'bg-[#f7f9ff] border-[#d9dbe0] text-[#2d313b] hover:bg-[#eef2ff]'
                          }`}
                        >
                          {zone}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Shift Type Selection */}
                <div className="space-y-2" role="group" aria-labelledby={shiftGroupId}>
                  <div id={shiftGroupId} className="text-xs font-semibold text-[#2d313b] uppercase tracking-wider block">
                    Тип складской смены *
                  </div>

                  <div className="border border-[#d9dbe0] rounded-md divide-y divide-[#e5e7eb] bg-white overflow-hidden">
                    {warehouseShiftOptions.map(opt => {
                      const isChosen = selectedShift === opt.type;
                      return (
                        <button
                          key={opt.type}
                          type="button"
                          onClick={() => setSelectedShift(opt.type)}
                          className={`w-full p-3 text-left transition-colors flex items-center justify-between gap-3 cursor-pointer ${
                            isChosen
                              ? 'bg-[#eef2ff] text-[#111111]'
                              : 'bg-white hover:bg-[#f7f9ff] text-[#2d313b]'
                          }`}
                        >
                          <div className="flex items-start gap-2.5 min-w-0">
                            <Clock className={`w-4 h-4 shrink-0 mt-0.5 ${
                              opt.isNight
                                ? 'text-indigo-700'
                                : isChosen
                                ? 'text-[#2f63ff]'
                                : 'text-[#5d6270]'
                            }`} />
                            <div className="min-w-0">
                              <span className="font-semibold text-xs sm:text-sm text-[#111111] block truncate">
                                {opt.label}
                              </span>
                              <p className="text-[11px] text-[#5d6270] mt-0.5 truncate">{opt.desc}</p>
                            </div>
                          </div>
                          <div className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${
                            isChosen ? 'bg-[#2f63ff] text-white' : 'bg-white border border-[#d9dbe0]'
                          }`}>
                            {isChosen && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {isConfirmingCancel && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-md space-y-2.5 text-xs">
                    <p className="font-semibold text-rose-800">
                      Вы уверены, что хотите отменить текущий Check-in?
                    </p>
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => setIsConfirmingCancel(false)}
                        disabled={isCancelling}
                        className="px-3 py-1.5 bg-white border border-[#d9dbe0] text-[#111111] rounded font-medium cursor-pointer"
                      >
                        Назад
                      </button>
                      <button
                        type="button"
                        onClick={handleCancel}
                        disabled={isCancelling}
                        className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded font-semibold cursor-pointer disabled:opacity-50"
                      >
                        {isCancelling ? 'Отмена...' : 'Подтвердить отмену'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>

          {/* Footer Actions */}
          <div className="p-4 border-t border-[#e5e7eb] bg-[#f7f9ff] flex items-center justify-between gap-2.5 shrink-0">
            {step === 1 ? (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-[#2d313b] hover:text-[#111111] bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] rounded transition-colors cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={!selectedLocation}
                  onClick={() => selectedLocation && setStep(2)}
                  className={`px-5 py-2.5 text-xs font-semibold rounded transition-colors flex items-center gap-1.5 ${
                    selectedLocation
                      ? 'bg-[#2f63ff] hover:bg-[#1f4fe0] text-white cursor-pointer'
                      : 'bg-[#eef2ff] text-[#5d6270] border border-[#d9dbe0] cursor-not-allowed'
                  }`}
                >
                  <span>Далее: зона и смена</span>
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="px-3.5 py-2 text-xs font-semibold text-[#2d313b] hover:text-[#111111] bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] rounded transition-colors cursor-pointer"
                  >
                    Назад
                  </button>
                  {currentShift && onCancelCheckIn && (
                    hasCancelledToday || hasExceededEditLimit ? (
                      <span
                        className="px-3 py-2 text-[11px] font-medium text-[#5d6270] bg-white border border-[#d9dbe0] rounded"
                        title="Отмена смены доступна только 1 раз в день до изменения параметров"
                      >
                        {hasCancelledToday ? 'Отмена уже использована (1/1)' : 'Отмена недоступна (1/1)'}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setIsConfirmingCancel(true)}
                        disabled={isSubmitting || isCancelling}
                        className="px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded transition-colors cursor-pointer"
                      >
                        Отменить смену
                      </button>
                    )
                  )}
                </div>

                <button
                  type="button"
                  disabled={!canConfirm}
                  onClick={handleConfirm}
                  className={`px-5 py-2.5 text-xs font-semibold rounded transition-colors flex items-center gap-1.5 ${
                    canConfirm
                      ? 'bg-[#2f63ff] hover:bg-[#1f4fe0] text-white cursor-pointer'
                      : 'bg-[#eef2ff] text-[#5d6270] border border-[#d9dbe0] cursor-not-allowed'
                  }`}
                >
                  <Check className="w-4 h-4 stroke-[2.5]" />
                  <span>
                    {isSubmitting || isGeoChecking
                      ? 'Проверка GPS...'
                      : currentShift
                      ? 'Сохранить изменения'
                      : 'Начать смену'}
                  </span>
                </button>
              </>
            )}
          </div>

        </div>
      </div>

      {/* QR Scanner Modal */}
      <QRScannerModal
        isOpen={isQRScannerOpen}
        onClose={() => setIsQRScannerOpen(false)}
        onScanSuccess={handleQRSuccess}
      />
    </>
  );
};
