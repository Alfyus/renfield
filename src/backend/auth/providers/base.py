"""Shared helpers + base classes for built-in providers.

These do not extend the cross-repo contract (``provider_contract.py`` stays
byte-faithful to ebongard/renfield#591). They are Renfield-internal
conveniences so each provider is small and consistent.
"""

from __future__ import annotations

from auth.provider_contract import (
    PROVIDER_RESULT_CONTRACT_VERSION,
    ProviderResult,
)


def normalize_email(email: str | None) -> str | None:
    """Contract-locked normalization: lowercase + trim ONLY.

    No Gmail dot/plus folding. Empty/whitespace-only → None. Treat the result
    as opaque (see ProviderResult.email docstring).
    """
    if email is None:
        return None
    cleaned = email.strip().lower()
    return cleaned or None


def make_result(
    *,
    provider_id: str,
    subject: str,
    display_name: str,
    channel: str,
    email: str | None = None,
    email_verified: bool = False,
    system_projections: dict[str, str] | None = None,
    extras: dict[str, str] | None = None,
) -> ProviderResult:
    """Build a ``ProviderResult`` with ``v`` pinned to the contract version and
    the email normalized. Single construction point so every built-in provider
    stamps ``v`` and normalizes identically."""
    return ProviderResult(
        v=PROVIDER_RESULT_CONTRACT_VERSION,
        provider_id=provider_id,
        subject=subject,
        email=normalize_email(email),
        email_verified=email_verified and normalize_email(email) is not None,
        display_name=display_name,
        channel=channel,
        system_projections=dict(system_projections or {}),
        extras=dict(extras or {}),
    )


class RedirectProvider:
    """Base for federated/redirect providers (google, github, apple, …).

    Not in the credential walk: ``authenticate`` always returns ``None``. The
    OAuth/OIDC callback (Reva-side channel wiring, future) constructs the
    ``ProviderResult`` and feeds it through ``post_authenticate``. Here we only
    own the registry-facing metadata + the ``authorize_url`` entry point the
    login UI renders, so each social provider is independently testable and off
    the credential critical path.
    """

    provider_id: str = ""
    supported_channels: frozenset[str] = frozenset({"web"})
    # priority is ignored for redirect providers; kept high so an accidental
    # appearance in a sorted view never precedes a real credential provider.
    priority: int = 1000
    enabled: bool = False

    async def authenticate(
        self, *, username: str, password: str, channel: str
    ) -> ProviderResult | None:
        return None

    def authorize_url(self, channel: str) -> str | None:  # pragma: no cover -
        """Override: return the IdP authorize URL for *channel*, or None."""
        return None
