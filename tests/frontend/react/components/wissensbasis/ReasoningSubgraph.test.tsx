import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';

import { ReasoningSubgraph } from '../../../../../src/frontend/src/components/wissensbasis/ReasoningSubgraph';
import { WissensbasisProvider } from '../../../../../src/frontend/src/context/WissensbasisContext';
import { renderWithRouter } from '../../test-utils';

describe('ReasoningSubgraph', () => {
  it('renders empty placeholder when trace has no entities', () => {
    renderWithRouter(
      <WissensbasisProvider>
        <ReasoningSubgraph trace={{ entities: [], edges: [] }} />
      </WissensbasisProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/Keine Argumentationsschritte/);
  });

  it('renders inline list when entities <= threshold', () => {
    renderWithRouter(
      <WissensbasisProvider>
        <ReasoningSubgraph
          trace={{
            entities: [
              { entity_id: 'r1', display_name: 'PRODUCT-A 1.3.5', entity_type: 'release' },
              { entity_id: 'PAY-901', display_name: 'PAY-901', entity_type: 'ticket' },
            ],
            edges: [
              { from_entity: 'r1', to_entity: 'PAY-901', relation: 'depends_on', weight: 1 },
            ],
          }}
        />
      </WissensbasisProvider>,
    );

    // Both entities render as CitationChip buttons
    expect(screen.getByRole('button', { name: /Fokus auf PRODUCT-A 1.3.5/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fokus auf PAY-901/ })).toBeInTheDocument();
  });

  it('shows loading skeleton when isLoading=true', () => {
    renderWithRouter(
      <WissensbasisProvider>
        <ReasoningSubgraph
          trace={{ entities: [], edges: [] }}
          isLoading
        />
      </WissensbasisProvider>,
    );
    // Skeleton has the loading aria-label
    expect(screen.getByLabelText(/Lädt/)).toBeInTheDocument();
  });
});
