"""Google OAuth2 / OIDC redirect provider. enabled=False by default.

Not in the credential walk. ``authorize_url`` is the only Renfield-side
surface: it builds the consent URL the login UI links to. The OAuth callback
(token exchange + id_token → ``ProviderResult`` + ``post_authenticate``) is
Reva-side channel wiring and out of scope for this PR — enabling this provider
without that wiring renders a button that has no callback yet, which is why it
ships off by default.
"""

from __future__ import annotations

import secrets
from urllib.parse import urlencode

from auth.providers.base import RedirectProvider
from utils.config import settings

_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth"


class GoogleProvider(RedirectProvider):
    provider_id = "google"
    supported_channels = frozenset({"web"})

    @property
    def enabled(self) -> bool:
        return settings.oauth_google_enabled

    def authorize_url(self, channel: str) -> str | None:
        if not settings.oauth_google_enabled:
            return None
        if not settings.oauth_google_client_id or not settings.oauth_google_redirect_uri:
            return None
        params = {
            "client_id": settings.oauth_google_client_id,
            "redirect_uri": settings.oauth_google_redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": secrets.token_urlsafe(24),
            "access_type": "online",
            "prompt": "select_account",
        }
        return f"{_AUTHORIZE}?{urlencode(params)}"
