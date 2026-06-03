import { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BookOpen, ArrowRight, ChevronRight } from 'lucide-react';
import ObligationRow from '../../components/ObligationRow';
import TierBadge from '../../components/TierBadge';
import {
  useObligationsQuery,
  useAtomsForReviewQuery,
  type AtomMatch,
  type ReviewAtom,
} from '../../api/resources/brain';
import { useKnowledgeStatsQuery } from '../../api/resources/knowledge';
import { useKgStatsQuery } from '../../api/resources/knowledgeGraph';
import { useMemoriesQuery } from '../../api/resources/memories';
import { urgencyGroup, relativeDays } from '../../utils/frist';
import { useAuth } from '../../context/AuthContext';
import { useWissenDrawer } from '../../context/WissenDrawerContext';
import { LENSES, lensPath, isLensVisible } from './lenses';

/** ISO yyyy-mm-dd `days` from today (matches ObligationsPage). */
function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const OVERVIEW_FRIST_LIMIT = 5;
const OVERVIEW_REVIEW_LIMIT = 3;

/**
 * Seed an `AtomMatch` from a review row so the detail drawer opens immediately
 * on click. The seed carries no `payload`; `WissenLayout`'s cold-fetch path
 * (`useAtomByIdQuery`) fills the full atom by id before the user reads it.
 */
function reviewToAtomMatch(atom: ReviewAtom): AtomMatch {
  return {
    atom: { atom_id: atom.atom_id, atom_type: atom.atom_type, tier: atom.tier },
    score: 0,
    snippet: atom.preview ?? atom.title ?? '',
    rank: 0,
  };
}

/**
 * Übersicht — the `/wissen` index. Editorial, list-led (design DD3): a serif
 * lead with a quiet corpus figure, the real "Nächste Fristen" + "Zu prüfen"
 * lists as actual content (clickable into the detail drawer), and a gated
 * "Bereiche" nav into the other lenses. Pure composition of existing hooks —
 * no new endpoints. NOT a stat-card mosaic (AI-slop #2/#3); the LENSES nav is a
 * quiet vertical list, never an icon-circle grid.
 */
