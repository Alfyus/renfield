import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';

interface AreaCardProps {
  /** Card title (e.g. "Dokumente"). */
  title: string;
  /** Quiet count subline under the title (e.g. "20 Dokumente"). */
  count?: string | null;
  /** Optional emphasis next to the title (e.g. "2 überfällig"). */
  accent?: string | null;
  /** Lens route the top-right link opens. */
  to: string;
  /** Body: the area's preview rows (or its loading / empty state). */
  children: ReactNode;
}

/**
 * Uniform dashboard card for one Wissen area. Every area renders through this so
 * the structure is identical: title + count on the left, a single "Öffnen →"
 * link top-right (consistent position across all cards), then a preview body.
 */
export default function AreaCard({ title, count, accent, to, children }: AreaCardProps) {
  const { t } = useTranslation();
  return (
    <section className="card flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white">
            {title}
            {accent && (
              <span className="ml-2 text-sm font-normal text-primary-700 dark:text-primary-400 tabular-nums">
                {accent}
              </span>
            )}
          </h2>
          {count && (
            <p className="text-sm text-gray-500 dark:text-gray-400 tabular-nums">{count}</p>
          )}
        </div>
        <Link
          to={to}
          className="text-sm text-primary-600 dark:text-primary-400 inline-flex items-center gap-1 shrink-0 min-h-11"
        >
          {t('lens.overview.open')}
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      </div>
      {children}
    </section>
  );
}
