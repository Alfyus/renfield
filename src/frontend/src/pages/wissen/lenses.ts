import {
  LayoutDashboard,
  BookOpen,
  Share2,
  Brain,
  CalendarClock,
  Inbox,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * A lens = one view over the knowledge corpus inside the Wissen workspace.
 *
 * This is the SINGLE SOURCE OF TRUTH for the workspace (D2): the route table
 * (`App.tsx`) wraps each lens route in a `ProtectedRoute` derived from
 * `permission`, and `LensRail` filters visibility from the same `permission` +
 * `feature`. The `nav.wissen` entry shows iff at least one lens is visible.
 *
 * Distinct icons per lens deliberately resolve the old dup-`Brain` collision
 * (`/brain` + `/memory` both used Brain) — only Notizen keeps Brain now.
 */
export interface LensDef {
  /** Stable key for tests / analytics. */
  key: string;
  /** Path segment under `/wissen` (`''` = the index/Übersicht route). */
  segment: string;
  /** i18n key for the rail label. */
  labelKey: string;
  icon: LucideIcon;
  /** Any-of permissions required to see the lens (omitted = always allowed). */
  permission?: string[];
  /** Feature flag gating the lens (omitted = always on). */
  feature?: string;
}

export const LENSES: LensDef[] = [
  { key: 'uebersicht', segment: '', labelKey: 'lens.uebersicht', icon: LayoutDashboard },
  {
    key: 'dokumente',
    segment: 'dokumente',
    labelKey: 'lens.dokumente',
    icon: BookOpen,
    permission: ['kb.own', 'kb.shared', 'kb.all'],
    feature: 'knowledge',
  },
  { key: 'graph', segment: 'graph', labelKey: 'lens.graph', icon: Share2, feature: 'knowledge_graph' },
  { key: 'erinnerungen', segment: 'erinnerungen', labelKey: 'lens.erinnerungen', icon: Brain },
  { key: 'fristen', segment: 'fristen', labelKey: 'lens.fristen', icon: CalendarClock },
  { key: 'pruefen', segment: 'review', labelKey: 'lens.pruefen', icon: Inbox },
];

/** Absolute path for a lens (`/wissen` for the index, `/wissen/<segment>` else). */
export function lensPath(lens: LensDef): string {
  return lens.segment ? `/wissen/${lens.segment}` : '/wissen';
}
