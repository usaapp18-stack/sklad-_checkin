import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { StaffMember } from '../types';
import { DayInfo, GeneratorResult } from './scheduleGenerator';

interface ExportSchedulePdfOptions {
  location: string;
  monthStr: string;
  monthName: string;
  daysList: DayInfo[];
  generatorResult: GeneratorResult;
  staffList: StaffMember[];
  scenarioTitle?: string;
}

function formatShortName(fullName: string): string {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]} ${parts[1][0]}.`;
  }
  return parts[0];
}

export async function exportScheduleToPdf({
  location,
  monthStr,
  monthName,
  daysList,
  generatorResult,
  staffList,
  scenarioTitle,
}: ExportSchedulePdfOptions): Promise<void> {
  // Create offscreen container with reliable coordinate space
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.top = '0px';
  container.style.left = '-9999px';
  container.style.width = '1200px';
  container.style.zIndex = '-9999';
  container.style.backgroundColor = '#ffffff';
  container.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  container.style.color = '#0f172a';

  document.body.appendChild(container);

  try {
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    const cleanLoc = location || 'Все_Склады';
    const totalDays = daysList.length;
    const coveredDays = generatorResult.metrics.coveredDays;
    const totalShifts = generatorResult.shifts.length;
    const wishesRespected = generatorResult.metrics.wishesRespected;
    const totalWishes = generatorResult.metrics.totalWishesInMonth;
    const generatedDateStr = new Date().toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    // ==========================================
    // PAGE 1: ОБЩАЯ СВОДКА + КАЛЕНДАРЬ (СЕТКА)
    // ==========================================
    const page1 = document.createElement('div');
    page1.style.width = '1200px';
    page1.style.minHeight = '848px';
    page1.style.padding = '32px 36px';
    page1.style.boxSizing = 'border-box';
    page1.style.backgroundColor = '#ffffff';

    // Robust employee name lookup with fallbacks
    const getEmployeeDisplayName = (stId: string): string => {
      const staff = staffList.find(s => s.id === stId);
      if (staff?.name) return staff.name;
      const shiftWithEmp = generatorResult.shifts.find(s => s.employeeId === stId);
      if (shiftWithEmp?.employeeName) return shiftWithEmp.employeeName;
      const workloadEmp = generatorResult.metrics.staffWorkload.find(w => w.employeeId === stId);
      if (workloadEmp?.employeeName) return workloadEmp.employeeName;
      return 'Сотрудник';
    };

    // First day offset (Mon = 0, Sun = 6)
    const firstDayOffset = (daysList[0].dayOfWeek + 6) % 7;

    let calendarCellsHtml = '';
    // Blanks
    for (let i = 0; i < firstDayOffset; i++) {
      calendarCellsHtml += `
        <div style="background-color: #f8fafc; border: 1px dashed #e2e8f0; border-radius: 8px; min-height: 86px;"></div>
      `;
    }

    // Days
    daysList.forEach(d => {
      const analysis = generatorResult.dayAnalysis[d.dateStr];
      const assignedIds = analysis?.assignedStaffIds || [];
      const isWeekend = d.dayOfWeek === 0 || d.dayOfWeek === 6;
      const isEmpty = analysis?.coverageStatus === 'empty';
      const isPartial = analysis?.coverageStatus === 'understaffed';

      let bg = '#ffffff';
      let border = '1px solid #cbd5e1';
      if (isEmpty) {
        bg = '#fff1f2';
        border = '1px solid #fecdd3';
      } else if (isPartial) {
        bg = '#fffbeb';
        border = '1px solid #fef3c7';
      }

      let staffBadges = '';
      if (assignedIds.length === 0) {
        staffBadges = `<div style="font-size: 11px; color: #e11d48; font-style: italic; margin-top: 4px;">Нет смены</div>`;
      } else {
        staffBadges = assignedIds
          .map(stId => {
            const name = formatShortName(getEmployeeDisplayName(stId));
            return `
              <div style="background: #eef2ff; border: 1px solid #a9bcff; color: #111111; font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 6px; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${name}
              </div>
            `;
          })
          .join('');
      }

      calendarCellsHtml += `
        <div style="background-color: ${bg}; border: ${border}; border-radius: 8px; padding: 6px 8px; min-height: 86px; display: flex; flex-direction: column; justify-content: space-between;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-family: monospace; font-size: 13px; font-weight: bold; color: ${isWeekend ? '#e11d48' : '#1e293b'};">
              ${d.dayNum}
            </span>
            ${analysis?.isReinforcedDay ? '<span style="font-size: 9px; background: #fef3c7; color: #b45309; padding: 1px 4px; border-radius: 4px; font-weight: bold;">УСИЛ</span>' : ''}
          </div>
          <div style="margin-top: 4px; margin-bottom: 4px;">
            ${staffBadges}
          </div>
          <div style="font-size: 10px; color: #64748b; text-align: right; font-family: monospace;">
            ${assignedIds.length}/${analysis?.targetCount || 1}
          </div>
        </div>
      `;
    });

    page1.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 16px; margin-bottom: 16px;">
        <div>
          <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #2f63ff;">
            Управление персоналом • График смен
          </div>
          <div style="font-size: 24px; font-weight: 900; color: #111111; margin-top: 2px;">
            График смен склада: ${cleanLoc}
          </div>
          <div style="font-size: 13px; color: #475569; margin-top: 2px;">
            Период: <strong>${monthName} (${monthStr})</strong> ${scenarioTitle ? `• Сценарий: <strong>${scenarioTitle}</strong>` : ''}
          </div>
        </div>
        <div style="text-align: right; font-size: 11px; color: #64748b;">
          <div>Сформировано: <strong>${generatedDateStr}</strong></div>
          <div style="margin-top: 2px;">Статус: <strong style="color: ${coveredDays === totalDays ? '#2f63ff' : '#b45309'};">${coveredDays === totalDays ? 'Готов к работе' : 'Требует внимания'}</strong></div>
        </div>
      </div>

      <!-- Метрики -->
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px;">
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 14px;">
          <div style="font-size: 10px; font-weight: bold; text-transform: uppercase; color: #64748b;">Закрыто дней</div>
          <div style="font-size: 20px; font-weight: 900; color: ${coveredDays === totalDays ? '#2f63ff' : '#b45309'}; margin-top: 2px;">
            ${coveredDays} <span style="font-size: 13px; font-weight: normal; color: #64748b;">/ ${totalDays}</span>
          </div>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 14px;">
          <div style="font-size: 10px; font-weight: bold; text-transform: uppercase; color: #64748b;">Всего смен в месяце</div>
          <div style="font-size: 20px; font-weight: 900; color: #0f172a; margin-top: 2px;">
            ${totalShifts}
          </div>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 14px;">
          <div style="font-size: 10px; font-weight: bold; text-transform: uppercase; color: #64748b;">Учтено пожеланий</div>
          <div style="font-size: 20px; font-weight: 900; color: #111111; margin-top: 2px;">
            ${wishesRespected} <span style="font-size: 13px; font-weight: normal; color: #64748b;">/ ${totalWishes}</span>
          </div>
        </div>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 14px;">
          <div style="font-size: 10px; font-weight: bold; text-transform: uppercase; color: #64748b;">Персонал склада</div>
          <div style="font-size: 20px; font-weight: 900; color: #2563eb; margin-top: 2px;">
            ${generatorResult.metrics.staffWorkload.length} <span style="font-size: 13px; font-weight: normal; color: #64748b;">сотр.</span>
          </div>
        </div>
      </div>

      <!-- Заголовок раздела -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <div style="font-size: 14px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px;">
          1. Календарный график смен (Сетка месяца)
        </div>
        <div style="font-size: 11px; color: #64748b;">
          Синий — назначена смена • Красный — выходной день
        </div>
      </div>

      <!-- Дни недели заголовок -->
      <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; text-align: center; font-size: 12px; font-weight: 800; color: #475569; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0; margin-bottom: 8px;">
        <div>Пн</div>
        <div>Вт</div>
        <div>Ср</div>
        <div>Чт</div>
        <div>Пт</div>
        <div style="color: #e11d48;">Сб</div>
        <div style="color: #e11d48;">Вс</div>
      </div>

      <!-- Календарная сетка -->
      <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px;">
        ${calendarCellsHtml}
      </div>

      <!-- Подвал страницы 1 -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 20px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8;">
        <div>График смен склада ${cleanLoc} • Период: ${monthName}</div>
        <div>Страница 1 из 3</div>
      </div>
    `;

    container.appendChild(page1);

    // ==========================================
    // PAGE 2: МАТРИЦА СМЕН (ПОСУТОЧНАЯ ВЕДОМОСТЬ)
    // ==========================================
    const page2 = document.createElement('div');
    page2.style.width = '1200px';
    page2.style.minHeight = '848px';
    page2.style.padding = '32px 36px';
    page2.style.boxSizing = 'border-box';
    page2.style.backgroundColor = '#ffffff';

    // Split days into 2 columns (e.g. 1..16 and 17..end) so table fits cleanly on landscape A4
    const halfLen = Math.ceil(daysList.length / 2);
    const col1Days = daysList.slice(0, halfLen);
    const col2Days = daysList.slice(halfLen);

    const renderTableHalf = (days: DayInfo[]) => {
      return `
        <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
          <thead>
            <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1; text-align: left; font-size: 10px; text-transform: uppercase; color: #475569;">
              <th style="padding: 6px 8px;">Дата</th>
              <th style="padding: 6px 8px;">День</th>
              <th style="padding: 6px 8px;">План/Факт</th>
              <th style="padding: 6px 8px;">Назначенный сотрудник</th>
              <th style="padding: 6px 8px; text-align: right;">Статус</th>
            </tr>
          </thead>
          <tbody>
            ${days
              .map(d => {
                const analysis = generatorResult.dayAnalysis[d.dateStr];
                const assignedIds = analysis?.assignedStaffIds || [];
                const isWeekend = d.dayOfWeek === 0 || d.dayOfWeek === 6;
                const status = analysis?.coverageStatus;

                let statusBadge = '<span style="background: #eef2ff; color: #2f63ff; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 9px;">Закрыт</span>';
                if (status === 'understaffed') {
                  statusBadge = '<span style="background: #fffbeb; color: #b45309; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 9px;">Частично</span>';
                } else if (status === 'empty') {
                  statusBadge = '<span style="background: #fff1f2; color: #be123c; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 9px;">Пропуск</span>';
                }

                const staffNames = assignedIds
                  .map(stId => {
                    return formatShortName(getEmployeeDisplayName(stId));
                  })
                  .join(', ') || '<span style="color: #e11d48; font-style: italic;">—</span>';

                return `
                  <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 5px 8px; font-family: monospace; font-weight: bold; color: #0f172a;">${d.dayNum} ${monthName.slice(0, 3)}</td>
                    <td style="padding: 5px 8px; font-weight: bold; color: ${isWeekend ? '#e11d48' : '#64748b'};">${d.dayName}</td>
                    <td style="padding: 5px 8px; font-family: monospace; font-weight: bold; color: ${assignedIds.length >= (analysis?.targetCount || 1) ? '#111111' : '#e11d48'};">
                      ${assignedIds.length}/${analysis?.targetCount || 1}
                    </td>
                    <td style="padding: 5px 8px; font-weight: 600; color: #1e293b;">${staffNames}</td>
                    <td style="padding: 5px 8px; text-align: right;">${statusBadge}</td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      `;
    };

    page2.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 16px; margin-bottom: 16px;">
        <div>
          <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #2f63ff;">
            Управление персоналом • График смен
          </div>
          <div style="font-size: 24px; font-weight: 900; color: #0f172a; margin-top: 2px;">
            2. Матрица смен (Посуточная ведомость): ${cleanLoc}
          </div>
          <div style="font-size: 13px; color: #475569; margin-top: 2px;">
            Период: <strong>${monthName} (${monthStr})</strong>
          </div>
        </div>
        <div style="text-align: right; font-size: 11px; color: #64748b;">
          <div>Сформировано: <strong>${generatedDateStr}</strong></div>
          <div style="margin-top: 2px;">Всего записей: <strong>${totalDays} дней</strong></div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
        <div>${renderTableHalf(col1Days)}</div>
        <div>${renderTableHalf(col2Days)}</div>
      </div>

      <!-- Подвал страницы 2 -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 28px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8;">
        <div>График смен склада ${cleanLoc} • Период: ${monthName}</div>
        <div>Страница 2 из 3</div>
      </div>
    `;

    container.appendChild(page2);

    // ==========================================
    // PAGE 3: БАЛАНС И НАГРУЗКА СОТРУДНИКОВ
    // ==========================================
    const page3 = document.createElement('div');
    page3.style.width = '1200px';
    page3.style.minHeight = '848px';
    page3.style.padding = '32px 36px';
    page3.style.boxSizing = 'border-box';
    page3.style.backgroundColor = '#ffffff';

    const staffRowsHtml = generatorResult.metrics.staffWorkload.length > 0
      ? generatorResult.metrics.staffWorkload
          .map((st, idx) => {
            const staffObj = staffList.find(s => s.id === st.employeeId);
            const role = st.isSenior ? 'Старший смены' : staffObj?.role || 'Работник склада';
            const displayName = st.employeeName || staffObj?.name || 'Сотрудник';
            return `
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 10px 12px; font-weight: 700; color: #0f172a;">
                  ${idx + 1}. ${displayName}
                  ${st.isSenior ? '<span style="margin-left: 6px; font-size: 9px; background: #fef3c7; color: #b45309; padding: 2px 6px; border-radius: 4px; font-weight: bold;">Старший</span>' : ''}
                </td>
                <td style="padding: 10px 12px; color: #64748b;">${role}</td>
                <td style="padding: 10px 12px; font-family: monospace; font-size: 14px; font-weight: 900; color: #111111; text-align: center;">
                  ${st.shiftsCount} смен
                </td>
                <td style="padding: 10px 12px; font-family: monospace; font-size: 13px; font-weight: 700; color: #1e293b; text-align: center;">
                  ${st.hours} ч.
                </td>
                <td style="padding: 10px 12px; text-align: center;">
                  <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <div style="width: 80px; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">
                      <div style="width: ${Math.min(100, st.percentOfMonth)}%; height: 100%; background: #2f63ff; border-radius: 4px;"></div>
                    </div>
                    <span style="font-family: monospace; font-weight: bold; font-size: 12px; color: #0f172a;">${st.percentOfMonth}%</span>
                  </div>
                </td>
                <td style="padding: 10px 12px; text-align: center; color: #2d313b; font-weight: 700;">
                  ${st.wishesMet} учтено
                </td>
              </tr>
            `;
          })
          .join('')
      : `
        <tr>
          <td colspan="6" style="padding: 24px; text-align: center; color: #94a3b8; font-style: italic;">
            На данный месяц смены пока не назначены
          </td>
        </tr>
      `;

    page3.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 16px; margin-bottom: 16px;">
        <div>
          <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #2f63ff;">
            Управление персоналом • График смен
          </div>
          <div style="font-size: 24px; font-weight: 900; color: #0f172a; margin-top: 2px;">
            3. Баланс сотрудников и учет рабочего времени: ${cleanLoc}
          </div>
          <div style="font-size: 13px; color: #475569; margin-top: 2px;">
            Период: <strong>${monthName} (${monthStr})</strong>
          </div>
        </div>
        <div style="text-align: right; font-size: 11px; color: #64748b;">
          <div>Сформировано: <strong>${generatedDateStr}</strong></div>
          <div style="margin-top: 2px;">Сотрудников в графике: <strong>${generatorResult.metrics.staffWorkload.length}</strong></div>
        </div>
      </div>

      <!-- Таблица сотрудников -->
      <table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 28px;">
        <thead>
          <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1; text-align: left; font-size: 11px; text-transform: uppercase; color: #475569;">
            <th style="padding: 10px 12px;">Сотрудник</th>
            <th style="padding: 10px 12px;">Должность</th>
            <th style="padding: 10px 12px; text-align: center;">Назначено смен</th>
            <th style="padding: 10px 12px; text-align: center;">Часов в месяце</th>
            <th style="padding: 10px 12px; text-align: center;">Доля месяца</th>
            <th style="padding: 10px 12px; text-align: center;">Пожелания</th>
          </tr>
        </thead>
        <tbody>
          ${staffRowsHtml}
        </tbody>
      </table>

      <!-- Блок подписей и утверждения -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; padding: 20px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 12px;">
        <div>
          <div style="font-size: 11px; font-weight: bold; color: #475569; text-transform: uppercase;">Составил (Начальник склада):</div>
          <div style="margin-top: 24px; border-bottom: 1px solid #94a3b8; width: 80%;"></div>
          <div style="margin-top: 6px; font-size: 11px; color: #64748b;">Подпись / ФИО</div>
        </div>
        <div>
          <div style="font-size: 11px; font-weight: bold; color: #475569; text-transform: uppercase;">Утвердил (Руководитель):</div>
          <div style="margin-top: 24px; border-bottom: 1px solid #94a3b8; width: 80%;"></div>
          <div style="margin-top: 6px; font-size: 11px; color: #64748b;">Подпись / ФИО • «___» ___________ 202_ г.</div>
        </div>
      </div>

      <!-- Подвал страницы 3 -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 36px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8;">
        <div>График смен склада ${cleanLoc} • Документ утверждения смен</div>
        <div>Страница 3 из 3</div>
      </div>
    `;

    container.appendChild(page3);

    const html2canvasOptions = {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      scrollX: 0,
      scrollY: 0,
      windowWidth: 1200,
    };

    // Render Canvas for Page 1
    const canvas1 = await html2canvas(page1, html2canvasOptions);
    const imgData1 = canvas1.toDataURL('image/jpeg', 0.95);
    pdf.addImage(imgData1, 'JPEG', 0, 0, 297, 210, undefined, 'FAST');

    // Render Canvas for Page 2
    pdf.addPage('a4', 'landscape');
    const canvas2 = await html2canvas(page2, html2canvasOptions);
    const imgData2 = canvas2.toDataURL('image/jpeg', 0.95);
    pdf.addImage(imgData2, 'JPEG', 0, 0, 297, 210, undefined, 'FAST');

    // Render Canvas for Page 3
    pdf.addPage('a4', 'landscape');
    const canvas3 = await html2canvas(page3, html2canvasOptions);
    const imgData3 = canvas3.toDataURL('image/jpeg', 0.95);
    pdf.addImage(imgData3, 'JPEG', 0, 0, 297, 210, undefined, 'FAST');

    // Download PDF directly to user's device
    const fileName = `График_смен_${cleanLoc.replace(/[^a-zA-Z0-9а-яА-Я._-]/g, '_')}_${monthStr}.pdf`;
    pdf.save(fileName);
  } finally {
    if (document.body.contains(container)) {
      document.body.removeChild(container);
    }
  }
}

interface ExportExistingSchedulePdfOptions {
  location: string;
  locationCode?: string;
  monthStr: string;
  monthName: string;
  daysList: DayInfo[];
  plannedShifts: { id: string; date: string; employeeId: string; employeeName: string; location: string; shiftType?: string }[];
  staffList: StaffMember[];
}

export async function exportExistingPvzScheduleToPdf({
  location,
  locationCode,
  monthStr,
  monthName,
  daysList,
  plannedShifts,
  staffList,
}: ExportExistingSchedulePdfOptions): Promise<void> {
  // Ensure staffList has entries for all employees present in plannedShifts
  const combinedStaffList = [...staffList];
  const employeeNameMap = new Map<string, string>();
  staffList.forEach(st => employeeNameMap.set(st.id, st.name));

  plannedShifts.forEach(s => {
    if (s.employeeId) {
      if (s.employeeName && !employeeNameMap.has(s.employeeId)) {
        employeeNameMap.set(s.employeeId, s.employeeName);
      }
      if (!combinedStaffList.some(st => st.id === s.employeeId)) {
        combinedStaffList.push({
          id: s.employeeId,
          name: s.employeeName || 'Сотрудник',
          role: 'Работник склада',
          status: 'active',
          locations: [location, locationCode].filter(Boolean) as string[],
          phone: '',
        } as any);
      }
    }
  });

  // Construct dayAnalysis for every day of the month using all shifts provided
  const dayAnalysis: Record<string, any> = {};
  let coveredDaysCount = 0;

  daysList.forEach(d => {
    // Shifts provided to this function are already filtered for the target PVZ
    const dayShifts = plannedShifts.filter(s => s.date === d.dateStr);
    const assignedStaffIds = Array.from(new Set(dayShifts.map(s => s.employeeId).filter(Boolean)));
    const isCovered = assignedStaffIds.length > 0;
    if (isCovered) coveredDaysCount++;

    dayAnalysis[d.dateStr] = {
      dateStr: d.dateStr,
      dayNum: d.dayNum,
      dayOfWeek: d.dayOfWeek,
      dayName: d.dayName,
      targetCount: Math.max(1, assignedStaffIds.length),
      assignedStaffIds,
      isReinforcedDay: assignedStaffIds.length > 1,
      coverageStatus: isCovered ? 'ok' : 'empty',
      wishesOnThisDay: [],
      violations: [],
    };
  });

  // Calculate staff workload from the provided shifts
  const staffWorkloadMap = new Map<string, { employeeId: string; employeeName: string; shiftsCount: number; hours: number; isSenior: boolean }>();

  plannedShifts.forEach(s => {
    if (!s.employeeId) return;
    let st = staffWorkloadMap.get(s.employeeId);
    if (!st) {
      const empName = s.employeeName || employeeNameMap.get(s.employeeId) || 'Сотрудник';
      st = {
        employeeId: s.employeeId,
        employeeName: empName,
        shiftsCount: 0,
        hours: 0,
        isSenior: false,
      };
      staffWorkloadMap.set(s.employeeId, st);
    }
    st.shiftsCount += 1;
    st.hours += 12; // standard 12h shift
  });

  const staffWorkload = Array.from(staffWorkloadMap.values())
    .filter(st => st.shiftsCount > 0)
    .sort((a, b) => b.shiftsCount - a.shiftsCount)
    .map(st => ({
      ...st,
      percentOfMonth: daysList.length > 0 ? Math.round((st.shiftsCount / daysList.length) * 100) : 0,
      dates: plannedShifts
        .filter(s => s.employeeId === st.employeeId)
        .map(s => parseInt(s.date.split('-')[2], 10))
        .filter(n => !isNaN(n)),
      wishesMet: 0,
      wishesViolated: 0,
    }));

  const generatorResult: GeneratorResult = {
    shifts: plannedShifts.map(s => ({
      id: s.id || `shift-${s.date}-${s.employeeId}`,
      date: s.date,
      location: location,
      shiftType: (s.shiftType as any) || 'day12',
      employeeId: s.employeeId,
      employeeName: s.employeeName || employeeNameMap.get(s.employeeId) || 'Сотрудник',
    })),
    dayAnalysis,
    metrics: {
      totalDays: daysList.length,
      coveredDays: coveredDaysCount,
      uncoveredDays: daysList.length - coveredDaysCount,
      reinforcedDaysTarget: 0,
      reinforcedDaysFulfilled: 0,
      wishesRespected: 0,
      wishesViolated: 0,
      totalWishesInMonth: 0,
      staffWorkload,
      criticalConflicts: [],
    },
  };

  return exportScheduleToPdf({
    location,
    monthStr,
    monthName,
    daysList,
    generatorResult,
    staffList: combinedStaffList,
    scenarioTitle: 'Утвержденный график склада',
  });
}

