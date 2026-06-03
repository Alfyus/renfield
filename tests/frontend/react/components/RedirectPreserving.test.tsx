/**
 * RedirectPreserving — forwards BOTH ?search and #hash (plan-eng-review #2/#3).
 *
 * The legacy /wissensbasis redirect only carried `search`; inbound deep-links
 * like /brain/fristen#frist-42 and /knowledge?doc=7#fakten need the hash too,
 * or they land on the new lens without scrolling to / highlighting the target.
 */
import { describe, it, expect } from 'vitest';
import { Routes, Route, useLocation } from 'react-router';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test-utils';
import RedirectPreserving from '../../../../src/frontend/src/components/RedirectPreserving';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{`${loc.pathname}${loc.search}${loc.hash}`}</div>;
}

function renderRedirect(route: string) {
  renderWithRouter(
    <Routes>
      <Route path="/old" element={<RedirectPreserving to="/new" />} />
      <Route path="/new" element={<LocationProbe />} />
    </Routes>,
    { route },
  );
}

describe('RedirectPreserving', () => {
  it('forwards the querystring', () => {
    renderRedirect('/old?doc=7');
    expect(screen.getByTestId('loc').textContent).toBe('/new?doc=7');
  });

  it('REGRESSION: forwards the hash (deep-link scroll target survives)', () => {
    renderRedirect('/old#frist-42');
    expect(screen.getByTestId('loc').textContent).toBe('/new#frist-42');
  });

  it('forwards search AND hash together', () => {
    renderRedirect('/old?doc=7#fakten');
    expect(screen.getByTestId('loc').textContent).toBe('/new?doc=7#fakten');
  });
});
