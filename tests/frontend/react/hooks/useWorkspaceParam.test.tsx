/**
 * useWorkspaceParam — the merge-preserving guard (plan-eng-review CRITICAL #1).
 *
 * The load-bearing test: a shell write (`?q=`) must NOT clobber a lens-owned
 * param (`?focus=` / `?doc=`). A naive `setSearchParams(new URLSearchParams({q}))`
 * would wipe siblings and break the Graph lens / Fakten deep-links.
 */
import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { useWorkspaceParam } from '../../../../src/frontend/src/hooks/useWorkspaceParam';

function wrapperFor(initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );
}

describe('useWorkspaceParam', () => {
  it('REGRESSION: setting ?q= preserves an existing lens ?focus=', () => {
    const { result } = renderHook(() => useWorkspaceParam(), {
      wrapper: wrapperFor('/wissen/graph?focus=42'),
    });
    expect(result.current.read('focus')).toBe('42');

    act(() => result.current.write('q', 'rechnung'));

    expect(result.current.read('q')).toBe('rechnung');
    expect(result.current.read('focus')).toBe('42'); // not clobbered
  });

  it('clearing a key preserves the other params', () => {
    const { result } = renderHook(() => useWorkspaceParam(), {
      wrapper: wrapperFor('/wissen/dokumente?q=foo&doc=7'),
    });

    act(() => result.current.write('q', null));

    expect(result.current.read('q')).toBeNull();
    expect(result.current.read('doc')).toBe('7');
  });

  it('writing an empty string deletes the key (no empty ?q=)', () => {
    const { result } = renderHook(() => useWorkspaceParam(), {
      wrapper: wrapperFor('/wissen?q=foo'),
    });

    act(() => result.current.write('q', ''));

    expect(result.current.read('q')).toBeNull();
  });
});
