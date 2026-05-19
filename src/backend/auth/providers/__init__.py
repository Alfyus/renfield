"""Built-in Renfield auth providers.

Credential providers (in the priority walk): ``db`` (priority 100),
``ldap`` (priority 50 — tried before DB, mirroring the pre-registry
``authenticate``-hook-before-bcrypt order).

Redirect providers (NOT in the walk; user-selected entry points):
``google``, ``github``, ``apple`` — all ``enabled=False`` by default.
"""
