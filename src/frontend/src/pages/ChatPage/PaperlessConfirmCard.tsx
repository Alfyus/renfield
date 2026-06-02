import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Check, X } from 'lucide-react';
import type {
  PaperlessConfirmField,
  PaperlessConfirmOption,
} from './hooks/useChatWebSocket';

interface PaperlessConfirmCardProps {
  confirmToken: string;
  filename?: string | null;
  summary: Record<string, unknown>;
  fields: PaperlessConfirmField[];
  status: 'open' | 'submitted';
  onSubmit: (
    confirmToken: string,
    decisions: { idx: number; action: string; value: string | null }[],
  ) => void;
  onAbort: (confirmToken: string) => void;
}

// Stable key for an option within a field's radio group.
function optionKey(opt: PaperlessConfirmOption): string {
  return `${opt.action}:${opt.value ?? ''}`;
}

function displaySummaryValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.map(String).join(', ') : '—';
  return String(value);
}

/**
 * Interactive Paperless cold-start confirm card. Replaces the typed
 * "1:n, 2:x" mini-syntax with a per-field clickable picker: each ambiguous
 * field shows its detected value plus options (use an existing match / create
 * new / leave empty), defaults pre-selected. Submitting sends a structured
 * decision over the WS — no free-text parsing.
 */
export default function PaperlessConfirmCard({
  confirmToken,
  filename,
  summary,
  fields,
  status,
  onSubmit,
  onAbort,
}: PaperlessConfirmCardProps) {
  const { t } = useTranslation();
  const readOnly = status === 'submitted';

  // Per-field selection, seeded from each field's backend default. For a
  // "create" default we also seed the editable value with the extracted text.
  const [selections, setSelections] = useState<
    Record<number, { action: string; value: string | null }>
  >(() => {
    const init: Record<number, { action: string; value: string | null }> = {};
    for (const f of fields) {
      const def = f.default;
      init[f.idx] = {
        action: def.action,
        value: def.action === 'create' ? f.extracted_value : def.value,
      };
    }
    return init;
  });

  // Editable "create" text, tracked per field separately from the selection so
  // it survives toggling to another option and back (the selection's `value`
  // gets overwritten by use/skip choices).
  const [createDrafts, setCreateDrafts] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    for (const f of fields) init[f.idx] = f.extracted_value ?? '';
    return init;
  });

  const summaryRows = useMemo(
    () =>
      (['title', 'correspondent', 'document_type', 'tags', 'storage_path', 'created_date'] as const)
        .map((key) => ({ key, value: summary[key] })),
    [summary],
  );

  const pickOption = (idx: number, opt: PaperlessConfirmOption): void => {
    if (readOnly) return;
    setSelections((prev) => ({
      ...prev,
      [idx]: {
        action: opt.action,
        // "create" pulls from the persisted draft; others take the option's.
        value: opt.action === 'create' ? (createDrafts[idx] ?? '') : opt.value,
      },
    }));
  };

  const editCreateValue = (idx: number, value: string): void => {
    if (readOnly) return;
    setCreateDrafts((prev) => ({ ...prev, [idx]: value }));
    setSelections((prev) => ({ ...prev, [idx]: { action: 'create', value } }));
  };

  const handleSubmit = (): void => {
    if (readOnly) return;
    const decisions = fields.map((f) => {
      const action = selections[f.idx]?.action ?? 'skip';
      const value =
        action === 'create'
          ? (createDrafts[f.idx] ?? f.extracted_value ?? '')
          : (selections[f.idx]?.value ?? null);
      return { idx: f.idx, action, value };
    });
    onSubmit(confirmToken, decisions);
  };

  return (
    <div className="mt-2 card border border-gray-200 dark:border-gray-700 p-3 text-sm">
      <div className="flex items-center gap-2 mb-2 font-medium text-gray-900 dark:text-gray-100">
        <FileText className="w-4 h-4 flex-shrink-0 text-primary-600 dark:text-primary-400" aria-hidden="true" />
        <span className="truncate">{filename || t('chat.paperlessConfirm.title')}</span>
      </div>

      {/* Resolved metadata (read-only preview) */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 mb-3 text-gray-600 dark:text-gray-300">
        {summaryRows.map(({ key, value }) => (
          <div key={key} className="contents">
            <dt className="text-gray-400 dark:text-gray-500">
              {t(`chat.paperlessConfirm.summaryFields.${key}`)}
            </dt>
            <dd className="truncate">{displaySummaryValue(value)}</dd>
          </div>
        ))}
      </dl>

      {/* Per-field decisions */}
      {fields.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
            {t('chat.paperlessConfirm.decisionsHeading')}
          </p>
          {fields.map((f) => {
            const sel = selections[f.idx];
            return (
              <fieldset key={f.idx} className="border border-gray-100 dark:border-gray-700 rounded-md p-2">
                <legend className="px-1 text-gray-700 dark:text-gray-200">
                  {f.label}
                  {f.extracted_value ? (
                    <span className="text-gray-400 dark:text-gray-500"> · „{f.extracted_value}“</span>
                  ) : null}
                </legend>
                <div className="space-y-1 mt-1">
                  {f.options.map((opt) => {
                    // "create" matches on action alone (its value is the
                    // editable draft); use/skip match on action + value so two
                    // same-action options can't both highlight.
                    const selected = opt.action === 'create'
                      ? sel?.action === 'create'
                      : sel?.action === opt.action && (sel?.value ?? null) === (opt.value ?? null);
                    return (
                      <label
                        key={optionKey(opt)}
                        className={`flex items-center gap-2 px-2 py-2 min-h-[2.75rem] rounded cursor-pointer ${
                          selected
                            ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                        } ${readOnly ? 'cursor-default opacity-80' : ''}`}
                      >
                        <input
                          type="radio"
                          name={`pl-confirm-${confirmToken}-${f.idx}`}
                          checked={!!selected}
                          disabled={readOnly}
                          onChange={() => pickOption(f.idx, opt)}
                          className="accent-primary-600"
                        />
                        <span>{opt.label}</span>
                      </label>
                    );
                  })}
                  {/* Editable value when "create" is selected (fix OCR typos). */}
                  {sel?.action === 'create' && (
                    <input
                      type="text"
                      value={createDrafts[f.idx] ?? ''}
                      disabled={readOnly}
                      onChange={(e) => editCreateValue(f.idx, e.target.value)}
                      aria-label={t('chat.paperlessConfirm.createValueLabel')}
                      className="input mt-1 w-full text-sm"
                    />
                  )}
                </div>
              </fieldset>
            );
          })}
        </div>
      )}

      {readOnly ? (
        <p className="mt-3 text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
          <Check className="w-3 h-3" aria-hidden="true" />
          {t('chat.paperlessConfirm.submitted')}
        </p>
      ) : (
        <div className="mt-3 flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => onAbort(confirmToken)}
            className="btn-secondary inline-flex items-center gap-1 text-sm min-h-[2.75rem]"
          >
            <X className="w-4 h-4" aria-hidden="true" />
            {t('chat.paperlessConfirm.abort')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="btn-primary inline-flex items-center gap-1 text-sm min-h-[2.75rem]"
          >
            <Check className="w-4 h-4" aria-hidden="true" />
            {t('chat.paperlessConfirm.confirm')}
          </button>
        </div>
      )}
    </div>
  );
}
