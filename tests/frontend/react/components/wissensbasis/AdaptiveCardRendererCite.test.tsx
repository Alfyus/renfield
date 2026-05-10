/**
 * Specifically covers the new <cite> tag parsing in renderFormattedText
 * and the standalone CitationChip element arm. The legacy bold/italic
 * parsing is exercised by other AdaptiveCardRenderer tests; this file
 * isolates the wissensbasis surface.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';

import AdaptiveCardRenderer from '../../../../../src/frontend/src/components/AdaptiveCardRenderer';
import { WissensbasisProvider } from '../../../../../src/frontend/src/context/WissensbasisContext';
import { renderWithRouter } from '../../test-utils';

describe('AdaptiveCardRenderer — citation chips', () => {
  it('parses inline <cite> tags inside TextBlock prose', () => {
    const card = {
      body: [
        {
          type: 'TextBlock' as const,
          text: 'Status of <cite entity="abc-123">PRODUCT-A 1.3.5</cite> is good.',
        },
      ],
    };
    renderWithRouter(
      <WissensbasisProvider>
        <AdaptiveCardRenderer card={card} />
      </WissensbasisProvider>,
    );
    expect(screen.getByRole('button', { name: /Fokus auf PRODUCT-A 1.3.5/ })).toBeInTheDocument();
    // Surrounding text is preserved
    expect(screen.getByText(/Status of/)).toBeInTheDocument();
    expect(screen.getByText(/is good\./)).toBeInTheDocument();
  });

  it('renders CitationChip element type as a standalone element', () => {
    const card = {
      body: [
        {
          type: 'CitationChip' as const,
          entity: 'PAY-901',
          label: 'PAY-901',
          entity_type: 'ticket',
        },
      ],
    };
    renderWithRouter(
      <WissensbasisProvider>
        <AdaptiveCardRenderer card={card} />
      </WissensbasisProvider>,
    );
    expect(screen.getByRole('button', { name: /Fokus auf PAY-901/ })).toBeInTheDocument();
  });

  it('marks invalid cite entity attributes as missing (server-side guard mirror)', () => {
    const card = {
      body: [
        {
          type: 'TextBlock' as const,
          // Smuggled javascript: scheme — must NOT become an interactive chip
          text: 'See <cite entity="javascript:alert(1)">click me</cite> for details.',
        },
      ],
    };
    renderWithRouter(
      <WissensbasisProvider>
        <AdaptiveCardRenderer card={card} />
      </WissensbasisProvider>,
    );
    // No interactive button — fell through to non-interactive missing chip
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('click me')).toBeInTheDocument();
  });
});
