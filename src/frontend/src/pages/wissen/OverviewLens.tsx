import { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Inbox, BookOpen, ArrowRight } from 'lucide-react';
import ObligationRow from '../../components/ObligationRow';
import {
  useObligationsQuery,
  useAtomsForReviewQuery,
} from '../../api/resources/brain';
import { useKnowledgeStatsQuery } from '../../api/resources/knowledge';
import { useKgStatsQuery } from '../../api/resources/knowledgeGraph';
import { urgencyGroup } from '../../utils/frist';
import { useAuth } from '../../context/AuthContext';

/** ISO yyyy-mm-dd `days` from today (matches ObligationsPage). */
function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const OVERVIEW_FRIST_LIMIT = 5;

/**
 * Übersicht — the `/wissen` index. Editorial, list-led (design DD3): a serif
 * lead, the real "Nächste Fristen" + "Zu prüfen" lists (the actual content, not
 * metric tiles), and the corpus size as a quiet inline figure. Pure composition
 * of existing hooks — no new endpoints. NOT a 4-stat-card mosaic (AI-slop #2/#3).
 */
export default function OverviewLens() {
  const { t } = useTranslation();
  const { isFeatureEnabled } = useAuth();
  const now = useMemo(() => new Date(), []);
  const dueBefore = useMemo(() => isoInDays(7), []);

  // Gate the per-feature stat queries so a deployment with a feature off
  // doesn't fire a failing request from the dashboard on every load.
  const obligationsQuery = useObligationsQuery({ dueBefore, limit: 200 });
  const reviewQuery = useAtomsForReviewQuery(7);
  const kbStats = useKnowledgeStatsQuery(isFeatureEnabled('knowledge'));
  const kgStats = useKgStatsQuery(isFeatureEnabled('knowledge_graph'));

  // Soonest-first already; keep only overdue + this-week for the glance.
  const upcoming = (obligationsQuery.data ?? []).filter((f) =>
    f.obligation_date ? urgencyGroup(f.obligation_date, now) !== 'later' : false,
  );
  const reviewCount = reviewQuery.data?.length ?? 0;
  const docCount = kbStats.data?.document_count ?? 0;
  const entityCount = kgStats.data?.entity_count ?? 0;
  const relationCount = kgStats.data?.relation_count ?? 0;

  const loading =
    obligationsQuery.isLoading || reviewQuery.isLoading || kbStats.isLoading || kgStats.isLoading;
  const corpusEmpty =
    !loading && upcoming.length === 0 && reviewCount === 0 && docCount === 0 && entityCount === 0;

  if (corpusEmpty) {
    return (
      <div className="empty-state">
        <p className="text-2xl font-display text-gray-900 dark:text-white">
          {t('lens.overview.emptyTitle')}
        </p>
        <Link to="/wissen/dokumente" className="btn-primary inline-flex items-center gap-2 mt-2">
          <BookOpen className="w-4 h-4" aria-hidden="true" />
          {t('lens.overview.emptyCta')}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-display text-gray-900 dark:text-white">{t('lens.overview.title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 tabular-nums">
          {t('lens.overview.corpus', { docs: docCount, entities: entityCount, relations: relationCount })}
        </p>
      </div>

      {/* Nächste Fristen */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-primary-400" aria-hidden="true" />
            {t('lens.overview.fristen')}
          </h2>
          <Link
            to="/wissen/fristen"
            className="text-sm text-primary-600 dark:text-primary-400 inline-flex items-center gap-1 min-h-11"
          >
            {t('lens.overview.allFristen')}
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('lens.overview.noFristen')}</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700/60">
            {upcoming.slice(0, OVERVIEW_FRIST_LIMIT).map((fact) => (
              <li key={fact.id} className="py-1">
                <ObligationRow fact={fact} now={now} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Zu prüfen */}
      <section className="space-y-2">
        <h2 className="text-lg font-medium text-gray-900 dark:text-white flex items-center gap-2">
          <Inbox className="w-5 h-5 text-primary-400" aria-hidden="true" />
          {t('lens.overview.review')}
        </h2>
        {reviewCount === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('lens.overview.reviewNone')}</p>
        ) : (
          <Link
            to="/wissen/review"
            className="text-sm text-primary-600 dark:text-primary-400 inline-flex items-center gap-1 min-h-11"
          >
            {t('lens.overview.reviewCount', { count: reviewCount })}
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        )}
      </section>
    </div>
  );
}
