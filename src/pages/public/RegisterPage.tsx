import React, { useEffect, useId, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { TARIFF_BY_ID, calculateTariffPrice, formatRub } from '../../config/tariffs';
import { trackAnalyticsEvent } from '../../config/site';
import { getPlanSelectionHint, navigate } from '../../utils/router';
import { BrandLogo, BrandWord } from '../../components/common/BrandLogo';
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff } from 'lucide-react';

export const RegisterPage: React.FC = () => {
  const fullNameId = useId();
  const emailId = useId();
  const phoneId = useId();
  const passwordId = useId();
  const { registerManager } = useApp();
  const hint = getPlanSelectionHint();
  const plan = TARIFF_BY_ID[hint.plan] || TARIFF_BY_ID.business;
  const calc = calculateTariffPrice(plan.id, hint.period);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    trackAnalyticsEvent('registration_start', {
      plan_hint: plan.id,
      period_hint: hint.period,
    });
  }, [plan.id, hint.period]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (fullName.trim().length < 2) {
      setError('Укажите ФИО полностью');
      return;
    }
    if (!email.includes('@')) {
      setError('Укажите корректный Email');
      return;
    }
    if (phone.replace(/\D/g, '').length < 10) {
      setError('Укажите номер телефона в формате +7...');
      return;
    }
    if (password.length < 6) {
      setError('Пароль должен содержать минимум 6 символов');
      return;
    }
    if (!acceptPrivacy || !acceptTerms) {
      setError('Необходимо подтвердить оба согласия с условиями и обработкой данных');
      return;
    }

    setSubmitting(true);
    try {
      const res = await registerManager({
        fullName: fullName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        password,
        acceptPrivacy,
        acceptTerms,
      });

      if (!res.success) {
        setError(res.error || 'Не удалось завершить регистрацию');
        return;
      }

      trackAnalyticsEvent('registration_success', {
        plan_hint: plan.id,
        period_hint: hint.period,
      });

      navigate('/app', { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-[#f7f9ff] text-[#111111] flex-1 flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Registration Form */}
        <div className="lg:col-span-7 bg-white border border-[#d9dbe0] rounded-lg p-6 sm:p-8 shadow-sm space-y-5">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[#5d6270]">
              <div className="flex items-center gap-2">
                <BrandLogo className="w-5 h-5" />
                <span>Шаг 1 из 2 · Регистрация руководителя</span>
              </div>
              <a
                href="/login"
                onClick={e => {
                  e.preventDefault();
                  navigate('/login');
                }}
                className="text-xs font-semibold text-[#2f63ff] hover:text-[#1f4fe0] hover:underline whitespace-nowrap"
              >
                Уже есть аккаунт? Войти
              </a>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-[#111111] tracking-tight">
              Создайте личный кабинет руководителя <BrandWord />
            </h1>
            <p className="text-xs sm:text-sm text-[#2d313b]">
              На следующем шаге внутри кабинета вы создадите организацию и сразу получите 7 дней бесплатного доступа.
            </p>
          </div>

            {error && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor={fullNameId} className="block text-xs font-semibold text-[#2d313b] mb-1.5">
                  ФИО руководителя <span className="text-rose-600">*</span>
                </label>
                <input
                  id={fullNameId}
                  type="text"
                  required
                  autoFocus
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Иванов Сергей Александрович"
                  className="w-full px-3.5 py-2.5 bg-white border border-[#d9dbe0] rounded-md text-sm text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor={emailId} className="block text-xs font-semibold text-[#2d313b] mb-1.5">
                    Email <span className="text-rose-600">*</span>
                  </label>
                  <input
                    id={emailId}
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="director@company.ru"
                    className="w-full px-3.5 py-2.5 bg-white border border-[#d9dbe0] rounded-md text-sm font-mono text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25"
                  />
                </div>
                <div>
                  <label htmlFor={phoneId} className="block text-xs font-semibold text-[#2d313b] mb-1.5">
                    Телефон <span className="text-rose-600">*</span>
                  </label>
                  <input
                    id={phoneId}
                    type="tel"
                    required
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="+7 999 123-45-67"
                    className="w-full px-3.5 py-2.5 bg-white border border-[#d9dbe0] rounded-md text-sm font-mono text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25"
                  />
                </div>
              </div>

              <div>
                <label htmlFor={passwordId} className="block text-xs font-semibold text-[#2d313b] mb-1.5">
                  Пароль (от 6 символов) <span className="text-rose-600">*</span>
                </label>
                <div className="relative">
                  <input
                    id={passwordId}
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Минимум 6 символов"
                    className="w-full px-3.5 pr-10 py-2.5 bg-white border border-[#d9dbe0] rounded-md text-sm font-mono text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#5d6270] hover:text-[#111111] cursor-pointer"
                    aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2.5 pt-1 text-xs text-[#2d313b]">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptPrivacy}
                    onChange={e => setAcceptPrivacy(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-[#d9dbe0] accent-[#2f63ff]"
                  />
                  <span>
                    Даю согласие на обработку персональных данных в соответствии с{' '}
                    <a
                      href="/privacy"
                      onClick={e => {
                        e.preventDefault();
                        navigate('/privacy');
                      }}
                      className="text-[#2f63ff] font-semibold underline"
                    >
                      Политикой конфиденциальности
                    </a>
                  </span>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptTerms}
                    onChange={e => setAcceptTerms(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-[#d9dbe0] accent-[#2f63ff]"
                  />
                  <span>
                    Принимаю{' '}
                    <a
                      href="/terms"
                      onClick={e => {
                        e.preventDefault();
                        navigate('/terms');
                      }}
                      className="text-[#2f63ff] font-semibold underline"
                    >
                      Условия использования сервиса <BrandWord />
                    </a>
                  </span>
                </label>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[46px] px-5 py-3 bg-[#2f63ff] hover:bg-[#1f4fe0] disabled:bg-[#e5e7eb] disabled:text-[#5d6270] text-white font-semibold text-sm rounded-full transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>{submitting ? 'Создаём аккаунт...' : 'Создать аккаунт и перейти в кабинет'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>

          {/* Right Summary Card */}
          <div className="lg:col-span-5 bg-white border border-[#d9dbe0] rounded-lg p-6 space-y-5">
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#5d6270]">Пробный доступ</div>
              <h2 className="text-lg font-bold text-[#111111]">7 дней бесплатно</h2>
              <p className="text-xs text-[#2d313b] leading-relaxed">
                Карта не требуется. После создания организации в кабинете активируются все модули <BrandWord />.
              </p>
            </div>

            <div className="p-4 bg-[#f7f9ff] border border-[#d9dbe0] rounded-md space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[#5d6270]">Выбранный ориентир тарифа:</span>
                <span className="font-bold text-[#111111]">{plan.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#5d6270]">Период после триала:</span>
                <span className="font-mono font-semibold text-[#111111] tabular-nums">
                  {calc.months} мес · {formatRub(calc.finalPriceRub)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#5d6270]">Лимиты тарифа «{plan.name}»:</span>
                <span className="font-mono font-semibold text-[#111111] tabular-nums">
                  до {plan.maxLocations} ПВЗ · до {plan.maxStaff} сотр.
                </span>
              </div>
            </div>

            <ul className="space-y-2 text-xs text-[#111111]">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#2f63ff] shrink-0 mt-0.5" />
                <span>Изолированное пространство вашей организации</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#2f63ff] shrink-0 mt-0.5" />
                <span>Встроенный генератор QR-проходной и геозоны</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#2f63ff] shrink-0 mt-0.5" />
                <span>Автоматический табель смен и экспорт ведомости в Excel</span>
              </li>
            </ul>
          </div>
      </div>
    </div>
  );
};
