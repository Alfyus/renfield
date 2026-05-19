"""GitHub OAuth redirect provider. enabled=False by default.

See google.py for why redirect providers expose only ``authorize_url`` here;
the callback (code→token→user, then ``post_authenticate``) is Reva-side.
"""

from __future__ import annotations

import secrets
from urllib.parse import urlencode

from auth.providers.base import RedirectProvider
from utils.config import settings

_AUTHORIZE = "https://github.com/login/oauth/authorize"


class GitHubProvider(RedirectProvider):
    provider_id = "github"
    supported_channels = frozenset({"web"})

    @property
    def enabled(self) -> bool:
        return settings.oauth_github_enabled

    def authorize_url(self, channel: str) -> str | None:
        if not settings.oauth_github_enabled:
            return None
        if not settings.oauth_github_client_id or not settings.oauth_github_redirect_uri:
            return None
        params = {
            "client_id": settings.oauth_github_client_id,
            "redirect_uri": settings.oauth_github_redirect_uri,
            "scope": "read:user user:email",
            "state": secrets.token_urlsafe(24),
            "allow_signup": "false",
        }
        return f"{_AUTHORIZE}?{urlencode(params)}"
