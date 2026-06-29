import { createContext, useContext } from 'react';
import type { AtomMatch } from '../api/resources/brain';

/** Opens the Wissen detail drawer for a clicked atom (search result / lens row). */
export interface WissenDrawerValue {
  openAtom: (atom: AtomMatch) => void;
}

const WissenDrawerContext = createContext<WissenDrawerValue>({ openAtom: () => {} });

export function useWissenDrawer(): WissenDrawerValue {
  return useContext(WissenDrawerContext);
}

export const WissenDrawerProvider = WissenDrawerContext.Provider;

export default WissenDrawerContext;
