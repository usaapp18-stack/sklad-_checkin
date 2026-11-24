import React, { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, Check } from 'lucide-react';

export interface PeriodOption {
  key: string;
  label: string;
  isCurrent?: boolean;
}

interface CustomPeriodSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: PeriodOption[];
  labelPrefix?: string;
  showIcon?: boolean;
  align?: 'left' | 'right';
  className?: string;
  showQuickNav?: boolean;
}

export const CustomPeriodSelect: React.FC<CustomPeriodSelectProps> = ({
  value,
  onChange,
  options,
  labelPrefix = 'Период:',
  showIcon = true,
  align = 'right',
  className = '',
  showQuickNav = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedIndex = options.findIndex(o => o.key === value);
  const selectedOption = (selectedIndex >= 0 ? options[selectedIndex] : undefined) || {
    key: value,
    label: value,
    isCurrent: false,
  };

  const canGoPrev = selectedIndex >= 0 && selectedIndex < options.length - 1;
  const canGoNext = selectedIndex > 0;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
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

  const handleSelect = (key: string) => {
    onChange(key);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative inline-flex items-center gap-1 text-left ${className}`}>
      {showQuickNav && (
        <button
          type="button"
          onClick={() => canGoPrev && onChange(options[selectedIndex + 1].key)}
          disabled={!canGoPrev}
          title="Предыдущий месяц"
          aria-label="Предыдущий месяц"
          className="h-9 w-8 flex items-center justify-center bg-white hover:bg-[#f7f9ff] border border-[#d9dbe0] hover:border-[#2f63ff] rounded text-[#2d313b] hover:text-[#111111] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      )}

      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="h-9 flex-1 sm:flex-initial flex items-center justify-between gap-2 bg-white hover:bg-[#f7f9ff] border border-[#d9dbe0] hover:border-[#2f63ff] px-3 rounded text-xs text-[#111111] transition-colors cursor-pointer select-none focus:outline-none focus:border-[#2f63ff]"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="flex items-center gap-2 min-w-0">
          {showIcon && <Calendar className="w-4 h-4 text-[#2f63ff] shrink-0" />}
          {labelPrefix && (
            <span className="text-[#5d6270] font-semibold whitespace-nowrap">{labelPrefix}</span>
          )}
          <span className="text-[#111111] font-bold whitespace-nowrap truncate">
            {selectedOption.label}
            {selectedOption.isCurrent ? ' · тек.' : ''}
          </span>
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-[#5d6270] transition-transform duration-150 shrink-0 ${
            isOpen ? 'rotate-180 text-[#2f63ff]' : ''
          }`}
        />
      </button>

      {showQuickNav && (
        <button
          type="button"
          onClick={() => canGoNext && onChange(options[selectedIndex - 1].key)}
          disabled={!canGoNext}
          title="Следующий месяц"
          aria-label="Следующий месяц"
          className="h-9 w-8 flex items-center justify-center bg-white hover:bg-[#f7f9ff] border border-[#d9dbe0] hover:border-[#2f63ff] rounded text-[#2d313b] hover:text-[#111111] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}

      {/* Styled Dropdown Menu */}
      {isOpen && (
        <div
          role="listbox"
          className={`absolute z-50 mt-1.5 w-64 max-w-[calc(100vw-32px)] bg-white border border-[#d9dbe0] rounded-md shadow-sm py-1 overflow-hidden ${
            align === 'left' ? 'left-0' : 'right-0'
          }`}
        >
          <div className="px-3 py-1.5 border-b border-[#e5e7eb] bg-[#f7f9ff] text-[11px] font-semibold text-[#5d6270] uppercase tracking-wider flex items-center justify-between">
            <span>Выберите период</span>
            <span className="text-[#111111] font-mono text-[11px] tabular-nums">({options.length})</span>
          </div>

          <div className="max-h-64 overflow-y-auto py-0.5 divide-y divide-[#e5e7eb]">
            {options.map(option => {
              const isSelected = option.key === value;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => handleSelect(option.key)}
                  className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#eef2ff] text-[#111111] font-semibold'
                      : 'text-[#2d313b] hover:bg-[#f7f9ff] hover:text-[#111111]'
                  }`}
                  role="option"
                  aria-selected={isSelected}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{option.label}</span>
                    {option.isCurrent && (
                      <span className="text-[11px] text-[#b45309] font-medium shrink-0">
                        · Текущий
                      </span>
                    )}
                  </div>

                  {isSelected && (
                    <Check className="w-4 h-4 text-[#2f63ff] shrink-0 ml-2" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
