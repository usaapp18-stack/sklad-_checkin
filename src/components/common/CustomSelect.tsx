import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface CustomSelectOption<T extends string = string> {
  value: T;
  label: string;
  badge?: string;
  badgeColor?: 'ice' | 'amber' | 'sky' | 'slate';
  icon?: React.ComponentType<{ className?: string }>;
  sublabel?: string;
}

interface CustomSelectProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: CustomSelectOption<T>[];
  placeholder?: string;
  labelPrefix?: string;
  icon?: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
  triggerClassName?: string;
  align?: 'left' | 'right';
  direction?: 'down' | 'up' | 'auto';
  menuHeaderTitle?: string;
  size?: 'sm' | 'md';
}

export function CustomSelect<T extends string = string>({
  value,
  onChange,
  options,
  placeholder = 'Выберите...',
  labelPrefix,
  icon: Icon,
  disabled = false,
  className = 'w-full',
  menuClassName = '',
  triggerClassName = '',
  align = 'left',
  direction = 'auto',
  menuHeaderTitle,
  size = 'md',
}: CustomSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(direction === 'up');
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(o => o.value === value);

  useEffect(() => {
    if (!isOpen) return;
    if (direction === 'up') {
      setOpenUpward(true);
    } else if (direction === 'down') {
      setOpenUpward(false);
    } else if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      if (spaceBelow < 230 && spaceAbove > spaceBelow) {
        setOpenUpward(true);
      } else {
        setOpenUpward(false);
      }
    }
  }, [isOpen, direction]);

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

  const handleSelect = (val: T) => {
    onChange(val);
    setIsOpen(false);
  };

  const SelectedIcon = selectedOption?.icon || Icon;
  const isSm = size === 'sm';

  return (
    <div ref={containerRef} className={`relative text-left ${isOpen ? 'z-50' : 'z-auto'} ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`w-full ${
          isSm ? 'h-8 min-h-[32px] px-2.5 py-1 text-[11px]' : 'h-10 min-h-[40px] px-3 py-2 text-xs'
        } rounded flex items-center justify-between gap-1.5 bg-white border border-[#d9dbe0] hover:border-[#111111] focus:border-[#2f63ff] focus:ring-1 focus:ring-[#2f63ff]/20 text-[#111111] transition-colors cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed ${triggerClassName}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-1.5 min-w-0 truncate">
          {SelectedIcon && <SelectedIcon className={`${isSm ? 'w-3 h-3' : 'w-4 h-4'} text-[#2f63ff] shrink-0`} />}
          {labelPrefix && (
            <span className="text-[#5d6270] font-medium whitespace-nowrap">{labelPrefix}</span>
          )}
          <span className="font-semibold text-[#111111] truncate">
            {selectedOption ? selectedOption.label : <span className="text-[#5d6270]/75 font-normal">{placeholder}</span>}
          </span>
          {selectedOption?.badge && (
            <span className={`text-[11px] font-medium shrink-0 ${
              selectedOption.badgeColor === 'amber'
                ? 'text-[#b45309]'
                : selectedOption.badgeColor === 'slate'
                ? 'text-[#5d6270]'
                : 'text-[#2f63ff]'
            }`}>
              · {selectedOption.badge}
            </span>
          )}
        </div>

        <ChevronDown
          className={`${isSm ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-[#5d6270] transition-transform duration-150 shrink-0 ${
            isOpen ? 'rotate-180 text-[#2f63ff]' : ''
          }`}
        />
      </button>

      {/* Styled Dropdown Menu */}
      {isOpen && (
        <div
          role="listbox"
          className={`absolute z-50 ${
            openUpward ? 'bottom-full mb-1 origin-bottom' : 'top-full mt-1 origin-top'
          } min-w-[180px] w-full bg-white border border-[#d9dbe0] rounded-md py-1 shadow-sm overflow-hidden ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${menuClassName}`}
        >
          {menuHeaderTitle && (
            <div className="px-2.5 py-1.5 text-[11px] font-semibold text-[#5d6270] uppercase tracking-wider flex items-center justify-between border-b border-[#e5e7eb] bg-[#f7f9ff]">
              <span>{menuHeaderTitle}</span>
            </div>
          )}

          <div className="max-h-60 overflow-y-auto py-0.5">
            {options.map(option => {
              const isSelected = option.value === value;
              const OptIcon = option.icon;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  className={`w-full ${
                    isSm ? 'px-2.5 py-1.5 text-[11px]' : 'px-3 py-2 text-xs'
                  } text-left flex items-center justify-between transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#eef2ff] text-[#111111] font-semibold'
                      : 'text-[#2d313b] hover:bg-[#f7f9ff] hover:text-[#111111]'
                  }`}
                  role="option"
                  aria-selected={isSelected}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    {OptIcon && (
                      <OptIcon className={`${isSm ? 'w-3 h-3' : 'w-3.5 h-3.5'} shrink-0 ${isSelected ? 'text-[#2f63ff]' : 'text-[#5d6270]'}`} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate">{option.label}</span>
                        {option.badge && (
                          <span className={`text-[11px] font-medium shrink-0 ${
                            option.badgeColor === 'amber'
                              ? 'text-[#b45309]'
                              : option.badgeColor === 'slate'
                              ? 'text-[#5d6270]'
                              : 'text-[#2f63ff]'
                          }`}>
                            · {option.badge}
                          </span>
                        )}
                      </div>
                      {option.sublabel && (
                        <p className="text-[11px] text-[#5d6270] font-normal truncate mt-0.5">
                          {option.sublabel}
                        </p>
                      )}
                    </div>
                  </div>

                  {isSelected && (
                    <Check className={`${isSm ? 'w-3.5 h-3.5' : 'w-4 h-4'} text-[#2f63ff] shrink-0 ml-1.5`} />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
