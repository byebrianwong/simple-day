# iPad display

This makes an iPad show the display page full screen, with the screen always
on and touches ignored.

> **Not yet tested on a real iPad.** The page's script targets Safari 11
> (iOS 11) and newer and avoids newer CSS features, so it should run on
> iPads back to the iPad Air (2013). iOS 10 will probably work too. Older
> iPads (iOS 9 and earlier) will not: their Safari has no `Intl`, which the
> clock needs for time zones.

## Setup

1. **Add the page to the Home Screen.** Open the display URL in Safari
   (`https://your-app.vercel.app/d/<DISPLAY_TOKEN>`). Tap Share, then
   "Add to Home Screen", then Add. Open it from the new "Today" icon. It opens
   full screen, with no Safari address bar.

2. **Keep the screen on.** Settings > Display & Brightness > Auto-Lock >
   Never.

3. **Turn on Guided Access.** Settings > Accessibility > Guided Access: turn
   it on and set a passcode. In the same screen, check that **Display
   Auto-Lock** is set to Never. Guided Access has its own auto-lock setting,
   and if it is left on a timer the screen goes dark even though step 2 says
   Never.

4. **Lock the app in place.** Open the Today app, triple-click the top
   button (or the Home button on older iPads) to start Guided Access, tap
   Options, turn off Touch, then tap Start.

5. **Keep the iPad plugged in.**

## Also worth doing

- **Stop notifications covering the screen.** Turn on a Focus (Do Not
  Disturb) that is always on, or turn off notifications for every app.
- **Turn off automatic iOS updates.** Settings > General > Software Update >
  Automatic Updates. An update restarts the iPad, which ends Guided Access,
  and someone has to start it again by hand.
- **Optional:** turn off Night Shift and True Tone so colours stay the same
  all day. The page dims itself at night.

## Checks ("done when")

Not yet checked on a device:

- [ ] The page fills the screen with no Safari bars.
- [ ] The screen stays on all day.
- [ ] Touches do nothing.

## Stopping Guided Access

Triple-click the top (or Home) button and enter the passcode.
