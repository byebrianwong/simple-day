# Raspberry Pi display

This turns a Raspberry Pi Zero 2 W and a monitor into a screen that shows
the display page all day, with no keyboard or mouse.

> **Not yet tested on real hardware.** `setup.sh` follows current guides for
> Raspberry Pi OS Lite based on Debian 13 (Trixie) and the Cage project's own
> systemd example. It has not been run on a Pi yet. Expect to adjust it on the
> first install, and update this file with what you find.

## What you need

- Raspberry Pi Zero 2 W. The original Pi Zero and Zero W are probably too
  slow to run Chromium.
- 5V 2.5A micro-USB power supply.
- microSD card, 16 GB or larger.
- Mini-HDMI to HDMI cable or adapter.
- A monitor.
- A 2.4 GHz Wi-Fi network. The Zero 2 W cannot use 5 GHz.

## Setup

1. **Flash the card.** In Raspberry Pi Imager, pick Raspberry Pi Zero 2 W and
   "Raspberry Pi OS Lite" (no desktop). In the customisation screen set:
   - a hostname, for example `today-display`
   - a username and password
   - the Wi-Fi network name and password
   - your locale and the time zone where the display lives
   - SSH on (password or key)

2. **Copy the script and run it.** Put the card in the Pi, power it on and
   wait a couple of minutes. Then, from your computer:

   ```bash
   scp pi/setup.sh <username>@today-display.local:
   ```

   ```bash
   ssh <username>@today-display.local
   ```

   On the Pi, run the script with the display URL in quotes. The URL contains
   the display token, so treat it like a password.

   ```bash
   sudo bash setup.sh 'https://your-app.vercel.app/d/<DISPLAY_TOKEN>'
   ```

   Add `--nightly-reboot` at the end to reboot every night at 4:00 AM (Pi's
   time zone). This is optional; the page already reloads itself at 3:00 AM.

3. **Reboot.**

   ```bash
   sudo reboot
   ```

   The page should appear within about 2 minutes.

You can run `setup.sh` again at any time, for example to change the URL.

### Optional: remote access with Tailscale

If the display lives at another house, Tailscale lets you SSH in from
anywhere without opening ports on their router.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

```bash
sudo tailscale up
```

Follow the sign-in link it prints. After that, `ssh <username>@today-display`
works from any device on your Tailscale network.

## What the script sets up

| Piece | Where | What it does |
|---|---|---|
| Packages | apt | `cage` (runs one app full screen), `chromium` (or `chromium-browser` on Bookworm), `curl`, a font |
| `kiosk` user | `/home/kiosk` | Runs the browser. Has no login shell. |
| URL | `/etc/today-display/url` | Readable only by root and `kiosk`. |
| Launcher | `/usr/local/bin/today-display-kiosk` | Waits until the page answers (at most 3 minutes once the page has a saved copy; see Known gaps), clears Chromium's crash flag, starts Chromium in Cage. |
| Service | `today-display.service` | Starts the launcher on tty1 at boot. `Restart=always`, so Chromium comes back if it exits or crashes. |
| Screen blanking | `consoleblank=0` in `cmdline.txt` | Stops the text console from blanking before Cage starts. Cage itself never blanks. |
| Swap | `rpi-swap` (Trixie) or `zram-tools` (Bookworm) | Compressed swap in RAM, so Chromium fits in 512 MB. |
| Nightly reboot | `today-display-reboot.timer` | Only with `--nightly-reboot`. |

Chromium flags turn off the first-run screens, the "restore pages?" bubble,
the translate prompt, pinch zoom and swipe navigation.

## Checks ("done when")

Not yet checked on hardware:

- [ ] After power-on, the page appears within about 2 minutes with no keyboard
      or mouse attached.
- [ ] Pull the power cable, plug it back in: the page comes back.
- [ ] Turn the Wi-Fi router off for 10 minutes, then on: the clock keeps
      running the whole time, and calendar changes show up again within a few
      minutes after Wi-Fi returns.
- [ ] With the page loaded at least once, turn the Wi-Fi router off and
      reboot the Pi: within about 4 minutes the page appears with the clock
      and the last known events.

## Known gaps

- **Wi-Fi down at boot.** The launcher waits for the page before starting
  Chromium. After the page has loaded once, its service worker keeps a saved
  copy, so the launcher waits at most 3 minutes (30 seconds if the clock has
  synced since boot) and then starts Chromium with the saved copy: the clock
  runs and the last known events show, with "Calendar last updated" at the
  bottom. On the very first boot there is no saved copy, so the screen stays
  black until Wi-Fi works. The launcher finds the saved copy by looking for
  Chromium's `Service Worker/CacheStorage` folder in the kiosk user's profile.
  That folder was checked in Chrome on a Mac, not yet in Chromium on the Pi.
- **Wrong time after a power cut with no internet.** The Pi Zero 2 W has no
  clock battery. Until it reaches a time server, its clock starts from the
  time it last saved, so after a power cut it is behind by about as long as
  the power was off. The 3-minute wait covers the usual case, where the router
  lost power too and comes back within a few minutes. If the internet stays
  down for longer, the screen shows a wrong time until it returns. A real-time
  clock module with a battery would fix this; none is set up.
- **Memory.** Chromium on 512 MB is tight. If the page is slow or Chromium
  restarts often (`journalctl -u today-display`), try the 32-bit Raspberry Pi
  OS Lite, which uses less memory.
- **Package names change between OS releases.** On Debian 13 the browser
  package is `chromium`; older guides say `chromium-browser`. The script picks
  whichever exists.

## Troubleshooting

See what the display service is doing:

```bash
journalctl -u today-display -f
```

Restart the browser without rebooting:

```bash
sudo systemctl restart today-display
```

Check swap:

```bash
swapon --show
```

## Sources

- Cage on boot with systemd: <https://github.com/cage-kiosk/cage/wiki/Starting-Cage-on-boot-with-systemd>
- `chromium-browser` renamed to `chromium` on Debian 13: <https://blog.r0b.io/post/minimal-rpi-kiosk/>
- Chromium kiosk on Debian 13, crash-flag cleanup: <https://alessandroscola.com/en/computers/web-kiosk-with-raspberry-pi-and-debian-13-trixie>
- `rpi-swap` (zram on Trixie): <https://github.com/raspberrypi/rpi-swap>
