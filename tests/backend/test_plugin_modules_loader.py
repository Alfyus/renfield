"""Unit tests for the multi-plugin startup loader (``api.lifecycle._load_plugin_module``).

Renfield supports a single startup plugin via ``PLUGIN_MODULE`` and a
comma-separated list via ``PLUGIN_MODULES``. The loader must invoke each
configured ``module:callable`` exactly once, dedupe entries that appear in
both settings, and swallow a failing plugin so it never crashes startup.

The import mechanism is monkeypatched so the test is hermetic — no real
plugin modules are needed.
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from api import lifecycle

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


@pytest.fixture
def fake_modules(monkeypatch):
    """Patch ``importlib.import_module`` to resolve named fake modules.

    Returns a dict ``{module_path: SimpleNamespace}`` whose attributes are the
    callables the loader will invoke. Tests register callables onto these.
    """
    registry: dict[str, SimpleNamespace] = {}

    def fake_import(module_path: str):
        if module_path not in registry:
            raise ImportError(f"no fake module {module_path}")
        return registry[module_path]

    import importlib

    monkeypatch.setattr(importlib, "import_module", fake_import)
    return registry


def _set_settings(monkeypatch, *, plugin_module: str = "", plugin_modules: str = ""):
    monkeypatch.setattr(
        lifecycle.settings, "plugin_module", plugin_module, raising=False
    )
    monkeypatch.setattr(
        lifecycle.settings, "plugin_modules", plugin_modules, raising=False
    )


async def test_plugin_modules_invokes_each_once(fake_modules, monkeypatch):
    reg1, reg2 = MagicMock(), MagicMock()
    fake_modules["a.b"] = SimpleNamespace(reg1=reg1)
    fake_modules["c.d"] = SimpleNamespace(reg2=reg2)

    _set_settings(monkeypatch, plugin_modules="a.b:reg1,c.d:reg2")

    await lifecycle._load_plugin_module()

    reg1.assert_called_once_with()
    reg2.assert_called_once_with()


async def test_plugin_module_singular_still_works(fake_modules, monkeypatch):
    register = MagicMock()
    fake_modules["only.one"] = SimpleNamespace(register=register)

    _set_settings(monkeypatch, plugin_module="only.one:register")

    await lifecycle._load_plugin_module()

    register.assert_called_once_with()


async def test_both_set_dedupes(fake_modules, monkeypatch):
    shared = MagicMock()
    extra = MagicMock()
    fake_modules["dup.mod"] = SimpleNamespace(reg=shared)
    fake_modules["other.mod"] = SimpleNamespace(init=extra)

    # Same spec in both singular and the list — must run once.
    _set_settings(
        monkeypatch,
        plugin_module="dup.mod:reg",
        plugin_modules="dup.mod:reg,other.mod:init",
    )

    await lifecycle._load_plugin_module()

    shared.assert_called_once_with()
    extra.assert_called_once_with()


async def test_failing_plugin_does_not_crash_and_others_load(fake_modules, monkeypatch):
    good = MagicMock()
    boom = MagicMock(side_effect=RuntimeError("kaboom"))
    fake_modules["good.mod"] = SimpleNamespace(reg=good)
    fake_modules["bad.mod"] = SimpleNamespace(reg=boom)
    # "missing.mod" is intentionally NOT registered → ImportError.

    _set_settings(
        monkeypatch,
        plugin_modules="bad.mod:reg,missing.mod:reg,good.mod:reg",
    )

    # Must not raise despite a raising callable and an unimportable module.
    await lifecycle._load_plugin_module()

    boom.assert_called_once_with()
    good.assert_called_once_with()


async def test_async_register_callable_is_awaited(fake_modules, monkeypatch):
    from unittest.mock import AsyncMock

    areg = AsyncMock()
    fake_modules["async.mod"] = SimpleNamespace(register=areg)

    _set_settings(monkeypatch, plugin_modules="async.mod:register")

    await lifecycle._load_plugin_module()

    areg.assert_awaited_once_with()


async def test_empty_settings_is_noop(fake_modules, monkeypatch):
    _set_settings(monkeypatch, plugin_module="", plugin_modules="")
    # No modules registered; should simply do nothing without error.
    await lifecycle._load_plugin_module()
