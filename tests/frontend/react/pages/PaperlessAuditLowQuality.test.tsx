/**
 * PaperlessAuditPage — the "Low OCR Quality" tab (Admin UX for low-quality OCR
 * documents). Verifies the badge renders for a flagged row and that the
 * "Ignore" action fires the mutation with the right body. German default.
 *
 * apiClient is mocked directly (mirrors ObligationsPage.test.tsx) — GETs branch
 * by URL: /status → not-running, /results → the low-quality page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import PaperlessAuditPage from '../../../../src/frontend/src/pages/PaperlessAuditPage';
import { renderWithRouter, createMockResponse } from '../test-utils';
import apiClient from '../../../../src/frontend/src/utils/axios';
import type { AuditResult } from '../../../../src/frontend/src/api/resources/paperlessAudit';

vi.mock('../../../../src/frontend/src/utils/axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn().mockResolvedValue({ data: { updated: 1 } }),
  },
  extractApiError: (_e: unknown, fallback: string) => fallback,
  extractFieldErrors: () => ({}),
}));

const mockedGet = vi.mocked(apiClient.get);
const mockedPost = vi.mocked(apiClient.post);

function lowQualityRow(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    id: 7,
    paperless_doc_id: 100,
    current_title: 'Garbled Scan',
    low_quality_ocr: true,
    chunks_dropped: 4,
    chunks_total: 10,
    quality_ignored: false,
    renfield_document_id: 5,
    ...overrides,
  };
}

function wire(rows: AuditResult[]) {
  mockedGet.mockImplementation((url: string) => {
    if (url.includes('/status')) {
      return Promise.resolve(createMockResponse({ running: false }));
    }
    if (url.includes('/results')) {
      return Promise.resolve(createMockResponse({ results: rows, total: rows.length }));
    }
    return Promise.resolve(createMockResponse({}));
  });
}

async function openLowQualityTab() {
  renderWithRouter(<PaperlessAuditPage />, { route: '/paperless-audit' });
  // The tab label comes from i18n: paperlessAudit.tabs.lowquality.
  const tab = await screen.findByRole('tab', { name: /Niedrige OCR-Qualität/ });
  fireEvent.click(tab);
}

describe('PaperlessAuditPage — Low OCR Quality tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGet.mockReset();
    mockedPost.mockClear();
  });

  it('renders the drop-percentage badge for a flagged row', async () => {
    wire([lowQualityRow()]);
    await openLowQualityTab();

    expect(await screen.findByText('Garbled Scan')).toBeInTheDocument();
    // 4 / 10 = 40% → "40 % verworfen"
    expect(screen.getByText(/40 % verworfen/)).toBeInTheDocument();
  });

  it('renders the failed-OCR badge when no chunk counts are present', async () => {
    wire([lowQualityRow({ chunks_dropped: null, chunks_total: null })]);
    await openLowQualityTab();

    expect(await screen.findByText('Garbled Scan')).toBeInTheDocument();
    expect(screen.getByText(/OCR fehlgeschlagen/)).toBeInTheDocument();
  });

  it('fires the quality-ignore mutation with the right body when "Ignorieren" is clicked', async () => {
    wire([lowQualityRow()]);
    await openLowQualityTab();

    const ignoreBtn = await screen.findByRole('button', { name: /Ignorieren/ });
    fireEvent.click(ignoreBtn);

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledWith(
        '/api/admin/paperless-audit/quality-ignore',
        { result_ids: [7], ignored: true },
      );
    });
  });

  it('shows the "ignoriert" marker and offers un-ignore on an already-ignored row', async () => {
    wire([lowQualityRow({ quality_ignored: true })]);
    await openLowQualityTab();

    expect(await screen.findByText('ignoriert')).toBeInTheDocument();
    const unignoreBtn = screen.getByRole('button', { name: /Wieder berücksichtigen/ });
    fireEvent.click(unignoreBtn);

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledWith(
        '/api/admin/paperless-audit/quality-ignore',
        { result_ids: [7], ignored: false },
      );
    });
  });
});
