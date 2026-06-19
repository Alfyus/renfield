"""
BLE Scanner for Renfield Satellite

Scans for known BLE devices (phones, watches) and reports RSSI values.
Uses bleak library for cross-platform BLE scanning.

Two modes:
  - Periodic (default, legacy): a discover() burst every scan_interval. Simple,
    works on any adapter (Pi Zero 2 W, BT 4.2).
  - Continuous (continuous=True, BT 5.x / mains-powered nodes): a single
    BleakScanner stays running with a detection callback; per-device RSSI is
    smoothed (EWMA) and reported with a freshness window. Lower presence latency
    and steadier RSSI for room arbitration. Requires no extra adapter features,
    but benefits from BlueZ Experimental (AdvertisementMonitor) being enabled.
"""

import time

try:
    from bleak import BleakScanner as _BleakScanner
    BLEAK_AVAILABLE = True
except ImportError:
    _BleakScanner = None
    BLEAK_AVAILABLE = False


class BLEScanner:
    """
    Scans for known BLE devices and returns RSSI values.

    Only reports devices whose MAC addresses are in the known_macs whitelist,
    ensuring privacy and efficiency.
    """

    def __init__(
        self,
        scan_duration: float = 5.0,
        rssi_threshold: int = -80,
        smoothing_alpha: float = 0.4,
        freshness_seconds: float = 20.0,
    ):
        self.scan_duration = scan_duration
        self.rssi_threshold = rssi_threshold
        self.smoothing_alpha = smoothing_alpha
        self.freshness_seconds = freshness_seconds

        # Continuous-mode state
        self._scanner = None
        self._known_macs: set[str] = set()
        # mac -> [ewma_rssi, last_seen_monotonic]
        self._readings: dict[str, list] = {}

        if not BLEAK_AVAILABLE:
            print("Warning: bleak not installed. BLE scanning disabled.")

    @property
    def available(self) -> bool:
        return BLEAK_AVAILABLE

    # ---- Periodic mode (legacy) -------------------------------------------

    async def scan(self, known_macs: set[str]) -> list[dict]:
        """
        One discover() burst for known BLE devices.

        Args:
            known_macs: Set of MAC addresses (uppercase, colon-separated) to look for.

        Returns:
            List of dicts with 'mac' and 'rssi' for each detected known device.
        """
        if not BLEAK_AVAILABLE or not known_macs:
            return []

        try:
            devices = await _BleakScanner.discover(
                timeout=self.scan_duration,
                return_adv=True,
            )
        except Exception as e:
            print(f"BLE scan error: {e}")
            return []

        results = []
        # devices is dict {BLEDevice: AdvertisementData} when return_adv=True
        for device, adv_data in devices.values():
            mac = (device.address or "").upper()
            if mac in known_macs:
                rssi = adv_data.rssi
                if rssi is not None and rssi >= self.rssi_threshold:
                    results.append({"mac": mac, "rssi": rssi})

        return results

    # ---- Continuous mode --------------------------------------------------

    def update_known(self, known_macs: set[str]) -> None:
        """Update the known-MAC whitelist the detection callback filters on
        (the backend pushes updates while the continuous scanner keeps running)."""
        self._known_macs = {m.upper() for m in known_macs}
        # Drop readings for devices no longer tracked
        for mac in list(self._readings):
            if mac not in self._known_macs:
                self._readings.pop(mac, None)

    def _on_detection(self, device, adv_data) -> None:
        """bleak detection callback: fold each advertisement into a per-device
        EWMA RSSI. Cheap and runs on the event loop."""
        mac = (device.address or "").upper()
        if mac not in self._known_macs:
            return
        rssi = getattr(adv_data, "rssi", None)
        if rssi is None:
            return
        now = time.monotonic()
        entry = self._readings.get(mac)
        if entry is None:
            self._readings[mac] = [float(rssi), now]
        else:
            a = self.smoothing_alpha
            entry[0] = a * float(rssi) + (1.0 - a) * entry[0]
            entry[1] = now

    async def start_continuous(self, known_macs: set[str]) -> bool:
        """Start a single long-running scanner with the detection callback.
        Returns True if started (or already running), False if unavailable."""
        if not BLEAK_AVAILABLE:
            return False
        self.update_known(known_macs)
        if self._scanner is not None:
            return True
        try:
            self._scanner = _BleakScanner(detection_callback=self._on_detection)
            await self._scanner.start()
            print("BLE continuous scanner started")
            return True
        except Exception as e:
            print(f"BLE continuous start error: {e}")
            self._scanner = None
            return False

    async def stop_continuous(self) -> None:
        if self._scanner is not None:
            try:
                await self._scanner.stop()
            except Exception as e:
                print(f"BLE continuous stop error: {e}")
            self._scanner = None
        self._readings.clear()

    def get_readings(self) -> list[dict]:
        """Snapshot of fresh, above-threshold devices with smoothed RSSI.
        Prunes stale entries (unseen > freshness_seconds)."""
        now = time.monotonic()
        results = []
        for mac in list(self._readings):
            rssi, last_seen = self._readings[mac]
            if now - last_seen > self.freshness_seconds:
                self._readings.pop(mac, None)
                continue
            rssi_i = int(round(rssi))
            if rssi_i >= self.rssi_threshold:
                results.append({"mac": mac, "rssi": rssi_i})
        return results
