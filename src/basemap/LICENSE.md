# Offline map data

## OpenStreetMap

The city vector files are repackaged from Protomaps Basemap, distributed by
Protomaps as a Produced Work under the Open Data Commons Open Database
License (ODbL) 1.0. The underlying OpenStreetMap data are © OpenStreetMap
contributors and their contents are subject to the Database Contents License
(DbCL) 1.0. The repackaged city files are also available under ODbL 1.0.

- Attribution and source information: https://www.openstreetmap.org/copyright
- Protomaps distribution terms: https://docs.protomaps.com/basemaps/downloads
- Source archive: https://source.coop/protomaps/openstreetmap
- ODbL 1.0: https://opendatacommons.org/licenses/odbl/1-0/
- DbCL 1.0: https://opendatacommons.org/licenses/dbcl/1-0/

The source archive also credits [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/)
(public domain). The included
download script extracts city areas from the published archive, keeps the
geometry used by the game, and groups it by display layer. The OSM snapshot
timestamp is in each vector file. Gameplay uses the bundled files.
The city extracts include mapped land-use polygons for universities and
colleges, schools and kindergartens, and hospitals.

Each `.tiles` bundle concatenates individually gzip-compressed JSON tiles.
The matching `-index.js` file records each tile's byte offset and length,
as well as the source snapshot.

To regenerate the vectors, set `RAIL_MAP_TOOLS` to a directory containing
the [Protomaps CLI](https://docs.protomaps.com/pmtiles/cli) executable and install
`pmtiles`, `@mapbox/vector-tile`, and `pbf` in that directory with npm. Run
`node scripts/download-basemap.mjs vectors` from the project root. To refresh
the wider city extracts, run `node scripts/download-basemap.mjs regional`. To refresh
the terrain PNGs, run `node scripts/download-basemap.mjs terrain` with curl
available. These tools are only needed to refresh the assets.

## Natural Earth

The national map uses public-domain Natural Earth lakes and rivers
from the 1:50m physical datasets.

- Use and redistribution: https://www.naturalearthdata.com/about/terms-of-use/
- Physical datasets: https://www.naturalearthdata.com/downloads/50m-physical-vectors/

To regenerate the national bundle, install `shapefile` in `RAIL_MAP_TOOLS`
and extract the corresponding Natural Earth archives into the
`lakes` and `rivers` subdirectories. Run
`node scripts/download-basemap.mjs national`.

## National parks and forests

The public-land bundle contains simplified boundary polygons for the
contiguous U.S. Credit: National Park Service, Land Resources Division
(public domain), and U.S. Forest Service, Enterprise Data Warehouse
([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)). The coordinates
were generalized and rounded for use as an in-game map overlay.

- [NPS Administrative Boundaries of National Park System Units](https://catalog.data.gov/dataset/administrative-boundaries-of-national-park-system-units-national-geospatial-data-asset-ngd)
- [U.S. Forest Service Proclaimed Forests](https://catalog.data.gov/dataset/fs-national-forests-dataset-us-forest-service-proclaimed-forests)

To refresh these boundaries using the agency map services, run
`node scripts/download-basemap.mjs public-land` with curl available.

## Place names and Census boundaries

City, town, and neighborhood labels are selected from the GeoNames U.S.
gazetteer under the [Creative Commons Attribution 4.0 license](https://creativecommons.org/licenses/by/4.0/). The game credits
GeoNames in the status bar. The extracts select named populated places and
sections of populated places in the contiguous U.S.

- [GeoNames download and license terms](https://download.geonames.org/export/dump/)

County names, county lines, state lines, and the national land outline use
the U.S. Census Bureau 2025 county cartographic boundary file at 1:500,000.
Shared arcs are simplified together for four zoom levels. ZIP Code outlines and numbers use the Census
Bureau 2020 ZIP Code Tabulation Area file at 1:500,000. Both are listed as CC0. ZCTAs
are generalized statistical areas and can differ from postal delivery routes.
Game tiles project and round the source geometry.

- [Census county boundary dataset](https://catalog.data.gov/dataset/2025-cartographic-boundary-file-shp-county-and-equivalent-for-united-states-1-500000)
- [Census ZIP Code Tabulation Area dataset](https://catalog.data.gov/dataset/2020-cartographic-boundary-file-shp-2020-zip-code-tabulation-areas-for-united-states-1-500)

To regenerate the offline packs, extract `US.zip` from the GeoNames dump,
`cb_2025_us_county_500k.zip`, and `cb_2020_us_zcta520_500k.zip` into
`geonames-us`, `census-counties`, and `census-zips` under `RAIL_MAP_TOOLS`.
Run `node scripts/download-geography-data.mjs` with `shapefile`,
`topojson-server`, and `topojson-client` installed in that tools directory.

## USGS

The terrain PNGs are hillshade renders from the U.S. Geological Survey 3D
Elevation Program (3DEP) Bare Earth DEM service. USGS 3DEP data are public
domain. Credit: U.S. Geological Survey, 3D Elevation Program.
Run `node scripts/download-basemap.mjs corridors` to refresh the intercity
terrain tiles from the same source.

- Data and usage: https://www.usgs.gov/3d-elevation-program/about-3dep-products-services
- Source service: https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer
