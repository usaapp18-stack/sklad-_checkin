/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/Header';
import { UserSwitcher } from './components/UserSwitcher';
import { NotificationModal } from './components/NotificationModal';
import { RegistrationView } from './components/employee/RegistrationView';
import { EmployeeDashboard } from './components/employee/EmployeeDashboard';
import { ManagerDashboard } from './components/manager/ManagerDashboard';
import { OfflineIndicator } from './components/OfflineIndicator';
import { OrganizationOnboarding } from './components/app/OrganizationOnboarding';
import { TrialAndSubscriptionBanner } from './components/app/TrialAndSubscriptionBanner';
import { BillingModal } from './components/app/BillingModal';
import { PublicLayout } from './components/public/PublicLayout';
import { HomePage } from './pages/public/HomePage';
import { FeaturesPage } from './pages/public/FeaturesPage';
import { PricingPage } from './pages/public/PricingPage';
import { AboutPage } from './pages/public/AboutPage';
import { ContactsPage } from './pages/public/ContactsPage';
import { FaqPage } from './pages/public/FaqPage';
import { PrivacyPage } from './pages/public/PrivacyPage';
import { TermsPage } from './pages/public/TermsPage';
import { LoginPage } from './pages/public/LoginPage';
import { RegisterPage } from './pages/public/RegisterPage';
import { DemoPage } from './pages/public/DemoPage';
import { captureUtmParams } from './config/site';
import { navigate, useDocumentSeo, useRouterLocation } from './utils/router';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { Loader2 } from 'lucide-react';

const WorkspaceApp: React.FC = () => {
  const {
    authStatus,
    authSession,
    currentRole,
    billingModalOpen,
    setBillingModalOpen,
  } = useApp();

  const [isUserSwitcherOpen, setIsUserSwitcherOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isRegistrationOpen, setIsRegistrationOpen] = useState(false);

  useEffect(() => {
    if (authStatus === 'UNAUTHENTICATED' && !authSession) {
      navigate('/login', { replace: true });
    }
  }, [authStatus, authSession]);

  if (authStatus === 'LOADING') {
    return (
      <div className="min-h-screen min-h-[100dvh] bg-[#f7f9ff] flex flex-col items-center justify-center text-[#111111] gap-3 selection:bg-[#2f63ff] selection:text-white p-4">
        <Loader2 className="w-8 h-8 text-[#2f63ff] animate-spin" />
        <span className="text-xs font-mono text-[#5d6270]">Проверка сессии...</span>
        <button
          type="button"
          onClick={() => {
            if (typeof window !== 'undefined') {
              localStorage.removeItem('pvz_session_token');
              localStorage.removeItem('pvz_csrf');
              navigate('/login', { replace: true });
              window.location.reload();
            }
          }}
          className="mt-4 px-3.5 py-2 text-xs font-medium text-[#111111] hover:text-[#2f63ff] bg-white border border-[#d9dbe0] hover:border-[#2f63ff] rounded transition-colors cursor-pointer"
        >
          Перейти к окну входа
        </button>
      </div>
    );
  }

  if (!authSession) {
    return <LoginPage />;
  }

  // Manager registered without organization yet -> show onboarding inside /app
  if (authSession.role === 'manager' && !authSession.organizationId) {
    return (
      <>
        <OrganizationOnboarding />
        <OfflineIndicator />
      </>
    );
  }

  return (
    <div className="min-h-screen min-h-[100dvh] bg-[#f7f9ff] text-[#111111] flex flex-col overflow-x-hidden max-w-full selection:bg-[#2f63ff] selection:text-white">
      <Header
        onOpenNotifications={() => setIsNotificationsOpen(true)}
        onOpenUserSwitcher={() => setIsUserSwitcherOpen(true)}
        onAfterLogout={() => navigate('/', { replace: true })}
      />

      <TrialAndSubscriptionBanner />

      <main className="flex-1 pb-16">
        {currentRole === 'manager' ? <ManagerDashboard /> : <EmployeeDashboard />}
      </main>

      <UserSwitcher
        isOpen={isUserSwitcherOpen}
        onClose={() => setIsUserSwitcherOpen(false)}
        onOpenRegistration={() => setIsRegistrationOpen(true)}
      />

      <NotificationModal
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
      />

      <RegistrationView
        isOpen={isRegistrationOpen}
        onClose={() => setIsRegistrationOpen(false)}
      />

      <BillingModal
        isOpen={billingModalOpen}
        onClose={() => setBillingModalOpen(false)}
      />

      <OfflineIndicator />
    </div>
  );
};

