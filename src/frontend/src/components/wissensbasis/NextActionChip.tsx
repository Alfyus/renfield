/**
 * NextActionChip — T19 v1 read-only blocker-resolution suggestion.
 *
 * Backend `internal.check_blocker_resolution` returns a suggestion
 * string (e.g. "Anna Müller appears available — try reaching out about
 * PAY-901."). The agent inlines that text in its answer; this component
 * renders the actionable affordance next to it.
 *
 * v1: button is visually disabled (`available` from backend is always
 * true). T19.2 ships the real "Draft message" action via Microsoft Graph.
 */

import { useTranslation } from 'react-i18next';
import { MailQuestion } from 'lucide-react';

export interface NextActionChipProps {
  blockerEntityId: string;
  blockerDisplay: string;
  suggestion: string;
  delegateDisplay?: string | null;
  available?: boolean;
}

export function NextActionChip({
  blockerDisplay,
  suggestion,
  delegateDisplay,
  available = true,
}: NextActionChipProps) {
  const { t } = useTranslation();

  return (
    <div
      role="region"
      aria-label={t('wissensbasis.nextAction.ariaLabel', 'Suggested next action')}
      className="inline-flex items-start gap-2 px-3 py-2 my-1 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm"
    >
      <MailQuestion
        className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-700 dark:text-amber-300"
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <p className="text-amber-900 dark:text-amber-100">{suggestion}</p>
        {delegateDisplay && (
          <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
            {t('wissensbasis.nextAction.delegate', 'Delegate: {{name}}', {
              name: delegateDisplay,
            })}
          </p>
        )}
        <button
          type="button"
          disabled
          className="mt-1.5 text-xs px-2 py-0.5 rounded bg-amber-200 dark:bg-amber-800/40 text-amber-900 dark:text-amber-200 cursor-not-allowed opacity-60"
          title={t(
            'wissensbasis.nextAction.draftDisabled',
            'Draft action ships in T19.2',
          )}
          aria-disabled="true"
        >
          {available
            ? t('wissensbasis.nextAction.draftButton', 'Draft message to {{name}}', {
                name: blockerDisplay,
              })
            : t('wissensbasis.nextAction.unavailableButton', '{{name}} unavailable', {
                name: blockerDisplay,
              })}
        </button>
      </div>
    </div>
  );
}
