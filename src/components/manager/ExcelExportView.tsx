import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { getCurrentAndPreviousMonth, formatMonthName, getAllAvailableMonths } from '../../utils/time';
import { exportMonthlyReportToExcel } from '../../utils/excelExport';
import { FileSpreadsheet, Download, Check, AlertCircle } from 'lucide-react';

export const ExcelExportView: React.FC = () => {
  const { records, staffList, rates } = useApp();
  const { current } = getCurrentAndPreviousMonth();
  const allMonths = getAllAvailableMonths(records, 12);

  const availableMonths = allMonths.map(m => ({
    id: m.key,
    label: `${m.label}${m.isCurrent ? ' (Текущий)' : ''}`,
  }));

  const [selectedMonths, setSelectedMonths] = useState<string[]>([current]);
  const [isExporting, setIsExporting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const toggleMonth = (mId: string) => {
    if (selectedMonths.includes(mId)) {
      if (selectedMonths.length > 1) {
        setSelectedMonths(selectedMonths.filter(id => id !== mId));
      }
    } else {
      setSelectedMonths([...selectedMonths, mId]);
    }
  };

  const handleExport = async () => {
    if (selectedMonths.length === 0) return;
    setIsExporting(true);
    setErrorMessage(null);

    try {
      exportMonthlyReportToExcel(records, staffList, selectedMonths, rates);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      console.error('Export error:', err);
      setErrorMessage(err?.message || 'Ошибка при формировании Excel файла.');
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 text-[#111111]">
      
      <div className="p-5 sm:p-6 bg-white border border-[#d9dbe0] rounded-md space-y-5">
        <div className="flex items-start gap-2.5">
          <FileSpreadsheet className="w-4 h-4 text-[#2f63ff] mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-[#111111]">Экспорт табеля и ведомостей в Excel (.xlsx)</h3>
            <p className="text-xs text-[#5d6270]">Выгрузка табеля отработанных часов, расчетного листа ФОТ и журнала проходной</p>
          </div>
        </div>

        {/* Period Selection */}
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <label className="block text-xs font-semibold text-[#5d6270] uppercase tracking-wider">
              Выберите отчётные месяцы
            </label>
            <span className="text-xs font-mono font-semibold text-[#2f63ff] tabular-nums">
              Выбрано: {selectedMonths.length}
            </span>
          </div>

          {/* Quick Preset Buttons */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setSelectedMonths([current])}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer border ${
                selectedMonths.length === 1 && selectedMonths.includes(current)
                  ? 'bg-[#111111] text-white border-[#111111]'
                  : 'bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#2d313b] border-[#d9dbe0]'
              }`}
            >
              Текущий
            </button>
            {allMonths.length > 1 && (
              <button
                type="button"
                onClick={() => setSelectedMonths([allMonths[1].key])}
                className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer border ${
                  selectedMonths.length === 1 && selectedMonths.includes(allMonths[1].key)
                    ? 'bg-[#111111] text-white border-[#111111]'
                    : 'bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#2d313b] border-[#d9dbe0]'
                }`}
              >
                Прошлый
              </button>
            )}
            {allMonths.length >= 3 && (
              <button
                type="button"
                onClick={() => setSelectedMonths(allMonths.slice(0, 3).map(m => m.key))}
                className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer border ${
                  selectedMonths.length === 3 && allMonths.slice(0, 3).every(m => selectedMonths.includes(m.key))
                    ? 'bg-[#111111] text-white border-[#111111]'
                    : 'bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#2d313b] border-[#d9dbe0]'
                }`}
              >
                Квартал (3 мес.)
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedMonths(allMonths.map(m => m.key))}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer border ${
                selectedMonths.length === allMonths.length
                  ? 'bg-[#111111] text-white border-[#111111]'
                  : 'bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#2d313b] border-[#d9dbe0]'
              }`}
            >
              Все ({allMonths.length})
            </button>
          </div>

          {/* Compact Month Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 pt-1">
            {availableMonths.map(m => {
              const isChecked = selectedMonths.includes(m.id);
              const isCurr = m.id === current;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleMonth(m.id)}
                  className={`p-2.5 rounded-md border text-left transition-colors flex flex-col justify-between gap-1.5 cursor-pointer relative overflow-hidden ${
                    isChecked
                      ? 'bg-[#eef2ff] border-[#2f63ff] text-[#111111]'
                      : 'bg-[#f7f9ff] border-[#d9dbe0] hover:border-[#2f63ff]/60 text-[#2d313b]'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-[11px] font-mono text-[#5d6270] uppercase tracking-wider">{m.id}</span>
                    <div
                      className={`w-3.5 h-3.5 rounded-xs flex items-center justify-center transition-colors ${
                        isChecked
                          ? 'bg-[#2f63ff] text-white'
                          : 'bg-white border border-[#d9dbe0]'
                      }`}
                    >
                      {isChecked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-[#111111] truncate">
                      {formatMonthName(m.id)}
                    </span>
                    {isCurr && (
                      <span className="text-[10px] font-semibold text-[#b45309] shrink-0">
                        Тек.
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* What file contains info */}
        <div className="p-3.5 bg-[#f7f9ff] rounded-md border border-[#d9dbe0] text-xs text-[#2d313b] space-y-2">
          <div className="font-semibold text-[#111111] flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 text-[#2f63ff]" />
            <span>Содержимое ведомости SKLADIN:</span>
          </div>
          <ul className="list-disc list-inside space-y-1 text-[#2d313b] pl-1 leading-relaxed">
            <li><strong className="text-[#111111]">Лист 1 «Табель и расчет ФОТ»:</strong> список рабочих, должности, форма расчета, отработанные часы, дневные/ночные смены, ночные надбавки и итоговые начисления</li>
            <li><strong className="text-[#111111]">Лист 2 «Журнал смен и явок»:</strong> подробная история явок со временем чекина/чекаута, перерывами, метками QR-кода склада и GPS-координат</li>
            <li>Автоматический расчет фактических рабочих часов за вычетом перерывов</li>
          </ul>
        </div>

        {/* Error Message */}
        {errorMessage && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Export Button */}
        <div>
          <button
            onClick={handleExport}
            disabled={isExporting || selectedMonths.length === 0}
            className={`w-full py-2.5 px-4 rounded text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
              success
                ? 'bg-[#111111] text-white'
                : selectedMonths.length > 0
                ? 'bg-[#2f63ff] hover:bg-[#1f4fe0] text-white'
                : 'bg-[#f7f9ff] text-[#5d6270] border border-[#d9dbe0] cursor-not-allowed'
            }`}
          >
            {success ? (
              <>
                <Check className="w-4 h-4 stroke-[3]" />
                <span>Файл Excel успешно скачан</span>
              </>
            ) : isExporting ? (
              <span>Генерация файла...</span>
            ) : (
              <>
                <Download className="w-4 h-4 stroke-[2.5]" />
                <span>Выгрузить Excel-файл (.xlsx)</span>
              </>
            )}
          </button>
        </div>

      </div>

    </div>
  );
};
