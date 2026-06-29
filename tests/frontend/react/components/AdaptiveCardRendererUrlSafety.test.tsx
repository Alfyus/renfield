/**
 * Security review M3 — AdaptiveCard Action.OpenUrl / Image must not render a
 * live href/src for a non-http(s) scheme (javascript:/data:). React does not
 * sanitize URL schemes, so the renderer is the trust boundary for card data
 * that can originate from a federated/Reva backend.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';

import AdaptiveCardRenderer from '../../../../src/frontend/src/components/AdaptiveCardRenderer';
import { renderWithRouter } from '../test-utils';

describe('AdaptiveCardRenderer — URL scheme safety (M3)', () => {
  it('renders an https Action.OpenUrl as a real link', () => {
    const card = {
      body: [],
      actions: [
        { type: 'Action.OpenUrl' as const, title: 'Open', url: 'https://example.com/x' },
      ],
    };
    renderWithRouter(<AdaptiveCardRenderer card={card} />);
    const link = screen.getByRole('link', { name: /Open/ });
    expect(link).toHaveAttribute('href', 'https://example.com/x');
  });

  it('does NOT render a javascript: Action.OpenUrl as a link', () => {
    const card = {
      body: [],
      actions: [
        { type: 'Action.OpenUrl' as const, title: 'Evil', url: 'javascript:alert(document.cookie)' },
      ],
    };
    renderWithRouter(<AdaptiveCardRenderer card={card} />);
    // The title still shows (inert text), but never as a link/href.
    expect(screen.queryByRole('link', { name: /Evil/ })).toBeNull();
    expect(screen.getByText('Evil')).toBeInTheDocument();
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it('drops an Image with a javascript:/data: src', () => {
    const card = {
      body: [
        { type: 'Image' as const, url: 'javascript:alert(1)', altText: 'x' },
        { type: 'Image' as const, url: 'data:text/html,<script>1</script>', altText: 'y' },
      ],
    };
    const { container } = renderWithRouter(<AdaptiveCardRenderer card={card} />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders an https Image src', () => {
    const card = {
      body: [{ type: 'Image' as const, url: 'https://example.com/a.png', altText: 'ok' }],
    };
    const { container } = renderWithRouter(<AdaptiveCardRenderer card={card} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'https://example.com/a.png');
  });
});
