#!/bin/bash
# Turns a fresh Raspberry Pi OS Lite install into a full-screen display of
# one web page. Safe to run again: every step checks or overwrites its own
# files.
#
#   sudo ./setup.sh <DISPLAY_URL> [--nightly-reboot]
#
# What it does:
#   - installs Cage (a Wayland compositor that runs one app full screen),
#     Chromium and curl
#   - creates a "kiosk" user and a systemd service that starts Chromium in
#     kiosk mode on boot and restarts it if it exits (Restart=always)
#   - turns off Chromium's first-run, crash-restore and translate prompts
#   - turns off console screen blanking
#   - makes sure compressed swap in RAM (zram) is on, so Chromium fits in 512 MB
#   - with --nightly-reboot, reboots every day at 4:00 AM (Pi's local time)
#
# Written for Raspberry Pi OS Lite based on Debian 13 (Trixie). It also
# handles Debian 12 (Bookworm), where the Chromium package has a different
# name and swap is set up differently. See pi/README.md.

set -euo pipefail

usage() {
  echo "Usage: sudo $0 <DISPLAY_URL> [--nightly-reboot]" >&2
  exit 1
}

URL="${1:-}"
NIGHTLY_REBOOT=no
[ "${2:-}" = "--nightly-reboot" ] && NIGHTLY_REBOOT=yes
[ -n "$URL" ] || usage
case "$URL" in
  https://* | http://*) ;;
  *) echo "The URL must start with https:// or http://" >&2; exit 1 ;;
esac
if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo." >&2
  exit 1
fi

KIOSK_USER=kiosk
CONF_DIR=/etc/today-display
LAUNCHER=/usr/local/bin/today-display-kiosk
SERVICE=/etc/systemd/system/today-display.service

step() { echo; echo "==> $*"; }

# ---------------------------------------------------------------------------
step "Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
if apt-cache show chromium >/dev/null 2>&1; then
  CHROMIUM_PKG=chromium
else
  CHROMIUM_PKG=chromium-browser
fi
apt-get install -y -q --no-install-recommends cage "$CHROMIUM_PKG" curl ca-certificates fonts-dejavu-core

# ---------------------------------------------------------------------------
step "Creating the $KIOSK_USER user"
if ! id "$KIOSK_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /usr/sbin/nologin "$KIOSK_USER"
fi
for group in video render input; do
  if getent group "$group" >/dev/null; then usermod -aG "$group" "$KIOSK_USER"; fi
done

# ---------------------------------------------------------------------------
step "Saving the display URL"
install -d -m 0755 "$CONF_DIR"
# The URL contains the display token, so only root and the kiosk user can read it.
printf '%s\n' "$URL" > "$CONF_DIR/url"
chown root:"$KIOSK_USER" "$CONF_DIR/url"
chmod 0640 "$CONF_DIR/url"

# ---------------------------------------------------------------------------
step "Writing the launcher ($LAUNCHER)"
cat > "$LAUNCHER" <<'LAUNCHER_EOF'
#!/bin/sh
# Started by today-display.service as the kiosk user.
set -u
URL="$(cat /etc/today-display/url)"
PROFILE="$HOME/.config/chromium"

# Wait until the page answers, so Chromium does not open on an error page.
#
# After the page has loaded once, its service worker keeps a saved copy, which
# Chromium stores under "Service Worker/CacheStorage" in the profile. With
# that copy, there is no need to wait forever: after WAIT_LIMIT seconds
# Chromium starts anyway and shows the saved page, with a running clock and
# the last known events. Without it, wait until the page answers.
#
# The Pi has no clock battery. Until it reaches a time server, its clock starts
# from the last time it saved, so after a power cut it is behind by about as
# long as the power was off. So if the clock has not synced since boot, wait
# longer: a router that lost power too usually comes back within a few
# minutes, and then the clock syncs before the page appears.
if [ -e /run/systemd/timesync/synchronized ]; then
  WAIT_LIMIT=30
else
  WAIT_LIMIT=180
fi
# Seconds since boot. Unlike `date`, this does not jump when the clock syncs.
uptime_s() { cut -d. -f1 /proc/uptime; }
STARTED="$(uptime_s)"
until curl -fsS -o /dev/null --max-time 10 "$URL"; do
  if [ -d "$PROFILE/Default/Service Worker/CacheStorage" ] &&
    [ $(( $(uptime_s) - STARTED )) -ge "$WAIT_LIMIT" ]; then
    echo "The display page is not reachable. Starting with the page's saved copy."
    break
  fi
  echo "Waiting for the display page to be reachable..."
  sleep 5
done

