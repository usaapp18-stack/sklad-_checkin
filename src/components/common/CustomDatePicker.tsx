import React, { useState, useRef, useEffect } from 'react';
import { Calendar as CalendarIcon, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDateDDMMYYYY } from '../../utils/time';

interface CustomDatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  className?: string;
  align?: 'left' | 'right';
  placeholder?: string;
}

export const CustomDatePicker: React.FC<CustomDatePickerProps> = ({
  value,
  onChange,
  min,
  max,
  className = '',
  align = 'left',
  placeholder = 'Выберите дату',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const initialDate = value ? new Date(value) : new Date();
  const validInitial = !isNaN(initialDate.getTime()) ? initialDate : new Date();

  const [viewYear, setViewYear] = useState(validInitial.getFullYear());
  const [viewMonth, setViewMonth] = useState(validInitial.getMonth());

  useEffect(() => {
    if (value) {
      const d = new Date(value);
      if (!isNaN(d.getTime())) {
        setViewYear(d.getFullYear());
        setViewMonth(d.getMonth());
      }
    }
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const monthNames = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
  ];

  const daysOfWeek = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(prev => prev - 1);
    } else {
      setViewMonth(prev => prev - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(prev => prev + 1);
    } else {
      setViewMonth(prev => prev + 1);
    }
  };

  const getCalendarCells = () => {
    const firstDayOfMonth = new Date(viewYear, viewMonth, 1);
    const lastDayOfMonth = new Date(viewYear, viewMonth + 1, 0);

    let startDay = firstDayOfMonth.getDay() - 1;
    if (startDay === -1) startDay = 6;

    const totalDays = lastDayOfMonth.getDate();
    const cells: (number | null)[] = [];

    for (let i = 0; i < startDay; i++) {
      cells.push(null);
    }

    for (let d = 1; d <= totalDays; d++) {
      cells.push(d);
    }

    return cells;
  };

  const handleSelectDay = (dayNum: number) => {
    const formattedMonth = String(viewMonth + 1).padStart(2, '0');
    const formattedDay = String(dayNum).padStart(2, '0');
    const selectedDateStr = `${viewYear}-${formattedMonth}-${formattedDay}`;

    if (min && selectedDateStr < min) return;
    if (max && selectedDateStr > max) return;

    onChange(selectedDateStr);
    setIsOpen(false);
  };

  const handleSetToday = () => {
    const now = new Date();
    const formattedMonth = String(now.getMonth() + 1).padStart(2, '0');
    const formattedDay = String(now.getDate()).padStart(2, '0');
    const todayStr = `${now.getFullYear()}-${formattedMonth}-${formattedDay}`;

    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());

    if (min && todayStr < min) return;
    if (max && todayStr > max) return;

    onChange(todayStr);
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange('');
    setIsOpen(false);
  };

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const cells = getCalendarCells();

  return (
    <div ref={containerRef} className={`relative inline-block text-left w-full ${className}`}>
      {/* Input Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full h-10 min-h-[40px] px-3 py-2 bg-white border border-[#d9dbe0] hover:border-[#111111] focus:border-[#2f63ff] focus:ring-1 focus:ring-[#2f63ff]/20 rounded text-[#111111] font-mono text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer select-none"
      >
        <div className="flex items-center gap-2 truncate">
          <CalendarIcon className="w-4 h-4 text-[#2f63ff] shrink-0" />
          <span className={value ? 'text-[#111111] font-semibold' : 'text-[#5d6270]/75'}>
            {value ? formatDateDDMMYYYY(value) : placeholder}
          </span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-[#5d6270] shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-180 text-[#2f63ff]' : ''}`} />
      </button>

      {/* Branded Calendar Popover */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Календарь"
          className={`absolute z-50 mt-1.5 w-[235px] sm:w-[245px] p-2.5 bg-white border border-[#d9dbe0] rounded-md shadow-sm space-y-2 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {/* Header Month / Year controls */}
          <div className="flex items-center justify-between pb-1.5 border-b border-[#e5e7eb]">
            <button
              type="button"
              onClick={prevMonth}
              className="p-1 rounded bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#111111] border border-[#d9dbe0] transition-colors cursor-pointer"
              title="Предыдущий месяц"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            <div className="text-xs font-semibold text-[#111111] font-mono flex items-center gap-1.5">
              <span>{monthNames[viewMonth]}</span>
              <span className="text-[#5d6270]">{viewYear}</span>
            </div>

            <button
              type="button"
              onClick={nextMonth}
              className="p-1 rounded bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#111111] border border-[#d9dbe0] transition-colors cursor-pointer"
              title="Следующий месяц"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Days of week header */}
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {daysOfWeek.map((day, idx) => (
              <div
                key={day}
                className={`text-xs font-semibold py-0.5 select-none ${
                  idx >= 5 ? 'text-rose-600' : 'text-[#5d6270]'
                }`}
              >
                {day}
              </div>
            ))}
          </div>

          {/* Grid of days */}
          <div className="grid grid-cols-7 gap-0.5 text-[11px]">
            {cells.map((dayNum, idx) => {
              if (dayNum === null) {
                return <div key={`empty-${idx}`} className="aspect-square"></div>;
              }

              const formattedMonth = String(viewMonth + 1).padStart(2, '0');
              const formattedDay = String(dayNum).padStart(2, '0');
              const cellDateStr = `${viewYear}-${formattedMonth}-${formattedDay}`;

              const isSelected = value === cellDateStr;
              const isCellToday = todayStr === cellDateStr;
              const isDisabled = (min && cellDateStr < min) || (max && cellDateStr > max);

              const cellDate = new Date(viewYear, viewMonth, dayNum);
              const dayOfWeek = cellDate.getDay();
              const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

              let dayStyle = 'bg-[#f7f9ff] text-[#111111] hover:bg-[#eef2ff] hover:text-[#2f63ff]';
              if (isWeekend && !isSelected && !isCellToday) {
                dayStyle = 'bg-rose-50/70 text-rose-700 hover:bg-rose-100';
              }
              if (isSelected) {
                dayStyle = 'bg-[#2f63ff] text-white font-bold';
              } else if (isCellToday) {
                dayStyle = 'bg-[#eef2ff] text-[#2f63ff] font-bold ring-1 ring-[#2f63ff]';
              }

              if (isDisabled) {
                dayStyle = 'bg-[#f7f9ff] text-[#5d6270]/45 cursor-not-allowed';
              }

              return (
                <button
                  key={`day-${dayNum}`}
                  type="button"
                  disabled={Boolean(isDisabled)}
                  onClick={() => handleSelectDay(dayNum)}
                  className={`aspect-square rounded flex items-center justify-center font-mono tabular-nums text-[11px] transition-colors select-none cursor-pointer ${dayStyle}`}
                >
                  {dayNum}
                </button>
              );
            })}
          </div>

          {/* Footer Quick Actions */}
          <div className="flex items-center justify-between pt-1.5 border-t border-[#e5e7eb] text-[11px]">
            <button
              type="button"
              onClick={handleClear}
              className="text-[#5d6270] hover:text-rose-700 font-medium transition-colors cursor-pointer"
            >
              Очистить
            </button>
            <button
              type="button"
              onClick={handleSetToday}
              className="text-[#2f63ff] hover:text-[#1f4fe0] font-semibold transition-colors cursor-pointer"
            >
              Сегодня
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
