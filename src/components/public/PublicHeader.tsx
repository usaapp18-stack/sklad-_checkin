import React, { useEffect, useState } from 'react';
import { BrandLogo, BrandWord } from '../common/BrandLogo';
import { navigate } from '../../utils/router';
import { trackAnalyticsEvent } from '../../config/site';
import { Menu, X } from 'lucide-react';

interface PublicHeaderProps {
  currentPath?: string;
  isAuthenticated?: boolean;
  onScrollTop?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}

const NAV_ITEMS = [
  { label: 'О СЕРВИСЕ', href: '/#about', isAnchor: true, anchorId: 'about' },
  { label: 'МОДУЛИ', href: '/#services', isAnchor: true, anchorId: 'services' },
  { label: 'ВОЗМОЖНОСТИ', href: '/features', isAnchor: false },
  { label: 'ТАРИФЫ', href: '/pricing', isAnchor: false },
  { label: 'ДЕМО', href: '/demo', isAnchor: false },
  { label: 'FAQ', href: '/faq', isAnchor: false },
  { label: 'КОНТАКТЫ', href: '/contacts', isAnchor: false },
];

export const PublicHeader: React.FC<PublicHeaderProps> = ({
  currentPath = '/',
  isAuthenticated = false,
  onScrollTop,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [currentPath]);

  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, item: (typeof NAV_ITEMS)[0]) => {
    e.preventDefault();
    setMobileMenuOpen(false);

    if (item.isAnchor && item.anchorId) {
      if (currentPath === '/') {
        const el = document.getElementById(item.anchorId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth' });
          return;
        }
      }
      navigate('/');
      window.setTimeout(() => {
        document.getElementById(item.anchorId!)?.scrollIntoView({ behavior: 'smooth' });
      }, 120);
      return;
    }

    navigate(item.href);
  };

  const handleAuthClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setMobileMenuOpen(false);
    navigate(isAuthenticated ? '/app' : '/login');
  };

  const handleRegisterClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setMobileMenuOpen(false);
    trackAnalyticsEvent('trial_cta_click', { placement: 'header', path: currentPath });
    navigate('/register');
  };

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-b border-[#d9dbe0] shadow-2xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4 sm:gap-6">
          {/* Brand Logo + SKLADIN wordmark (matching ЛК Header font) */}
          <a
            href="/"
            onClick={e => {
              setMobileMenuOpen(false);
              if (onScrollTop && currentPath === '/') {
                onScrollTop(e);
              } else {
                e.preventDefault();
                navigate('/');
              }
            }}
            className="inline-flex items-center gap-2.5 group shrink-0 whitespace-nowrap"
            aria-label="SKLADIN — Главная"
          >
            <BrandLogo className="w-7 h-7 shrink-0" />
            <BrandWord className="text-xl text-[#111111] leading-none" />
          </a>

          {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center gap-6 text-xs font-bold tracking-wider text-[#0c2766]" aria-label="Основная навигация">
            {NAV_ITEMS.map(item => {
              const active = !item.isAnchor && currentPath === item.href;
              return (
                <a
                  key={item.label}
                  href={item.href}
                  onClick={e => handleLinkClick(e, item)}
                  className={`hover:text-[#2f63ff] transition-colors py-1 whitespace-nowrap shrink-0 ${
                    active ? 'text-[#2f63ff] border-b-2 border-[#2f63ff]' : 'border-b-2 border-transparent'
                  }`}
                >
                  {item.label}
                </a>
              );
            })}
          </nav>

          {/* Right Actions */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <a
              href={isAuthenticated ? '/app' : '/login'}
              onClick={handleAuthClick}
              className={`hidden sm:inline-flex items-center text-xs font-bold px-3 py-2 transition-colors whitespace-nowrap ${
                currentPath === '/login'
                  ? 'text-[#2f63ff]'
                  : 'text-[#0c2766] hover:text-[#2f63ff]'
              }`}
            >
              {isAuthenticated ? 'КАБИНЕТ' : 'ВОЙТИ'}
            </a>
            <a
              href="/register"
              onClick={handleRegisterClick}
              className="inline-flex items-center justify-center min-h-[38px] text-xs font-bold bg-[#2f63ff] hover:bg-[#1f4fe0] text-white px-4 py-2 rounded-full shadow-sm transition-colors whitespace-nowrap"
            >
              7 ДНЕЙ БЕСПЛАТНО
            </a>

            {/* Mobile menu toggle */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(v => !v)}
              className="lg:hidden min-w-[40px] min-h-[40px] flex items-center justify-center text-[#111111] border border-[#d9dbe0] rounded-md bg-[#f7f9ff]"
              aria-label={mobileMenuOpen ? 'Закрыть меню' : 'Открыть меню'}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden bg-white border-t border-[#d9dbe0] shadow-xl px-4 py-5 space-y-4">
            <nav className="flex flex-col space-y-1 text-xs font-bold tracking-wider text-[#0c2766]" aria-label="Мобильная навигация">
              {NAV_ITEMS.map(item => (
                <a
                  key={item.label}
                  href={item.href}
                  onClick={e => handleLinkClick(e, item)}
                  className={`min-h-[44px] px-3 flex items-center rounded-lg transition-colors ${
                    !item.isAnchor && currentPath === item.href
                      ? 'bg-[#eef2ff] text-[#2f63ff]'
                      : 'hover:bg-[#f0f5ff] hover:text-[#2f63ff]'
                  }`}
                >
                  {item.label}
                </a>
              ))}
            </nav>
            <div className="pt-3 border-t border-[#e2e8f8] flex flex-col gap-2.5">
              <a
                href={isAuthenticated ? '/app' : '/login'}
                onClick={handleAuthClick}
                className="w-full min-h-[44px] flex items-center justify-center text-xs font-bold text-[#0c2766] border border-[#d9dbe0] rounded-full hover:bg-[#f0f5ff] transition-colors"
              >
                {isAuthenticated ? 'ЛИЧНЫЙ КАБИНЕТ' : 'ВОЙТИ В СИСТЕМУ'}
              </a>
              <a
                href="/register"
                onClick={handleRegisterClick}
                className="w-full min-h-[44px] flex items-center justify-center text-xs font-bold bg-[#2f63ff] text-white rounded-full hover:bg-[#1f4fe0] transition-colors"
              >
                7 ДНЕЙ БЕСПЛАТНО
              </a>
            </div>
          </div>
        )}
      </header>
      <div className="h-16 shrink-0" aria-hidden="true" />
    </>
  );
};
