const { app, Tray, Menu, nativeImage, BrowserWindow, powerMonitor } = require('electron');
const path = require('path');
const HID = require('node-hid');

// Exit immediately if squirrel installer events are firing
if (require('electron-squirrel-startup')) app.quit();

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
}

// Razer Constants & Supported Hardware
const RazerVendorId = 0x1532;
const RazerProducts = {
    0x00A4: { name: 'Razer Mouse Dock Pro', transactionId: 0x1f },
    0x00AA: { name: 'Razer Basilisk V3 Pro (Wired)', transactionId: 0x1f },
    0x00AB: { name: 'Razer Basilisk V3 Pro', transactionId: 0x1f },
    0x00B9: { name: 'Razer Basilisk V3 X HyperSpeed', transactionId: 0x1f },
    0x007C: { name: 'Razer DeathAdder V2 Pro (Wired)', transactionId: 0x3f },
    0x007D: { name: 'Razer DeathAdder V2 Pro', transactionId: 0x3f },
    0x009C: { name: 'Razer DeathAdder V2 X HyperSpeed', transactionId: 0x1f },
    0x00B3: { name: 'Razer HyperPolling Wireless Dongle', transactionId: 0x1f },
    0x00B6: { name: 'Razer DeathAdder V3 Pro (Wired)', transactionId: 0x1f },
    0x00B7: { name: 'Razer DeathAdder V3 Pro', transactionId: 0x1f },
    0x0083: { name: 'Razer Basilisk X HyperSpeed', transactionId: 0x1f },
    0x0086: { name: 'Razer Basilisk Ultimate', transactionId: 0x1f },
    0x0088: { name: 'Razer Basilisk Ultimate Dongle', transactionId: 0x1f },
    0x008F: { name: 'Razer Naga V2 Pro (Wired)', transactionId: 0x1f },
    0x0090: { name: 'Razer Naga V2 Pro', transactionId: 0x1f },
    0x00A5: { name: 'Razer Viper V2 Pro (Wired)', transactionId: 0x1f },
    0x00A6: { name: 'Razer Viper V2 Pro', transactionId: 0x1f },
    0x007B: { name: 'Razer Viper Ultimate (Wired)', transactionId: 0x3f },
    0x0078: { name: 'Razer Viper Ultimate', transactionId: 0x3f },
    0x007A: { name: 'Razer Viper Ultimate Dongle', transactionId: 0x3f },
    0x00AF: { name: 'Razer Cobra Pro (Wired)', transactionId: 0x1f },
    0x00B0: { name: 'Razer Cobra Pro', transactionId: 0x1f }
};

let tray = null;
let pollTimer = null;
let hiddenRendererWin = null;
let lastStatus = {
    connected: false,
    deviceName: 'Razer Device',
    percent: null,
    isCharging: false,
    dpi: null,
    pollRate: null
};

// Builds a Windows HID feature report for Razer hardware
function buildRazerReport(cmdClass, cmdId, args = [], transactionId = 0x1f) {
    const msg = Buffer.from([0x00, transactionId, 0x00, 0x00, 0x00, args.length, cmdClass, cmdId]);
    let crc = 0;
    for (let i = 2; i < msg.length; i++) crc ^= msg[i];
    for (const a of args) crc ^= a;
    const payload = Buffer.concat([msg, Buffer.from(args), Buffer.alloc(80 - args.length), Buffer.from([crc, 0x00])]);
    // Prepend 0x00 report ID for Windows HID
    return Buffer.concat([Buffer.from([0x00]), payload]);
}

