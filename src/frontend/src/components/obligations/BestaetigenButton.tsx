import { useTranslation } from 'react-i18next';
import { Check, RotateCcw } from 'lucide-react';

/**
 * The per-obligation acknowledge control. Shows "Bestätigen" when open and
 * "Wieder öffnen" once confirmed (re-open is not destructive, so no toast).
 */
interface BestaetigenButtonProps {
  confirmed: boolean;
  onConfirm: () => void;
  onReopen: () => void;
}

export default function BestaetigenButton({ confirmed, onConfirm, onReopen }: BestaetigenButtonProps) {
  const { t } = useTranslation();

  if (confirmed) {
    return (
      <button
        type="button"
        onClick={onReopen}
        className="inline-flex items-center gap-1 px-2 py-1 min-h-[44px] sm:min-h-0 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
      >
        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
        {t('obligations.wiederOeffnen')}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onConfirm}
      className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 min-h-[44px] sm:min-h-0 text-xs font-medium"
    >
      <Check className="w-3.5 h-3.5" aria-hidden="true" />
      {t('obligations.bestaetigen')}
    </button>
  );
}
