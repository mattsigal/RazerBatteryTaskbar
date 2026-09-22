const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist', 'RazerBatteryTaskbar-win32-x64');
const electronDist = path.join(rootDir, 'node_modules', 'electron', 'dist');

console.log('[Build] Cleaning previous dist...');
if (fs.existsSync(path.join(rootDir, 'dist'))) {
    fs.rmSync(path.join(rootDir, 'dist'), { recursive: true, force: true });
}

console.log('[Build] Copying Electron binaries...');
fs.cpSync(electronDist, distDir, { recursive: true });

// Rename electron.exe to RazerBatteryTaskbar.exe
const origExe = path.join(distDir, 'electron.exe');
const targetExe = path.join(distDir, 'RazerBatteryTaskbar.exe');
if (fs.existsSync(origExe)) {
    fs.renameSync(origExe, targetExe);
}

console.log('[Build] Preparing app resources...');
const appDest = path.join(distDir, 'resources', 'app');
fs.mkdirSync(appDest, { recursive: true });

// Copy package.json
fs.copyFileSync(path.join(rootDir, 'package.json'), path.join(appDest, 'package.json'));

// Copy src
fs.cpSync(path.join(rootDir, 'src'), path.join(appDest, 'src'), { recursive: true });

// Copy all production dependencies
const appNodeModules = path.join(appDest, 'node_modules');
fs.mkdirSync(appNodeModules, { recursive: true });

const modulesToCopy = [
    'node-hid',
    'pkg-prebuilds',
    'node-addon-api',
    'electron-squirrel-startup'
];

for (const mod of modulesToCopy) {
    const srcMod = path.join(rootDir, 'node_modules', mod);
    if (fs.existsSync(srcMod)) {
        fs.cpSync(srcMod, path.join(appNodeModules, mod), { recursive: true });
    }
}

console.log(`[Build] Standalone build complete at:\n  ${distDir}\n  Executable: ${targetExe}`);