// Queries the mouse over Windows HID
function queryMouseStatus() {
    try {
        const allDevices = HID.devices();
        const razerDevices = allDevices.filter(d => d.vendorId === RazerVendorId && RazerProducts[d.productId]);

        if (razerDevices.length === 0) {
            return { connected: false, deviceName: 'Razer Device', percent: null, isCharging: false, dpi: null, pollRate: null };
        }

        // Target interface 0 (the primary mouse control collection)
        let target = razerDevices.find(d => d.interface === 0) || razerDevices[0];
        const productInfo = RazerProducts[target.productId] || { name: 'Razer Mouse', transactionId: 0x1f };

        let dev;
        try {
            dev = new HID.HID(target.path);
        } catch (err) {
            return { connected: false, deviceName: productInfo.name, percent: null, isCharging: false, dpi: null, pollRate: null };
        }

        try {
            // 1. Query Battery Level (Class: 0x07, Cmd: 0x80)
            dev.sendFeatureReport(buildRazerReport(0x07, 0x80, [], productInfo.transactionId));
            let start = Date.now();
            while (Date.now() - start < 200) {}

            const battRep = dev.getFeatureReport(0x00, 91);
            if (!battRep || battRep.length < 11 || battRep[1] !== 0x02) {
                dev.close();
                return { connected: false, deviceName: productInfo.name, percent: null, isCharging: false, dpi: null, pollRate: null };
            }

            const rawBatt = battRep[10];
            if (rawBatt === 0) {
                dev.close();
                return { connected: false, deviceName: productInfo.name, percent: null, isCharging: false, dpi: null, pollRate: null };
            }

            const percent = Math.round((rawBatt / 255) * 100);

            // 2. Query Charging Status (Class: 0x07, Cmd: 0x84)
            dev.sendFeatureReport(buildRazerReport(0x07, 0x84, [], productInfo.transactionId));
            start = Date.now();
            while (Date.now() - start < 150) {}

            const chgRep = dev.getFeatureReport(0x00, 91);
            const isCharging = chgRep && chgRep.length >= 11 && chgRep[1] === 0x02 && chgRep[10] === 1;

            // 3. Query DPI (Class: 0x04, Cmd: 0x85)
            let dpi = null;
            try {
                dev.sendFeatureReport(buildRazerReport(0x04, 0x85, [0x00], productInfo.transactionId));
                start = Date.now();
                while (Date.now() - start < 150) {}
                const dpiRep = dev.getFeatureReport(0x00, 91);
                if (dpiRep && dpiRep.length >= 14 && dpiRep[1] === 0x02) {
                    dpi = (dpiRep[10] << 8) | dpiRep[11];
                }
            } catch (e) {}

            // 4. Query Polling Rate (Class: 0x00, Cmd: 0x85)
            let pollRate = null;
            try {
                dev.sendFeatureReport(buildRazerReport(0x00, 0x85, [0x00], productInfo.transactionId));
                start = Date.now();
                while (Date.now() - start < 150) {}
                const pollRep = dev.getFeatureReport(0x00, 91);
                if (pollRep && pollRep.length >= 11 && pollRep[1] === 0x02) {
                    const b = pollRep[9] || pollRep[10];
                    if (b === 1) pollRate = 1000;
                    else if (b === 2) pollRate = 500;
                    else if (b === 8) pollRate = 125;
                }
            } catch (e) {}

            dev.close();
            return {
                connected: true,
                deviceName: productInfo.name,
                percent: Math.min(100, Math.max(0, percent)),
                isCharging: Boolean(isCharging),
                dpi,
                pollRate
            };
        } catch (commErr) {
            try { dev.close(); } catch (e) {}
            return { connected: false, deviceName: productInfo.name, percent: null, isCharging: false, dpi: null, pollRate: null };
        }
    } catch (e) {
        return { connected: false, deviceName: 'Razer Device', percent: null, isCharging: false, dpi: null, pollRate: null };
    }
}

// Sets the mouse DPI directly over HID
function setMouseDpi(dpi) {
    try {
        const allDevices = HID.devices();
        const target = allDevices.find(d => d.vendorId === RazerVendorId && RazerProducts[d.productId] && d.interface === 0);
        if (!target) return false;
        const productInfo = RazerProducts[target.productId] || { transactionId: 0x1f };
        const dev = new HID.HID(target.path);
        const args = [
            0x01, // VARSTORE
            (dpi >> 8) & 0xFF,
            dpi & 0xFF,
            (dpi >> 8) & 0xFF,
            dpi & 0xFF,
            0x00,
            0x00
        ];
        dev.sendFeatureReport(buildRazerReport(0x04, 0x05, args, productInfo.transactionId));
        dev.close();
        console.log(`[RazerBatteryTaskbar] Successfully set DPI to ${dpi}`);
        return true;
    } catch (e) {
        console.error('[RazerBatteryTaskbar] Failed to set DPI:', e.message);
        return false;
    }
}

