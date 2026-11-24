import { createReadStream } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { mercator } from '../src/geometry.js';
import { geographyLayers } from '../src/geography-layers.js';
import { writeTilePack } from './write-tile-pack.mjs';
import { writeSharedBoundaries } from './build-shared-boundaries.mjs';

const tools = process.env.RAIL_MAP_TOOLS;
if (!tools) throw Error('Set RAIL_MAP_TOOLS to the directory with the extracted geography files.');
const directory = new URL('../src/basemap/',import.meta.url);
const circumference = mercator({lat:0,lon:180}).x*2;
const inside = (lon,lat) => lon >= -125 && lon <= -66 && lat >= 24 && lat <= 50;
const require = createRequire(join(tools,'package.json'));
const source = require('shapefile');

function tileGrid(zoom) {
  const size = circumference/2**zoom;
  const tiles = new Map();
  const project = (lon,lat) => {
    const {x,y} = mercator({lon,lat});
    return [(x+circumference/2)/size,(circumference/2-y)/size];
  };
  function tileAt(x,y) {
    const key = `${x},${y}`;
    if (!tiles.has(key)) tiles.set(key,{x,y,paths:{boundaries:[],labels:[]}});
    return tiles.get(key).paths;
  }
  function label(name,lon,lat,rank,type) {
    const [x,y] = project(lon,lat);
    tileAt(Math.floor(x),Math.floor(y)).labels.push([name,lon,lat,rank,type]);
  }
  function boundary(ring) {
    const points = ring.map(([lon,lat]) => project(lon,lat));
    const [x0,y0] = points[0];
    let west=x0,east=x0,north=y0,south=y0;
    for (const [x,y] of points) {
      west=Math.min(west,x);
      east=Math.max(east,x);
      north=Math.min(north,y);
      south=Math.max(south,y);
    }
    for (let y=Math.floor(north); y<=Math.floor(south); y++) {
      for (let x=Math.floor(west); x<=Math.floor(east); x++) {
        tileAt(x,y).boundaries.push(points.flatMap(([px,py]) => [Math.round((px-x)*4096),Math.round((py-y)*4096)]));
      }
    }
  }
  const list = () => [...tiles.values()].sort((a,b) => a.y-b.y || a.x-b.x);
  return {label,boundary,list};
}

async function loadPlaces(grid,majorOnly) {
  const file = createReadStream(join(tools,'geonames-us','US.txt'),{encoding:'utf8'});
  const classes = new Set(['PPLC','PPLA','PPLA2','PPLA3','PPLA4','PPL','PPLL','PPLX']);
  let count = 0;
  for await (const line of createInterface({input:file,crlfDelay:Infinity})) {
    const fields = line.split('\t');
    const [,name,,,latitude,longitude,kind,code] = fields;
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (kind !== 'P' || !classes.has(code) || !inside(lon,lat)) continue;
    const rank = Math.max(Number(fields[14]) || 0,code === 'PPLA' ? 100000 : code === 'PPLA2' ? 5000 : 0);
    if (majorOnly && (code === 'PPLX' || rank < 35000)) continue;
    grid.label(name,lon,lat,rank,code === 'PPLX' ? 'neighborhood' : 'place');
    count++;
  }
  return count;
}

async function loadBoundaries(grid,type) {
  const prefix = type === 'zips' ? 'cb_2020_us_zcta520_500k' : 'cb_2025_us_county_500k';
  const shapes = await source.open(join(tools,`census-${type}`,prefix+'.shp'));
  const counties = [];
  let count = 0;
  for (let item = await shapes.read(); !item.done; item = await shapes.read()) {
    const {geometry,properties} = item.value;
    if (!geometry || (type === 'counties' && ['02','15','60','66','69','72','78'].includes(properties.STATEFP))) continue;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    const candidates = polygons.filter(([outer]) => outer.some(([lon,lat]) => inside(lon,lat)));
    if (!candidates.length) continue;
    const main = candidates.reduce((a,b) => b[0].length > a[0].length ? b : a);
    if (type === 'counties') {
      counties.push({properties:{STATEFP:properties.STATEFP},geometry:{coordinates:candidates}});
    } else {
      for (const polygon of candidates) for (const ring of polygon) grid.boundary(ring);
    }
    const name = type === 'zips' ? properties.ZCTA5CE20 : properties.NAMELSAD;
    let lon = Number(properties.INTPTLON);
    let lat = Number(properties.INTPTLAT);
    if (!inside(lon,lat)) {
      const [first,...points] = main[0];
      const [sumLon,sumLat] = points.reduce(([x,y],[px,py]) => [x+px,y+py],first);
      lon = sumLon/main[0].length;
      lat = sumLat/main[0].length;
    }
    if (name) grid.label(name,lon,lat,Number(properties.ALAND ?? properties.ALAND20) || 0,type);
    count++;
  }
  if (counties.length) await writeSharedBoundaries(directory,counties,{
    topology:require('topojson-server').topology,
    mergeArcs:require('topojson-client').mergeArcs,
  });
  return count;
}

for (const type of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(geographyLayers)) {
  const {bundle,tileZoom} = geographyLayers[type];
  const grid = tileGrid(tileZoom);
  const places = type === 'places' || type === 'majorPlaces';
  const count = await (places ? loadPlaces(grid,type === 'majorPlaces') : loadBoundaries(grid,type));
  const tiles = grid.list();
  if (!count) throw Error(`No geography features found for ${type}.`);
  await writeTilePack(directory,bundle,tiles,places ? '2026-11' : type === 'zips' ? '2020' : '2025',
    places ? 'GeoNames' : 'U.S. Census Bureau');
  console.log(type,count,tiles.length);
}
