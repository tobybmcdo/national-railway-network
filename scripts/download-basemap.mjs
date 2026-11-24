import { execFile, execFileSync } from 'node:child_process';
import { access, mkdir, open, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { cities } from '../src/railway.js';
import { mercator } from '../src/geometry.js';
import { corridorTiles, corridorTileSize } from '../src/terrain-corridors.js';
import { writeTilePack } from './write-tile-pack.mjs';

const directory = new URL('../src/basemap/', import.meta.url);
const archiveUrl = 'https://data.source.coop/protomaps/openstreetmap/tiles/v3.pmtiles';
const greenKinds = new Set(['park','garden','nature_reserve','forest','wood','grass','recreation_ground','meadow','national_park','protected_area','village_green','scrub']);
const civicKinds = {
  university:'universities',college:'universities',
  school:'schools',kindergarten:'schools',hospital:'hospitals',
};
const [mode,...indexes] = process.argv.slice(2);
if (!['vectors','regional','terrain','corridors','national','public-land'].includes(mode)) {
  throw Error('Specify vectors, regional, terrain, corridors, national, or public-land.');
}
const selected = indexes.length ? indexes.map(Number) : cities.map((_city,index) => index);
await mkdir(directory,{recursive:true});

function tilePosition(lon,lat,zoom) {
  const tileCount = 2**zoom;
  const {x,y} = mercator({lon,lat});
  const circumference = 2*Math.PI*6371000;
  return [Math.floor((x/circumference+.5)*tileCount),Math.floor((.5-y/circumference)*tileCount)];
}

async function vectorData(city,key) {
  const regional = mode === 'regional';
  const zoom = regional ? 12 : 15;
  const longitudeSpan = regional ? .65 : .06;
  const latitudeSpan = regional ? .5 : .048;
  if (regional) key += '-regional';
  const tools = process.env.RAIL_MAP_TOOLS;
  if (!tools) throw Error('Set RAIL_MAP_TOOLS to a directory containing pmtiles and the extraction packages.');
  const requireFromTools = createRequire(join(tools,'package.json'));
  const { PMTiles } = await import(pathToFileURL(requireFromTools.resolve('pmtiles')));
  const { VectorTile } = await import(pathToFileURL(requireFromTools.resolve('@mapbox/vector-tile')));
  const { PbfReader } = await import(pathToFileURL(requireFromTools.resolve('pbf')));
  const bbox = [city.lon-longitudeSpan,city.lat-latitudeSpan,city.lon+longitudeSpan,city.lat+latitudeSpan];
  const archivePath = join(tools,`${key}.pmtiles`);
  try {
    await access(archivePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    execFileSync(join(tools,process.platform === 'win32' ? 'pmtiles.exe' : 'pmtiles'),
      ['extract',archiveUrl,archivePath,`--bbox=${bbox}`,`--minzoom=${zoom}`,`--maxzoom=${zoom}`],
      {timeout:120000});
  }
  const file = await open(archivePath);
  try {
    const archive = new PMTiles({
      getKey:() => archivePath,
      async getBytes(offset,length) {
        const data = new ArrayBuffer(length);
        const {bytesRead} = await file.read(new Uint8Array(data),0,length,offset);
        return {data:data.slice(0,bytesRead)};
      },
    });
    const meta = await archive.getMetadata();
    const [west,south,east,north] = bbox;
    const [left,top] = tilePosition(west,north,zoom);
    const [right,bottom] = tilePosition(east,south,zoom);
    const tiles = [];
    const counts = {roads:0,mainRoads:0,buildings:0,green:0,water:0,streams:0,universities:0,schools:0,hospitals:0};
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const result = await archive.getZxy(zoom,x,y);
        if (!result) continue;
        const tile = new VectorTile(new PbfReader(new Uint8Array(result.data)));
        const paths = Object.fromEntries(Object.keys(counts).map(layer => [layer,[]]));
        for (const name of ['roads','buildings','landuse','natural','water','physical_line']) {
          const layer = tile.layers[name];
          if (!layer) continue;
          for (let index = 0; index < layer.length; index++) {
            const feature = layer.feature(index);
            const kind = feature.properties['pmap:kind'];
            const detail = feature.properties['pmap:kind_detail'];
            const target = name === 'buildings' && feature.type === 3 ? 'buildings'
              : name === 'roads' && feature.type === 2 && ['highway','major_road'].includes(kind) ? 'mainRoads'
              : name === 'roads' && feature.type === 2 && kind === 'minor_road' && !['service','track'].includes(detail) ? 'roads'
              : name === 'water' && feature.type === 3 ? 'water'
              : (name === 'water' || name === 'physical_line') && feature.type === 2 && ['river','stream','canal','drain','ditch','riverbank','waterway'].includes(kind) ? 'streams'
              : name === 'landuse' && feature.type === 3 && Object.hasOwn(civicKinds,kind) ? civicKinds[kind]
              : (name === 'landuse' || name === 'natural') && feature.type === 3 && greenKinds.has(kind) ? 'green' : null;
            if (!target) continue;
            for (const line of feature.loadGeometry()) {
              paths[target].push(line.flatMap(point => [
                Math.round(point.x*4096/feature.extent),Math.round(point.y*4096/feature.extent),
              ]));
            }
            counts[target]++;
          }
        }
        tiles.push({x,y,paths});
      }
    }
    if (!counts.mainRoads || (!regional && (!counts.roads || !counts.buildings))) {
      throw Error(`Missing map detail for ${city.name}.`);
    }
    await writeTilePack(directory,key,tiles,meta['planetiler:osm:osmosisreplicationtime']);
    console.log(city.name,counts);
  } finally {
    await file.close();
  }
}

