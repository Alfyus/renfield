import { useTranslation } from 'react-i18next';

import type { FactSource } from '../api/resources/brain';

/**
 * Provenance marker for a Schicht A fact (D-DETAIL-1/2). Color is NEVER alone —
 * glyph + aria-label + title together.
 *
 *   deterministic → ✓ (turquoise, "verlässlich")
 *   llm / other   → ~ (gray,      "Modell-vorgeschlagen")
 *
 * The "(geringes Vertrauen)" hint appears ONLY for advisory facts below the
 * confidence floor — deterministic facts are confidence=1.0 by construction.
 */
interface FactProvenanceProps {
  source: FactSource;
  confidence: number | null;
  className?: string;
}

const LOW_CONFIDENCE_FLOOR = 0.7;

export default function FactProvenance({ source, confidence, className = '' }: FactProvenanceProps) {
  const { t } = useTranslation();
  const deterministic = source === 'deterministic';
  const glyph = deterministic ? '✓' : '~';
  const label = deterministic
    ? t('circles.source.deterministic')
    : t('circles.source.advisory');
  const title = deterministic
    ? t('circles.source.deterministicTitle')
    : t('circles.source.advisoryTitle');
  const lowConfidence =
    !deterministic && confidence != null && confidence < LOW_CONFIDENCE_FLOOR;

  return (
    <span className={`inline-flex items-center gap-1 text-xs ${className}`}>
      <span
        className={`font-medium ${
          deterministic
            ? 'text-accent-700 dark:text-accent-300'
            : 'text-gray-500 dark:text-gray-400'
        }`}
        aria-label={label}
        title={title}
      >
        {glyph}
      </span>
      {lowConfidence && (
        <span className="italic text-gray-500 dark:text-gray-400">
          {t('circles.lowConfidence')}
        </span>
      )}
    </span>
  );
}
