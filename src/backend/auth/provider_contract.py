"""Renfield pluggable-auth provider contract, v1.

The cross-repo seam between Renfield (owns authentication) and Reva (owns
identity). The ONLY thing crossing the repo boundary is one value object
(``ProviderResult``) emitted through one hook (``post_authenticate``). Keeping
that surface tiny and versioned is what lets the two repos move on independent
release cadences.

  RENFIELD                                   REVA
  AuthProvider.authenticate()        \\
  (DB, LDAP) — credential walk        \\
                                        >--> post_authenticate(ProviderResult)
  redirect callback (Google, GitHub,  /        |
  Apple; Reva adds Entra/SAML)       /         v
                                        adapt → ProviderLookupResult
                                        → IdentityService canonical join
                                        → one renfield_user_id

Verified consumer shape (so the adapter is real, not guessed):
``reva.identity.types.ProviderLookupResult`` (src/reva/identity/types.py:108-134):
    subject: str
    display_name: str
    primary_email: str | None = None
    system_projections: dict[str, str] = {}
    extras: dict[str, str] = {}

This contract is pinned by ``ebongard/renfield#591``. Any breaking change to
``ProviderResult`` bumps ``PROVIDER_RESULT_CONTRACT_VERSION`` and is coordinated
across both repos in one push.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

# Bump on ANY breaking change to ProviderResult. Renfield and the Reva submodule
# bump together in one push. The Reva hook consumer rejects a ProviderResult
# whose `v` it does not understand (logged + counter) rather than mis-adapting it.
PROVIDER_RESULT_CONTRACT_VERSION = 1


@dataclass(frozen=True)
class ProviderResult:
    """The single value object that crosses the Renfield→Reva boundary.

    Emitted by Renfield once a provider has successfully authenticated a human,
    via the ``post_authenticate`` hook. Frozen: a provider must not mutate a
    result after returning it; the hook consumer treats it as read-only.

    Field-by-field:

    v:
        Contract version. Always set to ``PROVIDER_RESULT_CONTRACT_VERSION`` by
        the producing Renfield build. The Reva consumer compares and refuses
        unknown majors (fail-closed on contract mismatch — distinct from the
        fail-OPEN provider-down policy).

    provider_id:
        Stable provider key: ``db``, ``ldap``, ``google``, ``github``,
        ``apple`` (Renfield built-ins) or ``entra``, ``saml`` (Reva edition
        providers registered into the same registry). Lowercase, no spaces.
        Used for the per-provider projection key and audit.

    subject:
        The provider-stable, opaque, immutable user id within that provider
        (LDAP entryUUID, OIDC ``sub``/``oid``, GitHub numeric id, ...). This is
        the STRONG per-method identity key. Never an email, never a username.
        Maps to ProviderLookupResult.subject and ultimately
        canonical_users.subject for same-provider re-login.

    email:
        Normalized email or None. Normalization rule (locked): lowercase + trim
        ONLY. No Gmail dot/plus folding. Treat as opaque. None when the
        provider exposes no email (common for Teams-derived flows).

    email_verified:
        True only if the provider asserts the email is verified. The
        cross-provider email JOIN uses the email ONLY when this is True. An
        unverified or absent email never links two identities.

    display_name:
        Human-readable, display-only. Never an identity key (mutable, not
        unique). Maps to ProviderLookupResult.display_name.

    system_projections:
        Per-integration external IDs this provider can assert, as
        ``{system: external_id}``. THIS is how Teams unifies with web: the
        Entra provider emits ``{"entra": "<oid>"}`` and the Teams channel
        adapter resolves the same ``entra:<oid>`` projection — so Teams (which
        has no verified email) still joins the canonical human. Each entry
        becomes a user_projection row. Values are opaque strings.

    extras:
        Opaque provider attributes for the DOWNSTREAM AUTHZ layer only. The
        canonical identity layer never interprets these. Type is
        ``dict[str, str]`` to match the existing consumer; structured values
        (e.g. LDAP ``memberOf``, a list) MUST be serialized by the provider —
        convention: JSON-encoded string under a documented key
        (e.g. ``extras["ldap_member_of"] = '["cn=...","cn=..."]'``). The authz
        provider layer (separate, not in this delivery) deserializes.

    channel:
        Originating channel: ``web``, ``teams_chat``, ``teams_tab`` (extensible).
        The Reva channel adapter uses this to enforce the channel × provider
        compatibility matrix (e.g. reject ``github`` on ``teams_tab``).
    """

    v: int
    provider_id: str
    subject: str
    email_verified: bool
    display_name: str
    channel: str
    email: str | None = None
    system_projections: dict[str, str] = field(default_factory=dict)
    extras: dict[str, str] = field(default_factory=dict)


@runtime_checkable
class AuthProvider(Protocol):
    """What every provider plugs into the Renfield registry implements.

    Two entry styles, one output:
      * Credential providers (db, ldap): the registry calls ``authenticate``
        in a PRIORITY WALK. First non-None wins. A provider that raises/timeouts
        is SKIPPED (fail-open) — the registry logs WARNING + increments
        ``auth_provider_unreachable_total{provider_id}`` and continues the walk.
      * Federated/redirect providers (google, github, apple, entra, saml): NOT
        in the credential walk. They are user-selected entry points; their
        redirect callback constructs the ``ProviderResult`` directly.

    Either way the result reaches Reva through the single ``post_authenticate``
    hook — see the hook contract docstring below.

    Authz seam (defined, NOT implemented this delivery): a future
    authz-provider layer will consume ``ProviderResult.extras`` (e.g.
    deserialize ``extras["ldap_member_of"]``) to map provider groups → Renfield
    roles. Today's providers only carry the raw attributes in ``extras``; no
    provider performs group→role mapping. See ``ebongard/renfield#591`` and the
    approved design's "Authz seam" decision.
    """

    #: Stable lowercase key, matches ProviderResult.provider_id.
    provider_id: str

    #: Channels this provider supports, e.g. {"web"} or
    #: {"web", "teams_chat", "teams_tab"} for Entra. The registry + Reva
    #: channel adapter enforce the compatibility matrix from this.
    supported_channels: frozenset[str]

    #: Registry resolution order for credential providers (lower = earlier in
    #: the priority walk). Ignored for redirect providers.
    priority: int

    #: Default-off gate. Social providers ship enabled=False; flipping it is a
    #: config-only change (no redeploy, does not touch braid-deletion/rollback).
    enabled: bool

    async def authenticate(
        self, *, username: str, password: str, channel: str
    ) -> ProviderResult | None:
        """Credential providers only. Return a ``ProviderResult`` on success,
        ``None`` to fall through to the next provider in the walk. Raising or
        timing out is treated as provider-unreachable → skipped (fail-open).
        Redirect providers implement this as ``return None`` and produce their
        ``ProviderResult`` in their OAuth/OIDC callback instead.
        """
        ...


# ------------------------------------------------------------------------------
# post_authenticate hook contract (the cross-repo seam)
# ------------------------------------------------------------------------------
#
# Renfield fires exactly ONE hook after any provider (credential-walk winner OR
# redirect-callback) authenticates a human, BEFORE minting the JWT:
#
#     await run_hooks("post_authenticate", result=<ProviderResult>)
#
#   * Fires once per successful authentication, regardless of entry style.
#   * Reva's registered consumer adapts ProviderResult → ProviderLookupResult,
#     runs the canonical join ((provider_id,subject) → shared projection →
#     verified email), and returns the resolved renfield_user_id.
#   * The JWT `sub` (= renfield_user_id) remains the only consumed identity
#     claim (verified: auth_service.py:242, verify_route.py:76). The `username`
#     claim is cosmetic and standardized to display_name; no consumer depends
#     on it.
#   * If a consumer is registered but cannot resolve (no signal,
#     contract-version mismatch), Renfield denies the login rather than minting
#     a half-bound token.
#   * If NO consumer is registered at all (standalone Renfield, e.g. the
#     renfield repo's own test suite or a renfield-without-reva deploy),
#     Renfield falls back to legacy behavior: the JWT is minted from the
#     authenticated Renfield User row directly. This preserves pre-registry
#     behavior and is an implementation nuance — it does not alter this
#     cross-repo surface.
#
# Adapter (lives in REVA, shown here so the contract is unambiguous):
#
#     ProviderResult                  →  ProviderLookupResult
#     ------------------------------------------------------------
#     subject                         →  subject
#     display_name                    →  display_name
#     email if email_verified else _  →  primary_email
#     system_projections              →  system_projections
#                                        (+ {provider_id: subject} added so
#                                         same-provider re-login is a direct hit)
#     extras                          →  extras   (authz layer only)
#     v / channel / provider_id       →  consumed by the adapter itself
#                                        (version gate, matrix enforce, key)