const download = promisify(execFile);
async function terrainData({x,y},key,radius,pixels) {
  const scale = 6378137/6371000; // EPSG:3857 uses the WGS84 semi-major axis.
  const bounds = [x-radius,y-radius,x+radius,y+radius].map(value => value*scale);
  const params = new URLSearchParams({
    bbox:bounds.join(','),bboxSR:'3857',imageSR:'3857',size:`${pixels},${pixels}`,format:'png32',
    renderingRule:JSON.stringify({rasterFunction:'Hillshade'}),f:'image',
  });
  const endpoint = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';
  const curl = process.platform === 'win32' ? 'curl.exe' : 'curl';
  const {stdout:image} = await download(curl,['-fsSL','--max-time','35','--retry','2',`${endpoint}?${params}`],
    {encoding:'buffer',maxBuffer:5_000_000});
  if (image.toString('hex',0,8) !== '89504e470d0a1a0a' || image.readUInt32BE(16) !== pixels || image.readUInt32BE(20) !== pixels) {
    throw Error(`Invalid USGS hillshade for ${key}.`);
  }
  await writeFile(new URL(`${key}-terrain.png`,directory),image);
  console.log(key,image.length);
}

async function nationalData() {
  const tools = process.env.RAIL_MAP_TOOLS;
  if (!tools) throw Error('Set RAIL_MAP_TOOLS to the directory containing the Natural Earth shapefiles and extraction packages.');
  const shape = createRequire(join(tools,'package.json'))('shapefile');
  const inside = ([lon,lat]) => lon >= -126 && lon <= -65 && lat >= 24 && lat <= 50;
  const data = {lakes:[],greatLakes:[],rivers:[]};
  const sources = [
    ['lakes','ne_50m_lakes'],
    ['rivers','ne_50m_rivers_lake_centerlines'],
  ];
  for (const [folder,name] of sources) {
    const source = await shape.open(join(tools,folder,`${name}.shp`));
    for (let result = await source.read(); !result.done; result = await source.read()) {
      const {properties,geometry} = result.value;
      if (!geometry) continue;
      if (folder === 'rivers' && properties.featurecla !== 'River') continue;
      const {type,coordinates} = geometry;
      const paths = type === 'MultiPolygon' ? coordinates.flat()
        : type === 'LineString' ? [coordinates] : coordinates;
      const layer = folder === 'rivers' ? 'rivers'
        : /^(Lake )?(Superior|Michigan|Huron|Erie|Ontario)$/.test(properties.name ?? '') ? 'greatLakes' : 'lakes';
      for (const path of paths) {
        if (path.some(inside)) data[layer].push(path.flatMap(point => point.slice(0,2).map(value => Math.round(value*1e4)/1e4)));
      }
    }
  }
  for (const [layer,paths] of Object.entries(data)) {
    if (!paths.length) throw Error(`Missing national map layer ${layer}.`);
  }
  await writeFile(new URL('national-data.js',directory),
    `// Natural Earth, public domain. See LICENSE.md.\nexport default ${JSON.stringify(data)};\n`);
  console.log(Object.fromEntries(Object.entries(data).map(([layer,paths]) => [layer,paths.length])));
}

async function publicLandData() {
  const sources = [
    ['nationalForests','https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_ProclaimedForestBoundaries_01/MapServer/0/query',
      '1=1','forestname'],
    ['nationalParks','https://services1.arcgis.com/fBc8EJBxQRMcHlei/ArcGIS/rest/services/NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/2/query',
      "UNIT_TYPE LIKE 'National Park%'",'UNIT_NAME,UNIT_TYPE'],
  ];
  const curl = process.platform === 'win32' ? 'curl.exe' : 'curl';
  const data = {};
  for (const [layer,endpoint,where,outFields] of sources) {
    const params = new URLSearchParams({
      where,outFields,geometry:'-126,24,-65,50',geometryType:'esriGeometryEnvelope',
      inSR:'4326',outSR:'4326',maxAllowableOffset:'0.001',f:'geojson',
    });
    const raw = execFileSync(curl,['-fsSL','--max-time','35',`${endpoint}?${params}`],{maxBuffer:10_000_000});
    const response = JSON.parse(raw);
    if (!response.features?.length || response.exceededTransferLimit) {
      throw Error(`Incomplete ${layer} data: ${response.error?.message ?? 'missing or truncated features'}`);
    }
    data[layer] = response.features.flatMap(({geometry}) => {
      if (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon') return [];
      const rings = geometry.type === 'MultiPolygon' ? geometry.coordinates.flat() : geometry.coordinates;
      return rings.map(ring => ring.flatMap(point => point.slice(0,2).map(value => Math.round(value*1e4)/1e4)));
    });
    if (!data[layer].length) throw Error(`Missing polygon boundaries for ${layer}.`);
    console.log(layer,response.features.length);
  }
  await writeFile(new URL('public-land-data.js',directory),
    `// U.S. Forest Service and National Park Service. See LICENSE.md.\nexport default ${JSON.stringify(data)};\n`);
}

if (mode === 'national') await nationalData();
else if (mode === 'public-land') await publicLandData();
else if (mode === 'corridors') {
  for (let index = 0; index < corridorTiles.length; index += 4) {
    const batch = corridorTiles.slice(index,index+4);
    await Promise.all(batch.map(tile => terrainData(tile,tile.key,corridorTileSize/2,640)));
  }
}
else {
  for (const index of selected) {
    const city = cities[index];
    const key = city.name.split(',')[0].toLowerCase().replaceAll(' ','-');
    if (mode === 'terrain') await terrainData(mercator(city),key,18000,400);
    else await vectorData(city,key);
  }
}
