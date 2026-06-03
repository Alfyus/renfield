import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

/**
 * Merge-preserving access to the Wissen workspace URL params (`?q=`, `?detail=`).
 *
 * The workspace shell and the embedded lenses BOTH write to the same query
 * string — the Graph lens owns `?focus=`, KnowledgePage owns `?doc=`. A naive
 * `setSearchParams(new URLSearchParams({q}))` would wipe those sibling params.
 * Every write here clones the previous params and mutates a single key, so a
 * shell write can never clobber a lens param (and vice-versa, as long as the
 * lenses use the same functional-updater form — see GraphView).
 */
export function useWorkspaceParam() {
  const [searchParams, setSearchParams] = useSearchParams();

  const read = useCallback(
    (key: string): string | null => searchParams.get(key),
    [searchParams],
  );

  const write = useCallback(
    (key: string, value: string | null, opts?: { replace?: boolean }) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === null || value === '') {
            next.delete(key);
          } else {
            next.set(key, value);
          }
          return next;
        },
        { replace: opts?.replace ?? false },
      );
    },
    [setSearchParams],
  );

  return { read, write, searchParams };
}

export default useWorkspaceParam;
