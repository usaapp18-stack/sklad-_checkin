import React, { useId, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { UserPlus, Clock, CheckCircle2, XCircle, ArrowRight, Lock, Loader2 } from 'lucide-react';
import { AccessibleModal } from '../common/AccessibleModal';

interface RegistrationViewProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RegistrationView: React.FC<RegistrationViewProps> = ({ isOpen, onClose }) => {
  const nameFieldId = useId();
  const telegramFieldId = useId();
  const { submitRegistration, applications, staffList } = useApp();
  const [name, setName] = useState('');
  const [telegram, setTelegram] = useState('');
  const [submittedAppId, setSubmittedAppId] = useState<string | null>(null);
  const [localApp, setLocalApp] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const currentApp = localApp || applications.find(a => a.id === submittedAppId);
  const newlyCreatedStaff = currentApp?.status === 'accepted'
    ? staffList.find(s => s.name.toLowerCase() === currentApp.name.toLowerCase())
    : null;

  const handleClose = () => {
    setName('');
    setTelegram('');
    setSubmittedAppId(null);
    setLocalApp(null);
    setErrorMessage(null);
    setIsSubmitting(false);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await submitRegistration(name, telegram);
      if (result.success && result.id) {
        setSubmittedAppId(result.id);
        setLocalApp({
          id: result.id,
          name: name.trim(),
          telegram_username: telegram.trim(),
          status: 'pending',
        });
      } else {
        setErrorMessage(result.error || 'Не удалось отправить заявку. Попробуйте еще раз.');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Ошибка сети при отправке заявки');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Заявка на доступ"
      subtitle="Получение логина и пароля от руководителя"
      maxWidthClass="max-w-md"
    >
      {submittedAppId && currentApp ? (
        <div className="py-2 text-center space-y-4">
          {currentApp.status === 'pending' && (
            <div className="space-y-3">
              <Clock className="w-7 h-7 text-[#b45309] mx-auto" />
              <h4 className="text-base font-semibold text-[#111111]">Заявка отправлена руководителю</h4>
              <p className="text-xs text-[#2d313b] max-w-xs mx-auto leading-relaxed">
                Статус: <span className="text-[#b45309] font-semibold">«Ожидает решения»</span>. Руководитель создаст логин и пароль и откроет вам доступ.
              </p>
              <div className="p-3 bg-[#f7f9ff] rounded-md border border-[#d9dbe0] text-xs text-[#2d313b]">
                Кандидат: <span className="font-semibold text-[#111111]">{currentApp.name}</span>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="w-full mt-4 py-2.5 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white rounded text-xs font-semibold transition-colors cursor-pointer"
              >
                Понятно, закрыть
              </button>
            </div>
          )}

          {currentApp.status === 'accepted' && (
            <div className="space-y-3">
              <CheckCircle2 className="w-7 h-7 text-[#2f63ff] mx-auto" />
              <h4 className="text-base font-semibold text-[#111111]">Заявка одобрена!</h4>
              <p className="text-xs text-[#2d313b]">
                Руководитель выдал доступ к админке работника.
              </p>
              {newlyCreatedStaff && (
                <div className="p-3 bg-[#f7f9ff] rounded-md border border-[#d9dbe0] text-xs font-mono space-y-1 text-left">
                  <div className="text-[#5d6270]">Ваш логин: <span className="text-[#111111] font-semibold">{newlyCreatedStaff.login}</span></div>
                  <div className="text-[#5d6270]">Пароль: <span className="text-[#2f63ff] font-semibold">•••••••• (задан руководителем)</span></div>
                </div>
              )}
              <button
                type="button"
                onClick={handleClose}
                className="w-full py-2.5 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white rounded text-xs font-semibold transition-colors cursor-pointer"
              >
                Перейти на страницу авторизации
              </button>
            </div>
          )}

          {currentApp.status === 'rejected' && (
            <div className="space-y-3">
              <XCircle className="w-7 h-7 text-rose-600 mx-auto" />
              <h4 className="text-base font-semibold text-[#111111]">Заявка отклонена</h4>
              <p className="text-xs text-[#2d313b]">
                {currentApp.note ? `Причина: ${currentApp.note}` : 'Руководитель отклонил заявку на регистрацию.'}
              </p>
              <p className="text-[11px] text-[#5d6270]">
                Доступ к функциям работника не предоставлен.
              </p>
              <button
                type="button"
                onClick={handleClose}
                className="w-full mt-2 py-2 bg-[#f7f9ff] hover:bg-[#eef2ff] border border-[#d9dbe0] text-[#111111] rounded text-xs font-semibold transition-colors cursor-pointer"
              >
                Закрыть
              </button>
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="p-3 bg-[#f7f9ff] rounded-md border border-[#d9dbe0] text-xs text-[#2d313b] flex items-start gap-2 leading-relaxed">
            <Lock className="w-4 h-4 text-[#2f63ff] shrink-0 mt-0.5" />
            <span>
              Доступ к админке выдает только руководитель. Логин и пароль будут созданы после рассмотрения заявки.
            </span>
          </div>

          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800">
              {errorMessage}
            </div>
          )}

          <div>
            <label htmlFor={nameFieldId} className="block text-xs font-semibold text-[#2d313b] mb-1">
              ФИО работника *
            </label>
            <input
              id={nameFieldId}
              type="text"
              required
              placeholder="например, Екатерина Орлова"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2.5 bg-white border border-[#d9dbe0] rounded text-xs text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25 transition-colors"
            />
          </div>

          <div>
            <label htmlFor={telegramFieldId} className="block text-xs font-semibold text-[#2d313b] mb-1">
              Telegram Username (необязательно)
            </label>
            <input
              id={telegramFieldId}
              type="text"
              placeholder="@username"
              value={telegram}
              onChange={e => setTelegram(e.target.value)}
              className="w-full px-3 py-2.5 bg-white border border-[#d9dbe0] rounded text-xs text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25 transition-colors"
            />
          </div>

          {/* Footer */}
          <div className="pt-3 border-t border-[#e5e7eb] flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-semibold text-[#2d313b] hover:text-[#111111] bg-white hover:bg-[#eef2ff] border border-[#d9dbe0] rounded transition-colors cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={!name.trim() || isSubmitting}
              className={`px-5 py-2 text-xs font-semibold rounded flex items-center gap-1.5 transition-colors ${
                name.trim() && !isSubmitting
                  ? 'bg-[#2f63ff] hover:bg-[#1f4fe0] text-white cursor-pointer'
                  : 'bg-[#eef2ff] text-[#5d6270] border border-[#d9dbe0] cursor-not-allowed'
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Отправка...</span>
                </>
              ) : (
                <>
                  <span>Отправить заявку</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </AccessibleModal>
  );
};
