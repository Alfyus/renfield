# BLE Presence Improvement

Improve household BLE presence (accuracy, latency, reliability), prompted by the
Esszimmer Orange Pi Zero 3W (Allwinner A733, **Bluetooth 5.4**) being a much
stronger BT radio than the Pi-Zero fleet — and a good primary anchor.

## Current state (before this work)
- Satellite `ble/scanner.py`: a periodic `BleakScanner.discover()` burst every
  `scan_interval` (30 s) for `scan_duration` (5 s); reports `{mac, rssi}` for
  devices in a `known_devices` MAC whitelist above `rssi_threshold`. Backend
  aggregates per-room RSSI for arbitration.
- `classic_rssi: false` on the A733 board (AIC8800 raw-HCI `hcitool cc/rssi` is
  broken; advertisement RSSI is real and used).

## Problems (what limits accuracy)
1. **MAC randomization (root limiter).** Modern phones/watches rotate their BLE
   address (RPA), so a static MAC whitelist drifts. **Not fixed by any BT version.**
2. **Scan latency / coverage.** 5 s scan every 30 s → up to ~30 s latency; a
   device advertising in the gap is missed.
3. **RSSI jitter.** Single-shot advertisement RSSI is noisy → room arbitration
   flip-flops (cf. the Kinderbad synthetic-−50 hijack incident).

## What the BT 5.4 controller offers (probed on the A733)
- ✅ LE **2M** + **Coded (Long Range)** PHY (`LECODEDTX/RX`), Extended
  Advertising, address privacy.
- ❌ **No usable AoA/AoD direction-finding** (no CTE exposed; needs a multi-antenna
  array). No angle-based positioning.

## Plan (phased)

### Phase 1 — Continuous, smoothed scanning  ✅ IMPLEMENTED (this change)
- **BlueZ `Experimental = true`** codified in the satellite Ansible
  (`provision.yml` → `ini_file` on `/etc/bluetooth/main.conf`, restarts
  bluetoothd). Unlocks the AdvertisementMonitor/passive APIs and survives a
  re-image. *(Already set live on the Esszimmer host.)*
- **Continuous scanning** in `ble/scanner.py` (`continuous: true`): one
  long-running `BleakScanner` with a detection callback instead of discover()
  bursts; per-device **EWMA-smoothed RSSI** with a freshness window
  (`smoothing_alpha`, `freshness_seconds`). The scan loop polls
  `get_readings()` each `scan_interval`. Falls back to the periodic discover()
  path when `continuous: false` (default → fleet byte-identical).
- Config plumbed through `BLEConfig`, `load_config`, the Ansible template +
  group_vars (`ble_continuous` etc.).
- **Latency** also reduced independently by `scan_interval 30→3` on the A733.

### Phase 1b — AdvertisementMonitor passive offload  ⏳ DEFERRED
Use BlueZ passive scanning (`scanning_mode="passive"` + `or_patterns`, kernel
RSSI-threshold offload) rather than active continuous scan. Lower power/CPU;
needs Experimental (now enabled). Follow-on to the continuous callback above.

### Phase 1c — Backend RSSI smoothing + hysteresis  ⏳ DEFERRED (shared backend)
Median/EWMA + hand-off hysteresis in the room-arbitration logic to kill
flip-flop. Touches the production backend → its own reviewed change.

### Phase 2 — Defeat MAC randomization via IRK/bonding  ⏳ DEFERRED (the real win)
Bond household devices so BlueZ resolves rotating RPAs to a stable identity via
the IRK; presence keys on resolved identity, not raw MAC. Largest surface:
satellite (bonding/resolution) + backend (identity store, IRK distribution,
presence model) + a small enroll UX + privacy review (storing IRKs).

### Phase 3 — Optional reach  ⏳ DEFERRED
Coded-PHY (Long Range) scanning for compatible tags/beacons; connection-based
RSSI for bonded devices.

## Non-goals
Direction finding / angle positioning (hardware can't); UWB.

## Rollout & metrics
Designed fleet-wide; validated on the Esszimmer A733 as the strongest anchor,
then rolled to the Pi fleet via Ansible (`--tags app`). Older radios still gain
continuous scan + smoothing (and later IRK). Metrics: presence-detection
latency, room-arbitration flip rate, % time known devices resolved after MAC
rotation.

## Open questions
- Bond per-satellite vs central IRK distribution?
- Audit: which household devices use stable vs randomized addresses today?
- Privacy/consent model for storing IRKs (ties into household privacy posture).
