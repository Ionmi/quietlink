# Popover spike (Task 1) — 2026-09-24, macOS 27, two displays

- Tray without a menu emits `tray-clicked` with `action: ""` on click → used to toggle the popover.
- `Tray.getBounds()` returns Cocoa coordinates (origin bottom-left of the main screen, y up); `BrowserWindow.setFrame` uses top-left coordinates (y down). Conversion needs the main screen height, which Electrobun does not expose, so the Swift helper provides `--screens` (NSScreen frames). Verified with the tray on an external display above the built-in one: popover lands 7 px under the icon.
- Clicking the status item can steal focus right after `show()`, firing `blur` immediately. A 400 ms grace after show fixes it; activating another app afterwards hides the popover (verified via AppleScript).
- Decision: keep the popover (positioned borderless window). Setting a native tray menu would replace the click event, so the tray has no menu; all actions live in the popover and the settings window.
