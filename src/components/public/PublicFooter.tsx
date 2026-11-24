import React from 'react';
import { PublicSiteConfig } from '../../config/site';
import { navigate } from '../../utils/router';
import { BrandLogo, BrandWord } from '../common/BrandLogo';

interface PublicFooterProps {
  siteConfig: PublicSiteConfig;
  isAuthenticated?: boolean;
  onScrollTop?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}

export const PublicFooter: React.FC<PublicFooterProps> = ({
  siteConfig,
  isAuthenticated = false,
  onScrollTop,
}) => {
  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    navigate(href);
  };

  return (
    <footer className="bg-[#111111] text-neutral-300 border-t border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 pb-10 border-b border-white/10">
          <div className="space-y-3">
            <a
              href={onScrollTop ? '#top' : '/'}
              onClick={e => (onScrollTop ? onScrollTop(e) : handleLinkClick(e, '/'))}
              className="inline-flex items-center gap-2.5 group whitespace-nowrap"
              aria-label="SKLADIN — Главная"
            >
              <BrandLogo className="w-7 h-7 shrink-0" />
              <BrandWord className="text-xl text-white leading-none" />
            </a>
            <p className="text-xs leading-relaxed text-neutral-400">
              Система учёта смен, чекинов, графиков, QR-проходной и расчёта заработной платы персонала для складов, фулфилмента и сетей ПВЗ.
            </p>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="font-bold text-white text-sm">Продукт</div>
            <ul className="space-y-2">
              <li>
                <a href="/features" onClick={e => handleLinkClick(e, '/features')} className="hover:text-white transition-colors">
                  Возможности системы
                </a>
              </li>
              <li>
                <a href="/pricing" onClick={e => handleLinkClick(e, '/pricing')} className="hover:text-white transition-colors">
                  Тарифы и оплата
                </a>
              </li>
              <li>
                <a href="/demo" onClick={e => handleLinkClick(e, '/demo')} className="hover:text-white transition-colors">
                  Демонстрация интерфейса
                </a>
              </li>
              <li>
                <a href="/register" onClick={e => handleLinkClick(e, '/register')} className="hover:text-white transition-colors">
                  Начать 7 дней бесплатно
                </a>
              </li>
            </ul>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="font-bold text-white text-sm">Компания</div>
            <ul className="space-y-2">
              <li>
                <a href="/about" onClick={e => handleLinkClick(e, '/about')} className="hover:text-white transition-colors">
                  О сервисе
                </a>
              </li>
              <li>
                <a href="/faq" onClick={e => handleLinkClick(e, '/faq')} className="hover:text-white transition-colors">
                  Вопросы и ответы (FAQ)
                </a>
              </li>
              <li>
                <a href="/contacts" onClick={e => handleLinkClick(e, '/contacts')} className="hover:text-white transition-colors">
                  Связаться с нами
                </a>
              </li>
              <li>
                <a
                  href={isAuthenticated ? '/app' : '/login'}
                  onClick={e => handleLinkClick(e, isAuthenticated ? '/app' : '/login')}
                  className="hover:text-white transition-colors"
                >
                  {isAuthenticated ? 'Рабочий кабинет' : 'Вход в кабинет'}
                </a>
              </li>
            </ul>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="font-bold text-white text-sm">Правовая информация и связь</div>
            <ul className="space-y-2">
              <li>
                <a href="/privacy" onClick={e => handleLinkClick(e, '/privacy')} className="hover:text-white transition-colors">
                  Политика конфиденциальности
                </a>
              </li>
              <li>
                <a href="/terms" onClick={e => handleLinkClick(e, '/terms')} className="hover:text-white transition-colors">
                  Пользовательское соглашение
                </a>
              </li>
              {siteConfig.contactEmail && (
                <li className="pt-1 font-mono text-white">
                  <a href={`mailto:${siteConfig.contactEmail}`} className="hover:underline">
                    {siteConfig.contactEmail}
                  </a>
                </li>
              )}
              {siteConfig.contactPhone && (
                <li className="font-mono text-white">
                  <a href={`tel:${siteConfig.contactPhone}`} className="hover:underline">
                    {siteConfig.contactPhone}
                  </a>
                </li>
              )}
              {siteConfig.contactTelegram && (
                <li className="text-white">{siteConfig.contactTelegram}</li>
              )}
              {!siteConfig.hasRealContacts && (
                <li className="pt-1">
                  <a
                    href="/contacts"
                    onClick={e => handleLinkClick(e, '/contacts')}
                    className="text-[#85a7ff] hover:text-white hover:underline font-semibold transition-colors"
                  >
                    Форма обратной связи →
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="pt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-neutral-400">
          <span>
            © {new Date().getFullYear()}{' '}
            {siteConfig.legalEntityName ? (
              siteConfig.legalEntityName
            ) : (
              <BrandWord className="text-sm text-white" />
            )}
            . Все права защищены.
          </span>
          <span>Учёт смен и расчёт ФОТ для складов и ПВЗ</span>
        </div>
      </div>
    </footer>
  );
};
