import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { ArrowDownToLine, X, Share } from 'lucide-react';

interface PWAInstallButtonProps {
  isHeader?: boolean;
  className?: string;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ isHeader = false, className = '' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = () => {
    if (isInstallable) {
      install();
    } else {
      setShowIOSGuide(true);
    }
  };

  const renderModal = () => (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) setShowIOSGuide(false); }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#111111]/55 p-4"
    >
      <div className="w-full max-w-sm rounded-md bg-white border border-[#d9dbe0] p-5 relative text-[#111111]">
        <div className="flex items-center justify-between pb-3 border-b border-[#d9dbe0] mb-3">
          <span className="text-xs font-semibold text-[#111111]">Добавить на экран устройства</span>
          <button
            onClick={() => setShowIOSGuide(false)}
            className="p-1 text-[#5d6270] hover:text-[#111111] rounded hover:bg-[#eef2ff] transition-colors cursor-pointer"
            title="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 text-xs text-[#2d313b]">
          <p className="text-xs text-[#5d6270] leading-relaxed">
            {isIOS
              ? 'Для установки веб-приложения на рабочий стол iOS выполните 3 шага в Safari:'
              : 'Для добавления страницы на экран рабочего стола используйте меню браузера:'}
          </p>

          <div className="space-y-2 bg-[#f7f9ff] p-3 rounded-md border border-[#d9dbe0] text-xs">
            <div className="flex items-start gap-2">
              <span className="text-[#2f63ff] font-mono text-xs font-bold">1.</span>
              <p className="text-xs text-[#111111]">
                Нажмите кнопку «Поделиться» (<Share className="w-3 h-3 inline text-[#2f63ff] mx-0.5" /> в Safari).
              </p>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-[#2f63ff] font-mono text-xs font-bold">2.</span>
              <p className="text-xs text-[#111111]">
                Выберите пункт «На экран "Домой"» (Add to Home Screen).
              </p>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-[#2f63ff] font-mono text-xs font-bold">3.</span>
              <p className="text-xs text-[#111111]">
                Подтвердите нажатием «Добавить».
              </p>
            </div>
          </div>
        </div>

        <div className="pt-4 flex justify-end">
          <button
            onClick={() => setShowIOSGuide(false)}
            className="px-4 py-2 rounded bg-[#2f63ff] hover:bg-[#1f4fe0] text-xs font-semibold text-white transition-colors cursor-pointer"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );

  if (isHeader) {
    return (
      <>
        <button
          onClick={handleClick}
          className={`inline-flex sm:hidden p-2 text-neutral-300 hover:text-white bg-white/6 hover:bg-white/12 rounded transition-colors cursor-pointer border border-white/12 ${className}`}
          title="Добавить на экран"
          aria-label="Добавить на экран"
        >
          <ArrowDownToLine className="w-4 h-4 text-[#a9bcff]" />
        </button>

        <button
          onClick={handleClick}
          className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-neutral-200 hover:text-white bg-white/6 hover:bg-white/12 rounded transition-colors cursor-pointer border border-white/12 ${className}`}
          title="Добавить на экран (установить как приложение)"
        >
          <ArrowDownToLine className="w-3.5 h-3.5 text-[#a9bcff]" />
          <span>На экран</span>
        </button>

        {showIOSGuide && renderModal()}
      </>
    );
  }

  return (
    <>
      <button
        onClick={handleClick}
        className={`flex items-center gap-1.5 rounded border border-[#d9dbe0] bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#111111] px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${className}`}
      >
        <ArrowDownToLine className="w-3.5 h-3.5 text-[#2f63ff]" />
        <span>Добавить на экран</span>
      </button>

      {showIOSGuide && renderModal()}
    </>
  );
};
