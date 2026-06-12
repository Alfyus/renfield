"""
Tests for SecurityHeadersMiddleware — focused on the /api no-store policy.

The middleware runs on every response (including 404s for unmatched routes),
so we probe arbitrary paths without depending on a specific endpoint or auth.
"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
@pytest.mark.unit
async def test_api_responses_are_no_store(async_client: AsyncClient):
    """Any /api response carries Cache-Control: no-store.

    Regression: a transient HTML/SPA fallback served for an /api path during a
    backend rollout was HTTP-cached and replayed as a non-JSON body, crashing
    the presence page. no-store stops the browser caching /api responses.
    """
    resp = await async_client.get("/api/__cache_probe__")
    assert resp.headers.get("cache-control") == "no-store"


@pytest.mark.asyncio
@pytest.mark.unit
async def test_non_api_responses_not_forced_no_store(async_client: AsyncClient):
    """Non-/api paths are not force-no-store (static assets stay cacheable)."""
    resp = await async_client.get("/__not_an_api_path__")
    assert resp.headers.get("cache-control") != "no-store"
