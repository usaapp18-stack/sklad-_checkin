import { Router, Request, Response } from 'express';
import { getOrgSetting, setOrgSetting } from '../db/orgSettings';
import { requireManager, requireOrganization, requireActiveWriteAccess } from '../middleware/auth';
import { PaybackPvzRecord, PaybackArticleTemplates } from '../../src/types';

export const paybackRouter = Router();

const DEFAULT_INCOME_NAMES = [
  'Агентское вознаграждение',
  'Продажи за смену (выручка)',
];

const DEFAULT_EXPENSE_NAMES = [
  'Аренда помещения',
  'Фонд оплаты труда (ФОТ)',
  'Коммунальные услуги и интернет',
  'Эквайринг и банковское обслуживание',
  'Расходники (лента, скотч, пакетирование)',
  'Налоги',
];

async function getStoredRecords(organizationId: string): Promise<PaybackPvzRecord[]> {
  return getOrgSetting<PaybackPvzRecord[]>(organizationId, 'payback_records', []);
}

async function saveStoredRecords(organizationId: string, records: PaybackPvzRecord[]): Promise<void> {
  await setOrgSetting(organizationId, 'payback_records', records);
}

async function getStoredTemplates(organizationId: string): Promise<PaybackArticleTemplates> {
  const parsed = await getOrgSetting<PaybackArticleTemplates | null>(organizationId, 'payback_article_templates', null);
  if (parsed) {
    const inc = Array.isArray(parsed.incomeArticles)
      ? parsed.incomeArticles
      : Array.from(new Set([...DEFAULT_INCOME_NAMES, ...(parsed.customIncomeArticles || [])]));
    const exp = Array.isArray(parsed.expenseArticles)
      ? parsed.expenseArticles
      : Array.from(new Set([...DEFAULT_EXPENSE_NAMES, ...(parsed.customExpenseArticles || [])]));
    return {
      incomeArticles: inc,
      expenseArticles: exp,
      customIncomeArticles: parsed.customIncomeArticles || [],
      customExpenseArticles: parsed.customExpenseArticles || [],
    };
  }
  return {
    incomeArticles: [...DEFAULT_INCOME_NAMES],
    expenseArticles: [...DEFAULT_EXPENSE_NAMES],
    customIncomeArticles: [],
    customExpenseArticles: [],
  };
}

async function saveStoredTemplates(organizationId: string, templates: PaybackArticleTemplates): Promise<void> {
  await setOrgSetting(organizationId, 'payback_article_templates', templates);
}

// GET /api/v1/payback
paybackRouter.get('/', requireManager, requireOrganization, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const [records, templates] = await Promise.all([
      getStoredRecords(orgId),
      getStoredTemplates(orgId),
    ]);
    res.json({ success: true, records, templates });
  } catch (err) {
    console.error('[Payback] Get error:', err);
    res.status(500).json({ success: false, error: 'Ошибка загрузки данных окупаемости' });
  }
});

// POST /api/v1/payback
paybackRouter.post('/', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { record } = req.body;
    if (!record || !record.pvzCode || !record.month) {
      res.status(400).json({ success: false, error: 'Не указан склад или месяц' });
      return;
    }

    const targetPvz = String(record.pvzCode).trim();
    const targetMonth = String(record.month).trim();

    const [recordsRaw, templates] = await Promise.all([
      getStoredRecords(orgId),
      getStoredTemplates(orgId),
    ]);

    const records = recordsRaw.filter(r => !(r.pvzCode === targetPvz && r.month === targetMonth));

    const newRecord: PaybackPvzRecord = {
      pvzCode: targetPvz,
      month: targetMonth,
      incomes: Array.isArray(record.incomes) ? record.incomes : [],
      expenses: Array.isArray(record.expenses) ? record.expenses : [],
      updatedAt: new Date().toISOString(),
    };

    records.push(newRecord);

    const currentIncomeNames = (newRecord.incomes || []).map(i => i.name.trim()).filter(Boolean);
    const currentExpenseNames = (newRecord.expenses || []).map(e => e.name.trim()).filter(Boolean);

    if (currentIncomeNames.length > 0) {
      templates.incomeArticles = currentIncomeNames;
    }
    if (currentExpenseNames.length > 0) {
      templates.expenseArticles = currentExpenseNames;
    }

    await Promise.all([
      saveStoredRecords(orgId, records),
      saveStoredTemplates(orgId, templates),
    ]);

    res.json({ success: true, records, templates });
  } catch (err) {
    console.error('[Payback] Save error:', err);
    res.status(500).json({ success: false, error: 'Ошибка сохранения данных окупаемости' });
  }
});

// POST /api/v1/payback/article
paybackRouter.post('/article', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { type, action, name, oldName } = req.body;
    if (!type || !action || !name) {
      res.status(400).json({ success: false, error: 'Некорректные параметры статьи' });
      return;
    }

    const templates = await getStoredTemplates(orgId);
    let records = await getStoredRecords(orgId);

    const isIncome = type === 'income';
    let list = isIncome ? templates.incomeArticles || [] : templates.expenseArticles || [];

    if (action === 'add') {
      const cleanName = name.trim();
      if (cleanName && !list.includes(cleanName)) {
        list.push(cleanName);
      }
    } else if (action === 'edit' && oldName) {
      const cleanOld = oldName.trim();
      const cleanNew = name.trim();
      const idx = list.indexOf(cleanOld);
      if (idx !== -1) {
        list[idx] = cleanNew;
      } else if (!list.includes(cleanNew)) {
        list.push(cleanNew);
      }
      records = records.map(r => {
        const arr = isIncome ? r.incomes : r.expenses;
        const updatedArr = (arr || []).map(item => (item.name === cleanOld ? { ...item, name: cleanNew } : item));
        return isIncome ? { ...r, incomes: updatedArr } : { ...r, expenses: updatedArr };
      });
      await saveStoredRecords(orgId, records);
    } else if (action === 'delete') {
      const cleanName = name.trim();
      list = list.filter(n => n !== cleanName);
      records = records.map(r => {
        const arr = isIncome ? r.incomes : r.expenses;
        const filtered = (arr || []).filter(item => item.name !== cleanName);
        return isIncome ? { ...r, incomes: filtered } : { ...r, expenses: filtered };
      });
      await saveStoredRecords(orgId, records);
    }

    if (isIncome) {
      templates.incomeArticles = list;
    } else {
      templates.expenseArticles = list;
    }

    await saveStoredTemplates(orgId, templates);
    res.json({ success: true, templates, records });
  } catch (err) {
    console.error('[Payback] Article action error:', err);
    res.status(500).json({ success: false, error: 'Ошибка изменения статьи' });
  }
});

// DELETE /api/v1/payback/:pvzCode/:month
paybackRouter.delete('/:pvzCode/:month', requireManager, requireActiveWriteAccess, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user!.organizationId!;
    const { pvzCode, month } = req.params;
    let records = await getStoredRecords(orgId);
    records = records.filter(r => !(r.pvzCode === pvzCode && r.month === month));
    await saveStoredRecords(orgId, records);
    res.json({ success: true, records });
  } catch (err) {
    console.error('[Payback] Delete error:', err);
    res.status(500).json({ success: false, error: 'Ошибка удаления данных окупаемости' });
  }
});
