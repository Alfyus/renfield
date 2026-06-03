import { Link, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { LENSES, lensPath, type LensDef } from '../../pages/wissen/lenses';

/**
 * Is this lens the active one for the current path? The index lens (`/wissen`)
 * matches only its exact path; segment lenses match a `/wissen/<segment>`
 * prefix so deep state (`?focus=`, `#frist-`) keeps the lens lit.
 */
function isLensActive(lens: LensDef, pathname: string): boolean {
  const path = lensPath(lens);
  if (!lens.segment) return pathname === '/wissen' || pathname === '/wissen/';
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * Left lens sub-rail for the Wissen workspace.
 *
 * Responsive (DD1): mobile (<768) → a top `<select>` lens-picker; tablet
 * (768–1024) → slim icon-only vertical rail; desktop (≥1024) → labelled rail.
 * Visibility per lens is filtered from lens-metadata (D2) via the same
 * feature + permission gate the main nav uses.
 */
export default function LensRail() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { isFeatureEnabled, hasAnyPermission, authEnabled } = useAuth();

  const visibleLenses = LENSES.filter((lens) => {
    if (lens.feature && !isFeatureEnabled(lens.feature)) return false;
    if (!authEnabled) return true;
    if (!lens.permission) return true;
    return hasAnyPermission(lens.permission);
  });

  if (visibleLenses.length === 0) return null;

  const activeLens = visibleLenses.find((lens) => isLensActive(lens, location.pathname));

  return (
    <>
      {/* Mobile (<md): top lens-picker */}
      <div className="md:hidden mb-4">
        <label htmlFor="wissen-lens-picker" className="sr-only">
          {t('lens.pickerLabel')}
        </label>
        <select
          id="wissen-lens-picker"
          className="input min-h-11 w-full"
          value={activeLens ? lensPath(activeLens) : '/wissen'}
          onChange={(e) => navigate(e.target.value)}
        >
          {visibleLenses.map((lens) => (
            <option key={lens.key} value={lensPath(lens)}>
              {t(lens.labelKey)}
            </option>
          ))}
        </select>
      </div>

      {/* Tablet+ (md+): vertical rail. Icon-only at md, labelled at lg. */}
      <nav
        aria-label={t('lens.railLabel')}
        className="hidden md:flex md:flex-col md:gap-1 md:w-16 lg:w-56 shrink-0"
      >
        <h2 className="hidden lg:block px-3 pb-2 text-xl font-display text-gray-900 dark:text-white">
          {t('nav.wissen')}
        </h2>
        {visibleLenses.map((lens) => {
          const Icon = lens.icon;
          const active = isLensActive(lens, location.pathname);
          return (
            <Link
              key={lens.key}
              to={lensPath(lens)}
              aria-current={active ? 'page' : undefined}
              title={t(lens.labelKey)}
              className={`relative flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors min-h-11 ${
                active
                  ? 'bg-primary-600/20 text-primary-600 dark:text-primary-400'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-accent-400 rounded-r" />
              )}
              <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span className="hidden lg:inline whitespace-nowrap">{t(lens.labelKey)}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
