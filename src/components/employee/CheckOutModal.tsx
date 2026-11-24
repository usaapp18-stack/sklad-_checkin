import React, { useState } from 'react';
import { CheckInRecord, StaffMember } from '../../types';
import { LogOut, Coffee, Check, X, AlertTriangle } from 'lucide-react';
import { formatCurrency, calculateShiftBreakdown } from '../../utils/calculations';
import { useApp } from '../../context/AppContext';

interface CheckOutModalProps {
  isOpen: boolean;
  onClose: () => void;
  todayRecord: CheckInRecord | null;
  currentStaff: StaffMember | null;
  onConfirmCheckOut: (data: {
    checkOutAt: string;
    breakMinutes: number;
    workedHours: number;
    notes?: string;
  }) => Promise<{ success: boolean; error?: string }> | void;
}

export const CheckOutModal: React.FC<CheckOutModalProps> = ({
  isOpen,
  onClose,
  todayRecord,
  currentStaff,
  onConfirmCheckOut,
}) => {
  const { rates } = useApp();
  const [breakMinutes, setBreakMinutes] = useState<number>(60);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen || !todayRecord) return null;

  const now = new Date();
  const checkOutAtIso = now.toISOString();

  const startTime = todayRecord.checkedInAt ? new Date(todayRecord.checkedInAt).getTime() : now.getTime() - 11 * 3600 * 1000;
  const endTime = now.getTime();
  const diffMinutes = Math.max(0, Math.round((endTime - startTime) / (1000 * 60)));
  const netMinutes = Math.max(0, diffMinutes - breakMinutes);
  const workedHours = Number((netMinutes / 60).toFixed(1));

  const estimatedPay = calculateShiftBreakdown({ ...todayRecord, workedHours }, currentStaff, rates).total;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await onConfirmCheckOut({
        checkOutAt: checkOutAtIso,
        breakMinutes,
        workedHours,
        notes: notes.trim() || undefined,
      });

      if (res && !res.success) {
        setErrorMsg(res.error || 'Ошибка завершения смены');
        setIsSubmitting(false);
        return;
      }

      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Ошибка завершения смены');
      setIsSubmitting(false);
    }
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#111111]/55 animate-fade-in overflow-y-auto"
    >
      <div className="bg-white border border-[#d9dbe0] rounded-md w-full max-w-md overflow-hidden my-auto text-[#111111]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#e5e7eb] bg-[#f7f9ff]">
          <div>
            <h3 className="text-sm sm:text-base font-semibold text-[#111111] flex items-center gap-2">
              <LogOut className="w-4 h-4 text-rose-600 shrink-0" />
              <span>Завершение смены (Check-out)</span>
            </h3>
            <p className="text-xs text-[#5d6270] mt-0.5">
              Фиксация времени ухода и отработанных часов
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#5d6270] hover:text-[#111111] rounded hover:bg-[#eef2ff] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4 text-xs">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-rose-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Shift Details Summary */}
          <div className="bg-white rounded-md border border-[#d9dbe0] divide-y divide-[#e5e7eb] overflow-hidden">
            <div className="px-3.5 py-2.5 flex items-center justify-between text-[#2d313b]">
              <span>Склад смены:</span>
              <span className="font-semibold text-[#111111] font-mono">{todayRecord.location}</span>
            </div>
            <div className="px-3.5 py-2.5 flex items-center justify-between text-[#2d313b]">
              <span>Время начала смены:</span>
              <span className="font-mono text-[#2f63ff] font-semibold tabular-nums">
                {todayRecord.checkedInAt ? new Date(todayRecord.checkedInAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'}
              </span>
            </div>
            <div className="px-3.5 py-2.5 flex items-center justify-between text-[#2d313b]">
              <span>Время завершения смены:</span>
              <span className="font-mono text-[#111111] font-semibold tabular-nums">
                {now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>

          {/* Break / Lunch Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[#2d313b] font-semibold flex items-center gap-1.5">
                <Coffee className="w-3.5 h-3.5 text-[#2f63ff]" />
                <span>Время обеда и перерывов:</span>
              </label>
              <span className="font-mono text-[#2f63ff] font-bold tabular-nums">{breakMinutes} мин</span>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {[0, 30, 60, 90].map(mins => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setBreakMinutes(mins)}
                  className={`py-1.5 px-2 rounded text-xs font-semibold border transition-colors cursor-pointer ${
                    breakMinutes === mins
                      ? 'bg-[#111111] border-[#111111] text-white'
                      : 'bg-[#f7f9ff] border-[#d9dbe0] text-[#2d313b] hover:bg-[#eef2ff]'
                  }`}
                >
                  {mins === 0 ? 'Без обеда' : `${mins} мин`}
                </button>
              ))}
            </div>
          </div>

          {/* Total Calculated Working Hours & Payout */}
          <div className="bg-[#eef2ff] rounded-md border border-[#a9bcff] divide-y divide-[#a9bcff]/50 overflow-hidden">
            <div className="px-3.5 py-2.5 flex items-center justify-between text-[#2d313b]">
              <span>Чистых рабочих часов:</span>
              <span className="text-sm font-bold font-mono tabular-nums text-[#111111]">{workedHours} ч</span>
            </div>
            <div className="px-3.5 py-2.5 flex items-center justify-between text-[#2d313b]">
              <span>Предварительное начисление:</span>
              <span className="text-sm font-bold font-mono tabular-nums text-[#2f63ff]">
                {formatCurrency(estimatedPay)}
              </span>
            </div>
          </div>

          {/* Optional notes */}
          <div>
            <label className="block text-[#2d313b] font-medium mb-1">Комментарий к смене (опционально):</label>
            <input
              type="text"
              placeholder="Например: переработка 1ч по указанию бригадира"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-[#d9dbe0] rounded text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 px-3 bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] text-[#111111] rounded font-semibold cursor-pointer transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-2 py-2.5 px-3 bg-rose-600 hover:bg-rose-700 text-white rounded font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              <span>{isSubmitting ? 'Сохранение...' : 'Завершить смену'}</span>
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};
