import React, { useEffect, useState } from 'react';
import { PUBLIC_SITE_CONFIG, PublicSiteConfig } from '../../config/site';
import { PublicHeader } from './PublicHeader';
import { PublicFooter } from './PublicFooter';
import { useApp } from '../../context/AppContext';

interface PublicLayoutProps {
  currentPath: string;
  children: React.ReactNode;
}

export const PublicLayout: React.FC<PublicLayoutProps> = ({ currentPath, children }) => {
  const { authStatus, authSession } = useApp();
  const isAuthenticated = authStatus === 'AUTHENTICATED' && Boolean(authSession);
  const [siteConfig, setSiteConfig] = useState<PublicSiteConfig>(PUBLIC_SITE_CONFIG);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/public/config')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!cancelled && data?.success && data.config) {
          setSiteConfig(prev => ({
            ...prev,
            ...data.config,
          }));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen min-h-[100dvh] bg-[#ffffff] text-[#111111] flex flex-col selection:bg-[#2f63ff] selection:text-white">
      <PublicHeader currentPath={currentPath} isAuthenticated={isAuthenticated} />

      {/* Main Content */}
      <main className="flex-1">{children}</main>

      <PublicFooter siteConfig={siteConfig} isAuthenticated={isAuthenticated} />
    </div>
  );
};
