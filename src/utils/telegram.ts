/**
 * Sends a notification to Telegram.
 * Uses the backend proxy (/api/v1/telegram/notify or /api.php?action=telegram_notify)
 * which securely uses the Telegram bot token and manager chat ID configured by the manager in their Cabinet.
 */
export const sendTelegramNotification = async (message: string): Promise<boolean> => {
  // 1. Try Express development or full-stack API endpoint
  try {
    const res = await fetch('/api/v1/telegram/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    });

    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (data && data.success) {
          return true;
        }
      }
    }
  } catch {
    // Continue to PHP fallback
  }

  // 2. Try Beget PHP production endpoint
  try {
    const phpRes = await fetch('/api.php?action=telegram_notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    });

    if (phpRes.ok) {
      const contentType = phpRes.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await phpRes.json();
        if (data && data.success) {
          return true;
        }
      }
    }
  } catch (error) {
    console.warn('[Telegram] Could not send notification via server endpoint:', error);
  }

  return false;
};