export default function OverviewLens() {
  const { t, i18n } = useTranslation();
  const auth = useAuth();
  const { isFeatureEnabled } = auth;
  const { openAtom } = useWissenDrawer();
  const now = useMemo(() => new Date(), []);
  const dueBefore = useMemo(() => isoInDays(7), []);
  // Constructed once per language (above the early return so it isn't a
  // conditional hook); Intl.RelativeTimeFormat construction isn't free.
  const rtf = useMemo(
    () => new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' }),
    [i18n.language]
  );

  const schichtA = isFeatureEnabled('schicht_a_extraction_enabled');

  // All hooks run unconditionally (rules of hooks). The knowledge + KG stat
  // queries carry an `enabled` gate (feature off → no call); obligations,
  // review and memories are always fetched — cheap, and ungated by design,
  // same as the standalone pages.
  const obligationsQuery = useObligationsQuery({ dueBefore, limit: 200 });
  const reviewQuery = useAtomsForReviewQuery(7);
  const kbStats = useKnowledgeStatsQuery(isFeatureEnabled('knowledge'));
  const kgStats = useKgStatsQuery(isFeatureEnabled('knowledge_graph'));
  const memoriesQuery = useMemoriesQuery(null);

  // Soonest-first already; keep only overdue + this-week for the glance.
  const upcoming = (obligationsQuery.data ?? []).filter((f) =>
    f.obligation_date ? urgencyGroup(f.obligation_date, now) !== 'later' : false
  );
  const overdueCount = upcoming.filter(
    (f) => f.obligation_date && urgencyGroup(f.obligation_date, now) === 'overdue'
  ).length;
  const reviewAtoms = reviewQuery.data ?? [];
  const reviewCount = reviewAtoms.length;
  const docCount = kbStats.data?.document_count ?? 0;
  const entityCount = kgStats.data?.entity_count ?? 0;
  const relationCount = kgStats.data?.relation_count ?? 0;
  const memoryTotal = memoriesQuery.data?.total ?? 0;

  const loading =
    obligationsQuery.isLoading ||
    reviewQuery.isLoading ||
    kbStats.isLoading ||
    kgStats.isLoading ||
    memoriesQuery.isLoading;

  // Cold-start empty-state: ONLY when every source — including memories — is
  // empty. (The pre-fix gate omitted memories, so a memory-only corpus wrongly
  // showed "leer".)
  const corpusEmpty =
    !loading &&
    upcoming.length === 0 &&
    reviewCount === 0 &&
    docCount === 0 &&
    entityCount === 0 &&
    relationCount === 0 &&
    memoryTotal === 0;

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

  // Quiet corpus figures — zeros omitted so a sparse corpus reads cleanly.
  const figures = [
    docCount > 0 ? t('lens.overview.figDocs', { count: docCount }) : null,
    entityCount > 0 ? t('lens.overview.figEntities', { count: entityCount }) : null,
    relationCount > 0 ? t('lens.overview.figRelations', { count: relationCount }) : null,
    memoryTotal > 0 ? t('lens.overview.figMemories', { count: memoryTotal }) : null,
  ].filter(Boolean) as string[];

  // "Bereiche" nav: the segment lenses this user may see, same gate as the rail.
  const bereiche = LENSES.filter((lens) => lens.segment && isLensVisible(lens, auth));
  const lensSubline = (key: string): string | null => {
    switch (key) {
      case 'dokumente':
        return docCount > 0 ? t('lens.overview.figDocs', { count: docCount }) : null;
      case 'graph':
        return entityCount > 0
          ? `${t('lens.overview.figEntities', { count: entityCount })} · ${t('lens.overview.figRelations', { count: relationCount })}`
          : null;
      case 'erinnerungen':
        return memoryTotal > 0 ? t('lens.overview.figMemories', { count: memoryTotal }) : null;
      case 'pruefen':
        return reviewCount > 0 ? t('lens.overview.reviewShort', { count: reviewCount }) : null;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-display text-gray-900 dark:text-white">
          {t('lens.overview.title')}
        </h1>
        {figures.length > 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400 tabular-nums">
            {figures.join(' · ')}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Nächste Fristen — display-only rows with the tier ring (mirrors
            ObligationsPage); "Alle Fristen" is the way into the lens. */}
        {schichtA && (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-2xl font-display font-medium text-gray-900 dark:text-white">
                {t('lens.overview.fristen')}
                {overdueCount > 0 && (
                  <span className="ml-2 text-sm font-sans text-primary-700 dark:text-primary-400 tabular-nums">
                    {t('lens.overview.overdueAccent', { count: overdueCount })}
                  </span>
                )}
              </h2>
              <Link
                to="/wissen/fristen"
                className="text-sm text-primary-600 dark:text-primary-400 inline-flex items-center gap-1 shrink-0 min-h-11"
              >
                {t('lens.overview.allFristen')}
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Link>
            </div>
            {obligationsQuery.isLoading ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('common.loading')}</p>
            ) : upcoming.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('lens.overview.noFristen')}
              </p>
            ) : (
              <ul className="space-y-2">
                {upcoming.slice(0, OVERVIEW_FRIST_LIMIT).map((fact) => (
                  <li
                    key={fact.id}
                    className={`atom-row tier-ring-${fact.circle_tier} animate-fade-slide-in flex-col sm:flex-row`}
                  >
                    <ObligationRow fact={fact} now={now} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Zu prüfen — real preview rows; click opens the detail drawer. */}
        <section className="space-y-3">
          <h2 className="text-2xl font-display font-medium text-gray-900 dark:text-white">
            {t('lens.overview.review')}
          </h2>
          {reviewQuery.isLoading ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('common.loading')}</p>
          ) : reviewCount === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('lens.overview.reviewNone')}
            </p>
          ) : (
            <>
              <ul className="space-y-2">
                {reviewAtoms.slice(0, OVERVIEW_REVIEW_LIMIT).map((atom) => (
                  <li key={atom.atom_id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => openAtom(reviewToAtomMatch(atom))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openAtom(reviewToAtomMatch(atom));
                        }
                      }}
                      className={`atom-row tier-ring-${atom.tier ?? 0} animate-fade-slide-in cursor-pointer w-full text-left`}
                    >
                      <div className="flex-1 min-w-0 space-y-0.5">
                        {atom.title && (
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {atom.title}
                          </p>
                        )}
                        {atom.preview && (
                          <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
                            {atom.preview}
                          </p>
                        )}
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          {t(`circles.atomType.${atom.atom_type}`, {
                            defaultValue: atom.atom_type,
                          })}
                          {(() => {
                            // Guard: Intl.RelativeTimeFormat throws on a non-finite
                            // value, so a malformed created_at must not reach format().
                            if (!atom.created_at) return null;
                            const days = relativeDays(atom.created_at, now);
                            return Number.isFinite(days) ? ` · ${rtf.format(days, 'day')}` : null;
                          })()}
                        </p>
                      </div>
                      <TierBadge tier={atom.tier ?? 0} className="shrink-0 ml-2" />
                    </div>
                  </li>
                ))}
              </ul>
              {reviewCount > OVERVIEW_REVIEW_LIMIT && (
                <Link
                  to="/wissen/review"
                  className="text-sm text-primary-600 dark:text-primary-400 inline-flex items-center gap-1 min-h-11"
                >
                  {t('lens.overview.reviewMore', { count: reviewCount - OVERVIEW_REVIEW_LIMIT })}
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </Link>
              )}
            </>
          )}
        </section>
      </div>

      {/* Bereiche — quiet nav into the other lenses (NOT an icon-circle grid). */}
      {bereiche.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-2xl font-display font-medium text-gray-900 dark:text-white">
            {t('lens.overview.bereiche')}
          </h2>
          <ul className="space-y-2">
            {bereiche.map((lens) => {
              const Icon = lens.icon;
              const sub = lensSubline(lens.key);
              return (
                <li key={lens.key}>
                  <Link
                    to={lensPath(lens)}
                    className="atom-row min-h-11 group hover:bg-gray-50 dark:hover:bg-gray-700/40"
                  >
                    <Icon className="w-5 h-5 shrink-0 text-gray-400" aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {t(lens.labelKey)}
                      </p>
                      {sub && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                          {sub}
                        </p>
                      )}
                    </div>
                    <ChevronRight
                      className="w-4 h-4 shrink-0 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-200"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
