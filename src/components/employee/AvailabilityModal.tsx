import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { CustomSelect } from '../common/CustomSelect';
import { CustomDatePicker } from '../common/CustomDatePicker';
import { formatDateDDMMYYYY } from '../../utils/time';
import {
  Calendar,
  X,
  AlertTriangle,
  GraduationCap,
  Palmtree,
  Stethoscope,
  CalendarCheck,
  Trash2,
  CheckCircle2
} from 'lucide-react';
import { useBottomSheetGesture } from '../../hooks/useBottomSheetGesture';

interface AvailabilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultDate?: string;
}

export const AvailabilityModal: React.FC<AvailabilityModalProps> = ({
  isOpen,
  onClose,
  defaultDate,
}) => {
  const { dragOffset, handleProps } = useBottomSheetGesture({ isOpen, onClose });
  const { availability, currentStaffId, setAvailability, deleteAvailability } = useApp();

  const [date, setDate] = useState(defaultDate || new Date().toISOString().slice(0, 10));
  const [type, setType] = useState<'unavailable' | 'vacation' | 'study' | 'sick' | 'preferred'>('study');
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && defaultDate) {
      setDate(defaultDate);
    }
  }, [isOpen, defaultDate]);

  if (!isOpen) return null;

  const myAvailabilities = availability
    .filter(a => a.employeeId === currentStaffId)
    .sort((a, b) => a.date.localeCompare(b.date));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setActionSuccess(null);
    const res = await setAvailability(date, type, comment);
    setLoading(false);
    if (!res || res.success) {
      setActionSuccess('Пожелание успешно сохранено и отправлено руководителю!');
      setComment('');
      setTimeout(() => setActionSuccess(null), 3500);
    }
  };

  const handleDelete = async (id: string) => {
    setLoading(true);
    await deleteAvailability(id);
    setLoading(false);
  };

  const typeOptions = [
    { value: 'study' as const, label: 'Учёба / Сессия', icon: GraduationCap, iconColor: 'text-[#b45309]' },
    { value: 'vacation' as const, label: 'Отпуск / Отгул', icon: Palmtree, iconColor: 'text-[#2f63ff]' },
    { value: 'sick' as const, label: 'Больничный', icon: Stethoscope, iconColor: 'text-rose-700' },
    { value: 'unavailable' as const, label: 'Личные дела (не могу)', icon: AlertTriangle, iconColor: 'text-orange-700' },
    { value: 'preferred' as const, label: 'Желаемый день (хочу смену)', icon: CalendarCheck, iconColor: 'text-emerald-700' },
  ];

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onTouchMove={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}
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
          title="Потяните вниз, чтобы закрыть"
        >
          <div className="w-12 h-1 bg-[#d9dbe0] rounded pointer-events-none" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#e5e7eb] bg-[#f7f9ff] shrink-0">
          <div className="text-[#111111] font-semibold text-base">
            <span>Пожелания по графику и отпускам</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#5d6270] hover:text-[#111111] rounded hover:bg-[#eef2ff] transition-colors cursor-pointer"
            aria-label="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 flex-1 overflow-y-auto overscroll-contain touch-pan-y">
          
          {actionSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md text-xs font-semibold text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{actionSuccess}</span>
            </div>
          )}

          <form onSubmit={handleSave} className="p-4 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md space-y-3.5 text-xs">
            <div className="font-semibold uppercase text-[11px] tracking-wider text-[#5d6270]">
              Добавить пожелание для руководителя:
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[#2d313b] font-semibold mb-1">Дата:</label>
                <CustomDatePicker
                  value={date}
                  onChange={v => setDate(v)}
                />
              </div>

              <div>
                <label className="block text-[#2d313b] font-semibold mb-1">Категория:</label>
                <CustomSelect<'unavailable' | 'vacation' | 'study' | 'sick' | 'preferred'>
                  value={type}
                  onChange={v => setType(v)}
                  align="right"
                  menuHeaderTitle="Категория пожелания"
                  options={typeOptions.map(opt => ({
                    value: opt.value,
                    label: opt.label,
                    icon: opt.icon,
                  }))}
                />
              </div>
            </div>

            <div>
              <label className="block text-[#2d313b] font-semibold mb-1">Комментарий (опционально):</label>
              <input
                type="text"
                placeholder="Например: экзамен до 15:00"
                value={comment}
                onChange={e => setComment(e.target.value)}
                className="w-full h-10 min-h-[40px] px-3 py-2 bg-white border border-[#d9dbe0] focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25 rounded text-[#111111] placeholder:text-[#5d6270]/70 text-xs focus:outline-none transition-colors"
              />
            </div>

            <div className="pt-1 flex justify-end">
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white font-semibold rounded transition-colors disabled:opacity-50 cursor-pointer"
              >
                {loading ? 'Сохранение...' : 'Отправить пожелание'}
              </button>
            </div>
          </form>

          {/* List of current availability requests */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-[#5d6270] uppercase tracking-wider">
              Мои отправленные пожелания ({myAvailabilities.length})
            </div>

            {myAvailabilities.length === 0 ? (
              <div className="p-4 text-center text-xs text-[#5d6270] bg-[#f7f9ff] border border-[#d9dbe0] rounded-md">
                У вас пока нет сохранённых пожеланий. Руководитель видит вас доступным во все дни.
              </div>
            ) : (
              <div className="border border-[#d9dbe0] rounded-md divide-y divide-[#e5e7eb] bg-white overflow-hidden">
                {myAvailabilities.map(a => {
                  const opt = typeOptions.find(o => o.value === a.type);
                  const Icon = opt?.icon || Calendar;

                  return (
                    <div
                      key={a.id}
                      className="p-3 flex items-center justify-between text-xs gap-3 hover:bg-[#f7f9ff] transition-colors"
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${opt?.iconColor || 'text-[#2f63ff]'}`} />
                        <div className="min-w-0">
                          <div className="font-semibold text-[#111111] font-mono tabular-nums flex items-center gap-1.5 flex-wrap">
                            <span>{formatDateDDMMYYYY(a.date)}</span>
                            <span className="text-[#d9dbe0]">·</span>
                            <span className="text-xs text-[#2d313b] font-sans font-medium">
                              {opt?.label || a.type}
                            </span>
                            <span className="text-[#d9dbe0]">·</span>
                            {a.status === 'approved' ? (
                              <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-sans font-semibold">
                                <span className="w-1.5 h-1.5 rounded-xs bg-emerald-600" />
                                Одобрено
                              </span>
                            ) : a.status === 'rejected' ? (
                              <span className="inline-flex items-center gap-1 text-xs text-rose-700 font-sans font-semibold">
                                <span className="w-1.5 h-1.5 rounded-xs bg-rose-600" />
                                Отклонено
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-[#b45309] font-sans font-semibold">
                                <span className="w-1.5 h-1.5 rounded-xs bg-[#b45309]" />
                                На рассмотрении
                              </span>
                            )}
                          </div>
                          {a.comment && (
                            <div className="text-[11px] text-[#5d6270] italic mt-0.5">
                              &ldquo;{a.comment}&rdquo;
                            </div>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() => handleDelete(a.id)}
                        disabled={loading}
                        className="p-1.5 text-[#5d6270] hover:text-rose-700 hover:bg-rose-50 rounded transition-colors cursor-pointer shrink-0"
                        title="Удалить пожелание"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#e5e7eb] bg-[#f7f9ff] flex items-center justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] text-[#111111] rounded transition-colors cursor-pointer"
          >
            Закрыть
          </button>
        </div>

      </div>
    </div>
  );
};
