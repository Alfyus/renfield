"""Sign in with Apple redirect provider. enabled=False by default.

See google.py for why redirect providers expose only ``authorize_url`` here.
Apple uses ``response_mode=form_post`` (scopes name/email are returned to the
callback as a POST). client_id is the Services ID; the team_id/key_id/private
key are only needed by the (Reva-side) client-secret-JWT mint at callback time.
"""

from __future__ import annotations

import secrets
from urllib.parse import urlencode

from auth.providers.base import RedirectProvider
from utils.config import settings

_AUTHORIZE = "https://appleid.apple.com/auth/authorize"


class AppleProvider(RedirectProvider):
    provider_id = "apple"
    supported_channels = frozenset({"web"})

    @property
    def enabled(self) -> bool:
        return settings.oauth_apple_enabled

    def authorize_url(self, channel: str) -> str | None:
        if not settings.oauth_apple_enabled:
            return None
        if not settings.oauth_apple_client_id or not settings.oauth_apple_redirect_uri:
            return None
        params = {
            "client_id": settings.oauth_apple_client_id,
            "redirect_uri": settings.oauth_apple_redirect_uri,
            "response_type": "code",
            "scope": "name email",
            "response_mode": "form_post",
            "state": secrets.token_urlsafe(24),
        }
        return f"{_AUTHORIZE}?{urlencode(params)}"
