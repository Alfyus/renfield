import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { UNDO_WINDOW_MS } from '../../hooks/useBestaetigt';

/**
 * Local undo toast for a just-confirmed obligation (D-FLOW-1). Deliberately
 * NOT routed through useNotifications/NotificationToast — that hook is a
 * WebSocket/server-ack queue and a client-only toast would emit bogus acks
 * (eng-review D12). This is a standalone, self-contained toast.
 *
 * `role="status"` + `aria-live="polite"` announces the confirmation; Esc-to-undo
 * is wired in useBestaetigt (window-level). The countdown bar is a visual cue
 * only — the JS timer in the hook owns dismissal.
 */
interface BestaetigtToastProps {
  onUndo: () => void;
  durationMs?: number;
}

export default function BestaetigtToast({ onUndo, durationMs = UNDO_WINDOW_MS }: BestaetigtToastProps) {
  const { t } = useTranslation();

  return (
    <div
      className="toast bottom-4 left-1/2 -translate-x-1/2 sm:left-auto sm:right-4 sm:translate-x-0"
      role="status"
      aria-live="polite"
      aria-label={t('obligations.toastConfirmedAria')}
    >
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-gray-800 dark:text-gray-100">
          {t('obligations.toastConfirmed')}
        </span>
        <button
          type="button"
          onClick={onUndo}
          className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline min-h-[44px] sm:min-h-0"
        >
          {t('obligations.rueckgaengig')}
        </button>
      </div>
      <div className="h-1 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-primary-500 animate-toast-countdown"
          style={{ '--toast-duration': `${durationMs}ms` } as CSSProperties}
        />
      </div>
    </div>
  );
}
