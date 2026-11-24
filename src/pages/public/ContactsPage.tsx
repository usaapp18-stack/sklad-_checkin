import React, { useEffect, useId, useState } from 'react';
import { PUBLIC_SITE_CONFIG, PublicSiteConfig } from '../../config/site';
import { navigate } from '../../utils/router';
import { AlertCircle, CheckCircle2, Mail, MessageSquare, Phone, Send } from 'lucide-react';

export const ContactsPage: React.FC = () => {
  const nameId = useId();
  const contactId = useId();
  const topicId = useId();
  const messageId = useId();
  const [siteConfig, setSiteConfig] = useState<PublicSiteConfig>(PUBLIC_SITE_CONFIG);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [topic, setTopic] = useState('Запуск системы на складе / ПВЗ');
  const [message, setMessage] = useState('');
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [website, setWebsite] = useState(''); // Honeypot field

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/public/config')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!cancelled && data?.success && data.config) {
          setSiteConfig(prev => ({ ...prev, ...data.config }));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!acceptPrivacy) {
      setError('Необходимо согласие на обработку персональных данных');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/public/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          contact: contact.trim(),
          topic,
          message: message.trim(),
          acceptPrivacy,
          website,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setError(data?.error?.message || 'Не удалось отправить обращение');
        return;
      }
      setSubmitted(true);
      setName('');
      setContact('');
      setMessage('');
    } catch (err: any) {
      setError(err?.message || 'Ошибка соединения при отправке обращения');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20 space-y-10">
      <div className="max-w-2xl space-y-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#5d6270]">Обратная связь</div>
        <h1 className="text-3xl sm:text-5xl font-bold text-[#111111] tracking-tight text-balance">
          Контакты и консультация по запуску SKLADIN
        </h1>
        <p className="text-base text-[#2d313b] leading-relaxed">
          Напишите нам по вопросам внедрения на складах, выбора тарифа или выставления счёта для юридического лица.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-7 bg-white border border-[#d9dbe0] rounded-lg p-6 sm:p-8">
          {submitted ? (
            <div className="py-8 space-y-4">
              <div className="w-11 h-11 rounded-md bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-700" />
              </div>
              <h2 className="text-xl font-bold text-[#111111]">Обращение отправлено</h2>
              <p className="text-sm text-[#2d313b] leading-relaxed">
                Спасибо! Ваше сообщение сохранено. Мы свяжемся с вами по указанному контакту в рабочее время.
              </p>
              <button
                type="button"
                onClick={() => setSubmitted(false)}
                className="min-h-[44px] px-4 py-2 bg-[#f7f9ff] hover:bg-[#eef2ff] text-[#111111] border border-[#d9dbe0] rounded-full text-xs font-semibold cursor-pointer transition-colors"
              >
                Отправить ещё одно обращение
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <h2 className="text-lg font-bold text-[#111111]">Форма обратной связи</h2>

              {error && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Honeypot anti-spam field */}
              <div className="hidden" aria-hidden="true">
                <label htmlFor="contact-website">Website</label>
                <input
                  id="contact-website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={e => setWebsite(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor={nameId} className="block text-xs font-semibold text-[#2d313b] mb-1.5">
                    Ваше имя <span className="text-rose-600">*</span>
                  </label>
                  <input
                    id={nameId}
                    type="text"
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Александр Петров"
                    className="w-full px-3.5 py-2.5 bg-white border border-[#d9dbe0] rounded-md text-sm text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25"
                  />
                </div>
                <div>
                  <label htmlFor={contactId} className="block text-xs font-semibold text-[#2d313b] mb-1.5">
                    Телефон, Email или Telegram <span className="text-rose-600">*</span>
                  </label>
                  <input
                    id={contactId}
                    type="text"
                    required
                    value={contact}
                    onChange={e => setContact(e.target.value)}
                    placeholder="+7 999 000-00-00 или email"
                    className="w-full px-3.5 py-2.5 bg-white border border-[#d9dbe0] rounded-md text-sm text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25"
                  />
                </div>
              </div>

              <div>
                <label htmlFor={topicId} className="block text-xs font-semibold text-[#2d313b] mb-1.5">Тема обращения</label>
                <select
                  id={topicId}
                  value={topic}
                  onChange={e => setTopic(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#d9dbe0] rounded-md text-sm text-[#111111] focus:outline-none focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25"
                >
                  <option value="Запуск системы на складе / ПВЗ">Запуск системы на складе / ПВЗ</option>
                  <option value="Оплата подписки и счёт для юрлица">Оплата подписки и счёт для юрлица</option>
                  <option value="Техническая поддержка">Техническая поддержка</option>
                  <option value="Другой вопрос">Другой вопрос</option>
                </select>
              </div>

              <div>
                <label htmlFor={messageId} className="block text-xs font-semibold text-[#2d313b] mb-1.5">
                  Сообщение <span className="text-rose-600">*</span>
                </label>
                <textarea
                  id={messageId}
                  required
                  rows={4}
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="Расскажите о количестве складов и сотрудников или опишите ваш вопрос..."
                  className="w-full px-3.5 py-2.5 bg-white border border-[#d9dbe0] rounded-md text-sm text-[#111111] placeholder:text-[#5d6270]/70 focus:outline-none focus:border-[#2f63ff] focus:ring-2 focus:ring-[#2f63ff]/25"
                />
              </div>

              <label className="flex items-start gap-2.5 text-xs text-[#2d313b] cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptPrivacy}
                  onChange={e => setAcceptPrivacy(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-[#d9dbe0] accent-[#2f63ff]"
                />
                <span>
                  Я согласен на обработку персональных данных в соответствии с{' '}
                  <a
                    href="/privacy"
                    onClick={e => {
                      e.preventDefault();
                      navigate('/privacy');
                    }}
                    className="text-[#2f63ff] font-semibold underline"
                  >
                    политикой конфиденциальности
                  </a>
                </span>
              </label>

              <button
                type="submit"
                disabled={submitting}
                className="min-h-[44px] px-6 py-2.5 bg-[#2f63ff] hover:bg-[#1f4fe0] disabled:bg-[#e5e7eb] disabled:text-[#5d6270] text-white font-semibold text-sm rounded-full inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <Send className="w-4 h-4" />
                <span>{submitting ? 'Отправка...' : 'Отправить обращение'}</span>
              </button>
            </form>
          )}
        </div>

        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white border border-[#d9dbe0] rounded-lg p-6 space-y-4">
            <h2 className="text-lg font-bold text-[#111111]">Каналы связи</h2>
            {siteConfig.hasRealContacts ? (
              <div className="space-y-3 text-sm text-[#2d313b]">
                {siteConfig.contactEmail && (
                  <div className="flex items-center gap-2.5">
                    <Mail className="w-4 h-4 text-[#2f63ff]" />
                    <a href={`mailto:${siteConfig.contactEmail}`} className="font-mono hover:underline text-[#111111]">
                      {siteConfig.contactEmail}
                    </a>
                  </div>
                )}
                {siteConfig.contactPhone && (
                  <div className="flex items-center gap-2.5">
                    <Phone className="w-4 h-4 text-[#2f63ff]" />
                    <a href={`tel:${siteConfig.contactPhone}`} className="font-mono hover:underline text-[#111111]">
                      {siteConfig.contactPhone}
                    </a>
                  </div>
                )}
                {siteConfig.contactTelegram && (
                  <div className="flex items-center gap-2.5">
                    <MessageSquare className="w-4 h-4 text-[#2f63ff]" />
                    <span className="font-mono text-[#111111]">{siteConfig.contactTelegram}</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs sm:text-sm text-[#2d313b] leading-relaxed">
                Оставьте заявку через форму слева — все обращения поступают напрямую команде сопровождения SKLADIN с фиксацией темы и обратного контакта.
              </p>
            )}
          </div>

          <div className="bg-[#f7f9ff] border border-[#d9dbe0] rounded-lg p-6 space-y-2 text-xs text-[#2d313b]">
            <div className="font-bold text-sm text-[#111111]">Самостоятельный запуск за 2 минуты</div>
            <p className="leading-relaxed">
              Чтобы протестировать сервис в работе, не нужно ждать ответа менеджера: зарегистрируйтесь и получите 7 дней полного пробного доступа бесплатно.
            </p>
            <a
              href="/register"
              onClick={e => {
                e.preventDefault();
                navigate('/register');
              }}
              className="inline-block pt-1 font-bold text-[#2f63ff] hover:underline"
            >
              Перейти к регистрации →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