# Mark the last session as a clean exit, so Chromium shows no
# "restore pages?" prompt after a power cut.
if [ -f "$PROFILE/Default/Preferences" ]; then
  sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' \
    "$PROFILE/Default/Preferences"
fi
if [ -f "$PROFILE/Local State" ]; then
  sed -i 's/"exited_cleanly":false/"exited_cleanly":true/' "$PROFILE/Local State"
fi

CHROMIUM="$(command -v chromium || command -v chromium-browser)"

exec cage -- "$CHROMIUM" \
  --ozone-platform=wayland \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --no-default-browser-check \
  --disable-session-crashed-bubble \
  --disable-features=Translate,TranslateUI,MediaRouter \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --check-for-update-interval=31536000 \
  --password-store=basic \
  --renderer-process-limit=1 \
  --disk-cache-size=10485760 \
  "$URL"
LAUNCHER_EOF
chmod 0755 "$LAUNCHER"

# ---------------------------------------------------------------------------
step "Writing the systemd service ($SERVICE)"
# Cage needs a logind session on a real terminal. This follows the unit in
# the Cage project's wiki ("Starting Cage on boot with systemd").
cat > /etc/pam.d/cage <<'PAM_EOF'
auth     required pam_unix.so nullok
account  required pam_unix.so
session  required pam_unix.so
session  required pam_systemd.so
PAM_EOF

cat > "$SERVICE" <<SERVICE_EOF
[Unit]
Description=Today display (Chromium kiosk in Cage)
After=systemd-user-sessions.service plymouth-quit-wait.service network-online.target
Wants=network-online.target
After=dbus.socket systemd-logind.service
Wants=dbus.socket systemd-logind.service
Conflicts=getty@tty1.service
After=getty@tty1.service
ConditionPathExists=/dev/tty0
StartLimitIntervalSec=0

[Service]
Type=simple
User=$KIOSK_USER
PAMName=cage
WorkingDirectory=~
ExecStart=$LAUNCHER
Restart=always
RestartSec=5
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
TTYVTDisallocate=yes
StandardInput=tty-fail
StandardOutput=journal
StandardError=journal
UtmpIdentifier=tty1
UtmpMode=user

[Install]
WantedBy=multi-user.target
SERVICE_EOF

systemctl daemon-reload
systemctl disable getty@tty1.service >/dev/null 2>&1 || true
systemctl enable today-display.service

# ---------------------------------------------------------------------------
step "Turning off console screen blanking"
CMDLINE=/boot/firmware/cmdline.txt
[ -f "$CMDLINE" ] || CMDLINE=/boot/cmdline.txt
if [ -f "$CMDLINE" ]; then
  if ! grep -q 'consoleblank=0' "$CMDLINE"; then
    # cmdline.txt must stay a single line.
    sed -i '1 s/$/ consoleblank=0/' "$CMDLINE"
  fi
else
  echo "Could not find cmdline.txt; skipping." >&2
fi
# Cage itself never blanks the screen, so nothing else is needed.

# ---------------------------------------------------------------------------
step "Checking compressed swap (zram)"
if dpkg -s rpi-swap >/dev/null 2>&1; then
  # Trixie: rpi-swap already sets up zram (plus a swap file) by default.
  echo "rpi-swap is installed; leaving its zram settings as they are."
else
  # Bookworm and older: add zram with zram-tools, half of RAM, zstd.
  apt-get install -y -q --no-install-recommends zram-tools
  cat > /etc/default/zramswap <<'ZRAM_EOF'
# Written by today-display setup.sh
ALGO=zstd
PERCENT=50
PRIORITY=100
ZRAM_EOF
  systemctl enable zramswap.service
  systemctl restart zramswap.service || true
fi

# ---------------------------------------------------------------------------
if [ "$NIGHTLY_REBOOT" = yes ]; then
  step "Adding a nightly reboot at 4:00 AM"
  cat > /etc/systemd/system/today-display-reboot.service <<'EOF2'
[Unit]
Description=Nightly reboot for the Today display

[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl reboot
EOF2
  cat > /etc/systemd/system/today-display-reboot.timer <<'EOF2'
[Unit]
Description=Nightly reboot for the Today display

[Timer]
OnCalendar=*-*-* 04:00:00
Persistent=false

[Install]
WantedBy=timers.target
EOF2
  systemctl daemon-reload
  systemctl enable --now today-display-reboot.timer
else
  if systemctl list-unit-files today-display-reboot.timer >/dev/null 2>&1; then
    systemctl disable --now today-display-reboot.timer >/dev/null 2>&1 || true
  fi
fi

# ---------------------------------------------------------------------------
step "Done"
echo "Swap now:"
swapon --show || true
echo
echo "Reboot to start the display:  sudo reboot"
echo "Logs:                         journalctl -u today-display -f"