// Sets the mouse polling rate directly over HID
function setMousePollRate(rate) {
    try {
        const allDevices = HID.devices();
        const target = allDevices.find(d => d.vendorId === RazerVendorId && RazerProducts[d.productId] && d.interface === 0);
        if (!target) return false;
        const productInfo = RazerProducts[target.productId] || { transactionId: 0x1f };
        const dev = new HID.HID(target.path);
        let byteVal = 1; // 1000 Hz
        if (rate === 500) byteVal = 2;
        else if (rate === 125) byteVal = 8;
        dev.sendFeatureReport(buildRazerReport(0x00, 0x05, [byteVal], productInfo.transactionId));
        dev.close();
        console.log(`[RazerBatteryTaskbar] Successfully set polling rate to ${rate} Hz`);
        return true;
    } catch (e) {
        console.error('[RazerBatteryTaskbar] Failed to set polling rate:', e.message);
        return false;
    }
}

// Renders dynamic 32x32 tray icon badge using Chromium Canvas
async function renderDynamicIcon(pct, isCharging, connected) {
    if (!hiddenRendererWin) {
        return nativeImage.createFromPath(path.join(__dirname, 'assets', 'battery_0.png'));
    }

    try {
        const dataUrl = await hiddenRendererWin.webContents.executeJavaScript(`
            (() => {
                const canvas = document.createElement('canvas');
                canvas.width = 32;
                canvas.height = 32;
                const ctx = canvas.getContext('2d');

                ctx.clearRect(0, 0, 32, 32);

                // Background pill
                ctx.fillStyle = 'rgba(18, 20, 24, 0.95)';
                ctx.beginPath();
                ctx.roundRect(1, 1, 30, 30, 7);
                ctx.fill();

                if (!${connected}) {
                    // Disconnected style
                    ctx.strokeStyle = '#555555';
                    ctx.lineWidth = 1.8;
                    ctx.stroke();

                    ctx.fillStyle = '#888888';
                    ctx.font = 'bold 15px "Segoe UI", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('—', 16, 16);
                    return canvas.toDataURL('image/png');
                }

                // Thresholds:
                // Charging: Cyan
                // > 50%: Neon Green
                // 21% - 50%: Vibrant Amber / Yellow
                // <= 20%: Warning Red
                let accentColor = '#00FF00'; // Razer Neon Green (> 50%)
                if (${isCharging}) {
                    accentColor = '#00E5FF'; // Electric Cyan for charging
                } else if (${pct} <= 20) {
                    accentColor = '#FF3333'; // Low Battery Red (<= 20%)
                } else if (${pct} <= 50) {
                    accentColor = '#FFCC00'; // Amber / Yellow (21% - 50%)
                }

                // Border
                ctx.strokeStyle = accentColor;
                ctx.lineWidth = 2.0;
                ctx.stroke();

                // Text and badge
                if (${isCharging}) {
                    ctx.fillStyle = '#00E5FF';
                    const fontSize = ${pct === 100 ? 11 : 13};
                    ctx.font = 'bold ' + fontSize + 'px "Segoe UI", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('${pct}', 15, 17);

                    // Small charging indicator dot at top-right
                    ctx.fillStyle = '#00E5FF';
                    ctx.beginPath();
                    ctx.arc(24, 8, 3, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    ctx.fillStyle = '#FFFFFF';
                    const fontSize = ${pct === 100 ? 12 : 15};
                    ctx.font = 'bold ' + fontSize + 'px "Segoe UI Variable Display", "Segoe UI", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('${pct}', 16, 17);
                }

                return canvas.toDataURL('image/png');
            })()
        `);
        return nativeImage.createFromDataURL(dataUrl);
    } catch (err) {
        console.error('[RazerBatteryTaskbar] Error rendering icon:', err);
        return nativeImage.createFromPath(path.join(__dirname, 'assets', 'battery_0.png'));
    }
}

