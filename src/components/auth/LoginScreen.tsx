import React, { useId, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { getBrowserTimeZoneLabel } from '../../utils/time';
import {
  Eye,
  EyeOff,
  AlertCircle,
  UserPlus,
} from 'lucide-react';
import { BrandLogo, BrandWord } from '../common/BrandLogo';

interface LoginScreenProps {
  onOpenRegistration: () => void;
  embedded?: boolean;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onOpenRegistration, embedded = false }) => {
  const loginFieldId = useId();
  const passwordFieldId = useId();
  const { login, mskTime } = useApp();

  const [loginInput, setLoginInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const result = await login(loginInput, passwordInput);
      if (!result.success) {
        setError(result.error || 'Ошибка авторизации. Проверьте правильность логина и пароля.');
      }
    } catch (err: any) {
      setError(err?.message || 'Ошибка подключения к серверу');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`${embedded ? 'w-full' : 'min-h-screen p-4'} bg-[#f7f9ff] text-[#111111] flex flex-col justify-center items-center selection:bg-[#2f63ff] selection:text-white relative`}>
      <div className="w-full max-w-sm relative z-10 space-y-6">
        
        {/* Brand Header */}
        <div className="text-center space-y-1.5">
          <div className="inline-flex items-center justify-center mb-1">
            <BrandLogo className="w-12 h-12 shadow-sm" showFrame />
          </div>
          <h1>
            <BrandWord className="text-2xl sm:text-3xl text-[#111111] leading-none" />
          </h1>
          <p className="text-xs text-[#5d6270]">
            Учёт смен, чекинов и расчёт зарплаты склада
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white border border-[#d9dbe0] rounded-lg p-6 sm:p-7 shadow-sm space-y-5">

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            
            <div>
              <label htmlFor={loginFieldId} className="block text-xs font-medium text-[#2d313b] mb-1.5">
                Логин или телефон
              </label>
              <input
                id={loginFieldId}
                type="text"
                required
                autoFocus
                placeholder="Логин или номер телефона"
                value={loginInput}
                onChange={e => {
                  setLoginInput(e.target.value);
                  if (error) setError(null);
                }}
                className="w-full px-3.5 py-2.5 bg-white border border-[#d9dbe0] rounded-md text-sm text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25 transition-colors font-mono"
              />
            </div>

            <div>
              <label htmlFor={passwordFieldId} className="block text-xs font-medium text-[#2d313b] mb-1.5">
                Пароль
              </label>
              <div className="relative">
                <input
                  id={passwordFieldId}
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Введите пароль"
                  value={passwordInput}
                  onChange={e => {
                    setPasswordInput(e.target.value);
                    if (error) setError(null);
                  }}
                  className="w-full px-3.5 pr-10 py-2.5 bg-white border border-[#d9dbe0] rounded-md text-sm text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25 transition-colors font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5d6270] hover:text-[#111111] transition-colors p-1 cursor-pointer"
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || !loginInput.trim() || !passwordInput.trim()}
              className={`w-full py-2.5 px-4 rounded-full text-xs font-semibold flex items-center justify-center transition-colors shadow-sm mt-3 ${
                loginInput.trim() && passwordInput.trim() && !isLoading
                  ? 'bg-[#2f63ff] hover:bg-[#1f4fe0] text-white cursor-pointer active:scale-[0.99]'
                  : 'bg-[#e5e7eb] text-[#5d6270] border border-[#d9dbe0] cursor-not-allowed'
              }`}
            >
              <span>{isLoading ? 'Проверка...' : 'Войти в систему'}</span>
            </button>

          </form>

          {/* Registration Trigger */}
          <div className="pt-3 text-center border-t border-[#e5e7eb]">
            <button
              type="button"
              onClick={onOpenRegistration}
              className="text-xs text-[#111111] hover:text-[#2f63ff] font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5 text-[#2f63ff]" />
              <span>Подать заявку на выдачу доступа</span>
            </button>
          </div>

        </div>

        {/* Footer */}
        <div className="text-center text-xs text-[#5d6270]">
          <span>Время ({getBrowserTimeZoneLabel()}): <span className="font-mono text-[#111111] font-semibold tabular-nums">{mskTime.slice(0, 5)}</span></span>
        </div>

      </div>
    </div>
  );
};
