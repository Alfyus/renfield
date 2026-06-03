import type { ReactNode } from 'react';
import { useLensContext } from '../../context/LensContext';

interface LensFrameProps {
  /**
   * Outer wrapper classes used when the page renders standalone (old routes /
   * workspace feature flag off). Defaults to the common `max-w-6xl` page frame.
   */
  standaloneClassName?: string;
  children: ReactNode;
}

/**
 * Single source of truth for a lens page's outer wrapper (DESIGN.md D4).
 *
 * - Standalone: applies the page's original max-width / padding, so flag-off
 *   behaviour is byte-identical to before the workspace.
 * - Embedded in the Wissen shell: drops the wrapper to a bare `space-y-6` so
 *   the workspace column owns the width (no nested max-widths / scroll boxes).
 *
 * PageHeader self-hides its title under the same `LensContext`, so a page only
 * needs to swap its outer `<div className="max-w-…">` for `<LensFrame>`.
 */
export default function LensFrame({
  standaloneClassName = 'max-w-6xl mx-auto p-6 space-y-6',
  children,
}: LensFrameProps) {
  const { embedded } = useLensContext();
  return <div className={embedded ? 'space-y-6' : standaloneClassName}>{children}</div>;
}
