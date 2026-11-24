import React from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { WifiOff } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[90] flex items-center gap-2 rounded-md bg-[#111111] border border-[#2f63ff] px-3.5 py-2 text-xs font-semibold text-white shadow-sm">
      <WifiOff className="w-4 h-4 text-[#2f63ff]" />
      <span>Режим офлайн — используются сохранённые данные.</span>
    </div>
  );
};
