#!/bin/bash
# Resilience bootstrap for the Orange Pi k8s NODE that hosts the Esszimmer
# satellite pod (k8s/satellite-esszimmer.yaml). The pod is hardware-pinned to
# this node (USB XVF3800 mic, host BlueZ, /var/lib/bluetooth), so a dead node =
# a dead Esszimmer that k8s CANNOT self-heal — only a reboot recovers it.
#
# The node went NotReady ("Kubelet stopped posting node status") + fully
# ping-unreachable twice in one day, each needing a manual power-cycle. This adds
# the same two-layer watchdog the bare-metal satellites have, plus persistent
# logs so the NEXT failure is actually diagnosable (the journal was volatile, so
# the death cause was lost on reboot).
#
# Run AS ROOT on the node:  scp this + renfield-net-watchdog.sh, then ./this.sh
# Idempotent. The net-watchdog script is the SAME one the satellites use
# (src/satellite/provisioning/templates/renfield-net-watchdog.sh.j2) — keep them
# in sync.
set -euo pipefail

WATCHDOG_SRC="${1:-/usr/local/bin/renfield-net-watchdog.sh}"   # path to the net-watchdog script
HW_WATCHDOG_SEC="${HW_WATCHDOG_SEC:-14}"                        # <= sunxi/Allwinner ~16s max
NET_THRESHOLD="${NET_THRESHOLD:-5}"                            # consecutive ~1-min fails -> reboot
NET_MAX_REBOOTS="${NET_MAX_REBOOTS:-3}"                        # give up after N (refills on a good ping)

[ "$(id -u)" -eq 0 ] || { echo "must run as root" >&2; exit 1; }
[ -f "$WATCHDOG_SRC" ] || { echo "net-watchdog script not found at $WATCHDOG_SRC" >&2; exit 1; }

echo "1/3 persistent journald (so the next failure is diagnosable)"
mkdir -p /etc/systemd/journald.conf.d /var/log/journal
printf '[Journal]\nStorage=persistent\nSystemMaxUse=200M\n' > /etc/systemd/journald.conf.d/10-persistent.conf
systemctl restart systemd-journald

echo "2/3 SoC hardware watchdog (RuntimeWatchdogSec=${HW_WATCHDOG_SEC}s) for kernel/PID-1 hangs"
mkdir -p /etc/systemd/system.conf.d
printf '# Node resilience — keep <= the SoC watchdog max (sunxi ~16s).\n[Manager]\nRuntimeWatchdogSec=%ss\n' \
    "$HW_WATCHDOG_SEC" > /etc/systemd/system.conf.d/50-renfield-watchdog.conf
systemctl daemon-reexec   # re-arms /dev/watchdog live; daemon-reload does NOT

echo "3/3 network watchdog (reboot if the default gateway is unreachable) for a wedged net stack"
install -m 0755 "$WATCHDOG_SRC" /usr/local/bin/renfield-net-watchdog.sh
cat > /etc/systemd/system/renfield-net-watchdog.service <<UNIT
[Unit]
Description=Renfield node network watchdog (reboot if local network is wedged)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/renfield-net-watchdog.sh "" ${NET_THRESHOLD} ${NET_MAX_REBOOTS}
UNIT
cat > /etc/systemd/system/renfield-net-watchdog.timer <<'UNIT'
[Unit]
Description=Run the Renfield node network watchdog periodically

[Timer]
OnBootSec=5min
OnUnitActiveSec=60s
AccuracySec=10s

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now renfield-net-watchdog.timer

echo "done:"
echo "  RuntimeWatchdogUSec=$(systemctl show -p RuntimeWatchdogUSec --value)"
echo "  net-watchdog timer = $(systemctl is-active renfield-net-watchdog.timer)/$(systemctl is-enabled renfield-net-watchdog.timer)"
echo "  journald Storage   = $(grep -h Storage= /etc/systemd/journald.conf.d/10-persistent.conf)"
