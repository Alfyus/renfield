/**
 * useAtomByIdQuery — backs the detail drawer's `?detail=` cold-load
 * (a deep-link opened without a clicked seed).
 */
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { server } from '../mocks/server';
import { TEST_CONFIG } from '../config';
import { createTestQueryClient } from '../test-utils';
import { useAtomByIdQuery } from '../../../../src/frontend/src/api/resources/brain';

const BASE_URL = TEST_CONFIG.API_BASE_URL;

function wrapper() {
  const qc = createTestQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useAtomByIdQuery', () => {
  it('fetches an atom by id and wraps it as an AtomMatch', async () => {
    server.use(
      http.get(`${BASE_URL}/api/atoms/mem-1`, () =>
        HttpResponse.json({ atom_id: 'mem-1', atom_type: 'conversation_memory', tier: 2, payload: { content: 'hi' } }),
      ),
    );
    const { result } = renderHook(() => useAtomByIdQuery('mem-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data?.atom.atom_id).toBe('mem-1');
    expect(result.current.data?.atom.payload?.content).toBe('hi');
  });

  it('is disabled (no fetch) when id is null', () => {
    const { result } = renderHook(() => useAtomByIdQuery(null), { wrapper: wrapper() });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('surfaces a 404 (e.g. synthetic kg id) without throwing', async () => {
    server.use(
      http.get(`${BASE_URL}/api/atoms/kg_node:9`, () => new HttpResponse(null, { status: 404 })),
    );
    const { result } = renderHook(() => useAtomByIdQuery('kg_node:9'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