// Updates tray icon, tooltip, and context menu
async function updateTray() {
    lastStatus = queryMouseStatus();
    console.log(`[RazerBatteryTaskbar] ${lastStatus.deviceName}: ${lastStatus.connected ? `${lastStatus.percent}% (${lastStatus.isCharging ? '⚡ Charging' : 'Discharging'}) | DPI: ${lastStatus.dpi || 'N/A'} | Poll: ${lastStatus.pollRate ? lastStatus.pollRate + 'Hz' : 'N/A'}` : 'Disconnected/Asleep'}`);

    if (!tray) {
        initTray();
        if (!tray) return;
    }

    try {
        const icon = await renderDynamicIcon(lastStatus.percent, lastStatus.isCharging, lastStatus.connected);
        tray.setImage(icon);

        let tooltip = `${lastStatus.deviceName}: Disconnected / Asleep`;
        if (lastStatus.connected) {
            const stateText = lastStatus.isCharging ? '⚡ Charging' : 'Discharging';
            tooltip = `${lastStatus.deviceName}: ${lastStatus.percent}% (${stateText})\nDPI: ${lastStatus.dpi || 'N/A'} | Rate: ${lastStatus.pollRate ? lastStatus.pollRate + 'Hz' : 'N/A'}`;
        }
        tray.setToolTip(tooltip);

        const isAutoStart = app.getLoginItemSettings().openAtLogin;

        // Build DPI Preset sub-items
        const dpiPresets = [400, 800, 1600, 2400, 3200, 6400];
        const dpiSubmenu = dpiPresets.map(val => ({
            label: `${val} DPI`,
            type: 'radio',
            checked: lastStatus.dpi === val,
            click: async () => {
                setMouseDpi(val);
                setTimeout(updateTray, 250);
            }
        }));

        // Build Polling Rate sub-items
        const pollPresets = [125, 500, 1000];
        const pollSubmenu = pollPresets.map(rate => ({
            label: `${rate} Hz`,
            type: 'radio',
            checked: lastStatus.pollRate === rate,
            click: async () => {
                setMousePollRate(rate);
                setTimeout(updateTray, 250);
            }
        }));

        const contextMenu = Menu.buildFromTemplate([
            {
                label: lastStatus.deviceName,
                enabled: false
            },
            {
                label: lastStatus.connected
                    ? `Battery: ${lastStatus.percent}% ${lastStatus.isCharging ? '(Charging ⚡)' : ''}`
                    : 'Status: Disconnected / Standby',
                enabled: false
            },
            { type: 'separator' },
            {
                label: `DPI: ${lastStatus.dpi ? lastStatus.dpi : 'Unknown'}`,
                submenu: dpiSubmenu,
                enabled: lastStatus.connected
            },
            {
                label: `Polling Rate: ${lastStatus.pollRate ? lastStatus.pollRate + ' Hz' : 'Unknown'}`,
                submenu: pollSubmenu,
                enabled: lastStatus.connected
            },
            { type: 'separator' },
            {
                label: 'Refresh Now',
                click: () => updateTray()
            },
            {
                label: 'Start with Windows',
                type: 'checkbox',
                checked: isAutoStart,
                click: (item) => {
                    app.setLoginItemSettings({
                        openAtLogin: item.checked,
                        path: process.execPath
                    });
                }
            },
            { type: 'separator' },
            {
                label: 'Quit',
                click: () => {
                    if (pollTimer) clearInterval(pollTimer);
                    app.isQuitting = true;
                    app.quit();
                }
            }
        ]);

        tray.setContextMenu(contextMenu);
    } catch (trayErr) {
        console.warn('[RazerBatteryTaskbar] Error updating tray:', trayErr.message);
    }
}

function initTray() {
    try {
        const initialIcon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'battery_0.png'));
        tray = new Tray(initialIcon);
        tray.setToolTip('Razer Battery Taskbar');
    } catch (e) {
        tray = null;
        console.warn('[RazerBatteryTaskbar] Tray initialization deferred:', e.message);
    }
}

// Initialize Application
app.whenReady().then(async () => {
    // Create offscreen window for canvas rendering
    hiddenRendererWin = new BrowserWindow({
        show: false,
        width: 32,
        height: 32,
        webPreferences: {
            offscreen: true
        }
    });
    await hiddenRendererWin.loadURL('about:blank');

    // Create system tray
    initTray();

    // Initial query and tray setup
    await updateTray();

    // Start background poll every 30 seconds
    pollTimer = setInterval(updateTray, 30000);

    // Sleep / Wake handling
    powerMonitor.on('resume', () => {
        setTimeout(updateTray, 2000);
    });
});

// Prevent exiting when windows close
app.on('window-all-closed', (e) => {
    if (!app.isQuitting) {
        e.preventDefault();
    }
});
