# National Railway Network

A local Windows desktop game for designing and operating a railway network. The offline map covers the contiguous United States, with local detail around all eight starting cities. Construction uses geographic coordinates and meter-based geometry.

Select **U.S.** for the national view with state borders, major rivers, and lakes. Select **City** for main roads, then zoom further for local streets and building footprints. Each mapped carriageway is drawn as a single stroke, so divided highways show separate lines when their spacing is visible. The **Map** tool has independent toggles for state borders, water, roads, buildings, terrain relief, and parks and woodland. Local street detail covers roughly 10 km across around each starting city, with terrain relief extending beyond that area. For sources and redistribution terms, see [Offline map data](src/basemap/LICENSE.md).

The **Land-use colors** toggle controls the color fills for universities and colleges, schools, hospitals, national forests, and national parks. The Map tool shows the color key. Around each starting city, regional extracts extend roads, water, parks, and mapped land use to roughly 100 km across, with finer building and street detail in the original downtown area. Federal park and forest boundaries cover the contiguous U.S.

Offline terrain relief connects starting cities within 450 km of each other. The current corridor runs from Washington, D.C. to New York, and the **Terrain relief** toggle controls it.

The game reads offline map tiles for the viewport and a small margin around it. It loads the finer downtown tiles as you zoom in and releases decoded data as you move away.

Place names progress from major cities to smaller towns and neighborhoods as you zoom in. Under **Map → Boundaries**, State borders, County borders, and ZIP Code areas have independent toggles. County and ZIP Code layers start off and appear at closer zoom levels. ZIP Code areas use Census ZIP Code Tabulation Areas.

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
