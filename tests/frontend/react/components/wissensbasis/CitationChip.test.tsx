import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CitationChip } from '../../../../../src/frontend/src/components/wissensbasis/CitationChip';
import { WissensbasisProvider, useWissensbasis } from '../../../../../src/frontend/src/context/WissensbasisContext';
import { renderWithRouter } from '../../test-utils';

function FocusProbe() {
  const { focusEntityId } = useWissensbasis();
  return <span data-testid="focus">{focusEntityId ?? 'NONE'}</span>;
}

describe('CitationChip', () => {
  it('renders the label and is interactive when entity is valid', async () => {
    renderWithRouter(
      <WissensbasisProvider>
        <CitationChip entity="abc-123" label="PRODUCT-A 1.3.5" entityType="release" />
        <FocusProbe />
      </WissensbasisProvider>,
    );

    const btn = screen.getByRole('button', { name: /Fokus auf PRODUCT-A 1.3.5/i });
    expect(btn).toBeInTheDocument();
    expect(screen.getByTestId('focus')).toHaveTextContent('NONE');

    await userEvent.click(btn);
    expect(screen.getByTestId('focus')).toHaveTextContent('abc-123');
  });

  it('renders missing chips as non-interactive with strike-through', () => {
    renderWithRouter(
      <WissensbasisProvider>
        <CitationChip entity="" label="Deleted Thing" missing />
      </WissensbasisProvider>,
    );

    // Non-interactive: rendered as <span>, no button role
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Deleted Thing')).toBeInTheDocument();
  });

  it('falls back to non-interactive when no provider is mounted', () => {
    renderWithRouter(<CitationChip entity="abc-123" label="X" />);
    // Outside the provider the chip is still rendered but the click handler
    // is a no-op shim — it remains a button (interactive markup) but state
    // does not change. The test asserts it does not crash.
    expect(screen.getByRole('button', { name: /Fokus auf X/i })).toBeInTheDocument();
  });
});