const RootRouter: React.FC = () => {
  const { authStatus, authSession } = useApp();
  const { pathname } = useRouterLocation();

  useDocumentSeo(pathname);

  useEffect(() => {
    captureUtmParams();
  }, []);

  // Redirect already authenticated users from /login or /register straight into /app
  useEffect(() => {
    if (authStatus === 'AUTHENTICATED' && authSession && (pathname === '/login' || pathname === '/register')) {
      navigate('/app', { replace: true });
    }
  }, [authStatus, authSession, pathname]);

  if (pathname === '/app' || pathname.startsWith('/app/')) {
    return (
      <ErrorBoundary fallbackTitle="Ошибка в рабочем кабинете">
        <WorkspaceApp />
      </ErrorBoundary>
    );
  }

  if (pathname === '/demo') {
    return <DemoPage />;
  }

  if (pathname === '/login') {
    if (authStatus === 'AUTHENTICATED' && authSession) {
      return <WorkspaceApp />;
    }
    return (
      <PublicLayout currentPath="/login">
        <LoginPage />
      </PublicLayout>
    );
  }

  if (pathname === '/register') {
    if (authStatus === 'AUTHENTICATED' && authSession) {
      return <WorkspaceApp />;
    }
    return (
      <PublicLayout currentPath="/register">
        <RegisterPage />
      </PublicLayout>
    );
  }

  if (pathname === '/') {
    return <HomePage />;
  }

  const renderPublicPage = () => {
    switch (pathname) {
      case '/features':
        return <FeaturesPage />;
      case '/pricing':
        return <PricingPage />;
      case '/about':
        return <AboutPage />;
      case '/contacts':
        return <ContactsPage />;
      case '/faq':
        return <FaqPage />;
      case '/privacy':
        return <PrivacyPage />;
      case '/terms':
        return <TermsPage />;
      default:
        return (
          <div className="max-w-2xl mx-auto px-4 py-24 text-center space-y-4">
            <div className="text-xs font-mono font-bold text-[#2f63ff]">404</div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[#111111]">Страница не найдена</h1>
            <p className="text-sm text-[#5d6270]">
              Проверьте адрес страницы или перейдите на главную страницу сервиса SKLADIN.
            </p>
            <div className="pt-2 flex justify-center gap-3">
              <a
                href="/"
                onClick={e => {
                  e.preventDefault();
                  navigate('/');
                }}
                className="min-h-[44px] px-5 py-2.5 bg-[#2f63ff] hover:bg-[#1f4fe0] text-white text-xs font-semibold rounded-full inline-flex items-center transition-colors"
              >
                На главную
              </a>
              <a
                href="/app"
                onClick={e => {
                  e.preventDefault();
                  navigate('/app');
                }}
                className="min-h-[44px] px-5 py-2.5 bg-white text-[#111111] border border-[#d9dbe0] hover:border-[#2f63ff] text-xs font-semibold rounded-full inline-flex items-center transition-colors"
              >
                Вход в кабинет
              </a>
            </div>
          </div>
        );
    }
  };

  return <PublicLayout currentPath={pathname}>{renderPublicPage()}</PublicLayout>;
};

export default function App() {
  return (
    <ErrorBoundary fallbackTitle="Произошла ошибка загрузки SKLADIN">
      <AppProvider>
        <RootRouter />
      </AppProvider>
    </ErrorBoundary>
  );
}
