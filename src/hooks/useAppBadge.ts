import { useEffect } from 'react';

/**
 * Service to manage App Badging API for PWA app icon on mobile / desktop home screens.
 * Uses navigator.setAppBadge and navigator.clearAppBadge.
 */
export async function updateAppBadge(count: number): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    // 1. Check if the App Badging API is supported on navigator
    if ('setAppBadge' in navigator) {
      if (count > 0) {
        await (navigator as any).setAppBadge(count);
      } else {
        await (navigator as any).clearAppBadge();
      }
    }
  } catch (err) {
    // Silently handle devices/browsers where permission or badging is restricted
    // (e.g. user denied or site not installed)
  }

  // 2. Also attempt updating via Service Worker registration if available
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SET_BADGE',
        count: count,
      });
    }
  } catch (err) {
    // Ignore postMessage errors
  }
}

/**
 * React hook that automatically synchronizes unread notification and message counts
 * with the App Badging API on the user's home screen icon.
 */
export function useAppBadge(unreadCount: number) {
  useEffect(() => {
    updateAppBadge(unreadCount);

    // Optional: when the page is focused or visibility changes to visible,
    // re-sync to ensure the badge stays up to date
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        updateAppBadge(unreadCount);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [unreadCount]);
}
