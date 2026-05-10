/**
 * FocusNeighborhood (A4 panel) — focused entity + 1-hop + 2-hop neighbors.
 * Source: GET /api/wissensbasis/focus.
 *
 * Layout: focus card on top, hop1 chips beneath grouped by entity_type,
 * hop2 chips below in a faded section. Importance scores drive ordering
 * (already sorted server-side) and chip halo size.
 *
 * Overflow: when overflow_hop1/hop2 > 0, render "+N more" chip that
 * navigates to /wissensbasis?focus=<entity_id> for the deep-browse view.
 *
 * Empty state: friendly placeholder when no focus is set + CTA to click
 * a citation chip in the answer.
 */

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Eye, MoreHorizontal } from 'lucide-react';

import { CitationChip } from './CitationChip';
import type { FocusEntity, FocusNeighborhood as FocusNeighborhoodData } from '../../api/resources/wissensbasis';

export interface FocusNeighborhoodProps {
  data: FocusNeighborhoodData | null;
  isLoading?: boolean;
  errorMessage?: string | null;
}

export function FocusNeighborhood({ data, isLoading, errorMessage }: FocusNeighborhoodProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return <NeighborhoodSkeleton />;
  }

  if (errorMessage) {
    return (
      <div
        role="alert"
        className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 rounded px-3 py-2"
      >
        {errorMessage}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-xs text-gray-500 dark:text-gray-400 italic px-3 py-4 text-center">
        <Eye className="h-4 w-4 inline-block mr-1" aria-hidden="true" />
        {t(
          'wissensbasis.focus.empty',
          'Click a citation chip in the answer to focus an entity here.',
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 px-3 py-2">
      <FocusCard focus={data.focus} />
      <NeighborSection
        title={t('wissensbasis.focus.directNeighbors', 'Direct neighbors')}
        entities={data.hop1}
        overflow={data.overflow_hop1}
        focusEntity={data.focus.entity_id}
      />
      {data.hop2.length > 0 && (
        <NeighborSection
          title={t('wissensbasis.focus.indirectNeighbors', 'Two hops away')}
          entities={data.hop2}
          overflow={data.overflow_hop2}
          focusEntity={data.focus.entity_id}
          faded
        />
      )}
    </div>
  );
}

function NeighborhoodSkeleton() {
  return (
    <div className="space-y-2 px-3 py-3">
      <div className="h-6 w-1/2 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
      <div className="h-3 w-3/4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
      <div className="flex flex-wrap gap-1.5 mt-2">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="h-5 w-16 rounded bg-gray-200 dark:bg-gray-700 animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}

function FocusCard({ focus }: { focus: FocusEntity }) {
  const { t } = useTranslation();
  const importancePct = Math.round(focus.importance * 100);
  return (
    <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-3 py-2">
      <p className="font-semibold text-sm text-blue-900 dark:text-blue-100 break-words">
        {focus.display_name}
      </p>
      <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
        {focus.entity_type}
        {importancePct > 0 && (
          <>
            <span className="mx-1.5 opacity-50">·</span>
            <span title={t('wissensbasis.focus.importanceTooltip', 'Connectivity score')}>
              {t('wissensbasis.focus.importance', 'importance {{pct}}%', { pct: importancePct })}
            </span>
          </>
        )}
      </p>
    </div>
  );
}

interface NeighborSectionProps {
  title: string;
  entities: FocusEntity[];
  overflow: number;
  focusEntity: string;
  faded?: boolean;
}

function NeighborSection({ title, entities, overflow, focusEntity, faded }: NeighborSectionProps) {
  const { t } = useTranslation();
  if (entities.length === 0 && overflow === 0) return null;

  return (
    <div className={faded ? 'opacity-75' : ''}>
      <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
        {title}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {entities.map((e) => (
          <CitationChip
            key={e.entity_id}
            entity={e.entity_id}
            label={e.display_name}
            entityType={e.entity_type}
          />
        ))}
        {overflow > 0 && (
          <Link
            to={`/wissensbasis?focus=${encodeURIComponent(focusEntity)}`}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium
              bg-gray-100 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300
              hover:bg-gray-200 dark:hover:bg-gray-700"
            title={t('wissensbasis.focus.overflowTooltip', 'Open the standalone view to browse all neighbors')}
          >
            <MoreHorizontal className="h-3 w-3" aria-hidden="true" />
            {t('wissensbasis.focus.overflow', '+{{count}} more', { count: overflow })}
          </Link>
        )}
      </div>
    </div>
  );
}
