import { createContext, useContext } from 'react';

export interface LensContextValue {
  /** True when a lens page renders inside the Wissen workspace shell. */
  embedded: boolean;
}

const LensContext = createContext<LensContextValue>({ embedded: false });

/**
 * Read whether the current page is embedded as a Wissen-workspace lens.
 * Default `{ embedded: false }` so pages rendered standalone (old routes /
 * feature flag off) keep their original chrome unchanged.
 */
export function useLensContext(): LensContextValue {
  return useContext(LensContext);
}

export const LensContextProvider = LensContext.Provider;

export default LensContext;
