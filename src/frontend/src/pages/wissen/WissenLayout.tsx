import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { LensContextProvider } from '../../context/LensContext';
import LensRail from '../../components/wissen/LensRail';
import WissenSearchBar from '../../components/wissen/WissenSearchBar';

// Stable object identity so the provider doesn't re-render consumers each pass.
const EMBEDDED = { embedded: true } as const;

/** Skeleton shown in the CONTENT column only while a lazy lens chunk loads —
 *  the rail + search bar stay mounted above/beside it (D3). */
function LensSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      <div className="h-8 w-1/3 rounded-md bg-gray-100 dark:bg-gray-800 animate-pulse" />
      <div className="h-24 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
      <div className="h-24 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
    </div>
  );
}

/**
 * The Wissen workspace shell: persistent lens-rail + persistent omnisearch +
 * the active lens (in `<Outlet/>`). Mounts once and persists across lens
 * switches (D8: `Layout` uses a stable content-key for `/wissen/*`, so this
 * subtree reconciles instead of remounting — the rail, the search box, and the
 * Graph WebGL scene survive a lens change).
 *
 * `LensContext.embedded = true` makes each lens page drop its own page header +
 * outer max-width via `PageHeader` / `LensFrame` (D4).
 */
export default function WissenLayout() {
  return (
    <LensContextProvider value={EMBEDDED}>
      <div className="flex gap-6">
        <LensRail />
        <div className="relative flex-1 min-w-0 space-y-4">
          <WissenSearchBar />
          <Suspense fallback={<LensSkeleton />}>
            <Outlet />
          </Suspense>
        </div>
      </div>
      {/* PR3: <WissenDetailDrawer /> mounts here (driven by ?detail=). */}
    </LensContextProvider>
  );
}
