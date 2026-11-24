/**
 * Robust cross-browser clipboard copy helper.
 * Compatible with Windows, macOS, Android, iOS (iPhone/iPad),
 * Chrome, Safari, Edge, Firefox, and Yandex Browser (including iframes).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // 1. Try modern Clipboard API if supported and in secure context
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Modern API may fail in iframes or without explicit user activation permission; fall back to execCommand below
    }
  }

  // 2. Comprehensive fallback using document.execCommand('copy') with iOS Safari workarounds
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    
    // Prevent zoom and layout displacement on iOS Safari and Android
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.width = '2em';
    textarea.style.height = '2em';
    textarea.style.padding = '0';
    textarea.style.border = 'none';
    textarea.style.outline = 'none';
    textarea.style.boxShadow = 'none';
    textarea.style.background = 'transparent';
    textarea.style.opacity = '0.01';
    textarea.style.zIndex = '-9999';
    
    document.body.appendChild(textarea);

    // iOS Safari range selection workaround
    const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
      const range = document.createRange();
      range.selectNodeContents(textarea);
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
      textarea.setSelectionRange(0, 999999);
    } else {
      textarea.select();
    }

    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  } catch (err) {
    console.warn('[Clipboard] Copy fallback failed:', err);
    return false;
  }
}
