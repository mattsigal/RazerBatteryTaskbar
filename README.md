# Razer Battery Taskbar

A lightweight Electron taskbar tray utility that displays the real-time battery percentage of wireless Razer mice in the Windows system tray without requiring Razer Synapse.

Forked and modernized from [Tekk-Know/RazerBatteryTaskbar](https://github.com/Tekk-Know/RazerBatteryTaskbar).

## Key Improvements in this Fork

- **Native Windows HID (`node-hid`)**: Replaced the legacy `usb` / libusb implementation with native Windows HID API calls. This completely resolves the `LIBUSB_ERROR_NOT_SUPPORTED` and `claimInterface` errors on Windows 10/11 without requiring custom driver installation (Zadig) or administrative elevation.
- **Dynamic Numeric Tray Icon**: Generates a crisp, anti-aliased taskbar badge showing the exact battery percentage (e.g. `32%`, `85%`) rather than static 10% interval icons. Features intelligent color-coding: Razer Neon Green (`#00FF00`) for > 50%, Warning Amber (`#FFCC00`) for 21%–50%, Critical Red (`#FF3333`) for ≤ 20%, and Electric Cyan (`#00E5FF`) when charging.
- **Charging Detection**: Queries charging state via hardware feature reports and indicates active charging with electric cyan accents and charging badges.
- **Hardware Controls (DPI & Polling Rate)**: Query and adjust active DPI (400, 800, 1600, 3200, 6400) and Polling Rate (125 Hz, 500 Hz, 1000 Hz) directly on-the-fly from the system tray context menu.
- **Sleep / Resume Resilient**: Monitors Windows power state transitions via Electron `powerMonitor` and automatically refreshes connection status upon system resume.
- **Autostart Support**: Easily toggles Windows startup directly from the tray context menu (`Start with Windows`).
- **Standalone Portable Build**: Package directly into a portable directory with `npm run build`.

## Supported Hardware

- Razer DeathAdder V3 Pro (Wireless & Wired)
- Razer DeathAdder V2 Pro (Wireless & Wired)
- Razer DeathAdder V2 X HyperSpeed
- Razer Basilisk V3 Pro (Wireless & Wired)
- Razer Basilisk V3 X HyperSpeed
- Razer Basilisk X HyperSpeed
- Razer Basilisk Ultimate & Dongle
- Razer Viper V2 Pro (Wireless & Wired)
- Razer Viper Ultimate & Dongle
- Razer Naga V2 Pro (Wireless & Wired)
- Razer Cobra Pro (Wireless & Wired)
- Razer HyperPolling Wireless Dongle
- Razer Mouse Dock Pro

## Development & Usage

### Prerequisites

- Node.js (v18+)
- Windows 10 / 11

### Running in Development

```powershell
npm install
npm start
```

### Building Standalone Executable

```powershell
npm run build
```

The standalone package will be generated at `dist/RazerBatteryTaskbar-win32-x64/RazerBatteryTaskbar.exe`.

## Credits

- [OpenRazer](https://github.com/openrazer/openrazer) for driver protocol references.
- [Hsutungyu](https://github.com/hsutungyu/razer-mouse-battery-windows) for Windows Razer battery indicator scripts.
- [Tekk-Know](https://github.com/Tekk-Know/RazerBatteryTaskbar) for the original concept and assets.
