import React, { useEffect, useId } from 'react';
import { X } from 'lucide-react';

interface AccessibleModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidthClass?: string;
  children: React.ReactNode;
  headerAction?: React.ReactNode;
}

export const AccessibleModal: React.FC<AccessibleModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  maxWidthClass = 'max-w-xl',
  children,
  headerAction,
}) => {
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#111111]/55 overflow-hidden"
    >
      <div
        className={`bg-white border-t sm:border border-[#d9dbe0] sm:rounded-md w-full ${maxWidthClass} max-h-[92dvh] sm:max-h-[88vh] flex flex-col overflow-hidden text-[#111111]`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-[#e5e7eb] bg-[#f7f9ff] shrink-0">
          <div>
            <h3 id={titleId} className="text-sm sm:text-base font-semibold text-[#111111]">
              {title}
            </h3>
            {subtitle && <p className="text-xs text-[#5d6270] mt-0.5">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2">
            {headerAction}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-[#5d6270] hover:text-[#111111] rounded hover:bg-[#eef2ff] transition-colors cursor-pointer"
              aria-label="Закрыть"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-5 flex-1 overflow-y-auto overscroll-contain touch-pan-y space-y-4">
          {children}
        </div>
      </div>
    </div>
  );
};
