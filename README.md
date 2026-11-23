# National Railway Network

A local Windows desktop game for designing and operating a railway network. The current map bundles a schematic outline of the contiguous United States and eight starting cities. Construction uses geographic coordinates and meter-based geometry.

## Run the game

From the project folder with Node.js and npm installed:

```powershell
npm.cmd ci
npm.cmd start
```

The first installation needs access to npm and the Electron release download. The game and saves work offline after installation. Start with **New World** or open one of the three save slots. **Tutorial** walks through building and operating your first line.

## Run tests

```powershell
npm.cmd test
npm.cmd run test:desktop
```

The desktop smoke test uses an isolated window and temporary saves. It exercises city selection, construction, route setup, map layers, and saving.
