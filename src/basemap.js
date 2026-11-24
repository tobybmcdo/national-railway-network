import { mercator } from './geometry.js';
import { cities } from './railway.js';
import nationalData from './basemap/national-data.js';
import publicLandData from './basemap/public-land-data.js';
import { corridorTiles, corridorTileSize } from './terrain-corridors.js';
import { geographyLayers, mapLayerEnabled } from './geography-layers.js';
import { boundariesForZoom, strokeBoundaryGroups } from './map-boundaries.js';
import majorPlacesIndex from './basemap/geo-major-places-index.js';
import placesIndex from './basemap/geo-places-index.js';
import countiesIndex from './basemap/geo-counties-index.js';
import zipsIndex from './basemap/geo-zips-index.js';

export const landUseStyles = {
  universities:{label:'Universities and colleges',color:'#303a53'},
  schools:{label:'Schools',color:'#393e38'},
  hospitals:{label:'Hospitals',color:'#3b3647'},
  nationalForests:{label:'National forests',color:'#1d4140'},
  nationalParks:{label:'National parks',color:'#24504a'},
};

const terrainRadius = 18000;
const tileExtent = 4096;
const tilePadding = 128;
const maxTileReads = 6;
const streamZoom = .05;
const circumference = mercator({lat:0,lon:180}).x*2;
const detailTileWidth = circumference/2**15;
const regionalTileWidth = circumference/2**12;
const regions = cities.map(city => ({
  key:city.name.split(',')[0].toLowerCase().replaceAll(' ','-'),
  center:mercator(city),
}));
const geographyIndexes = {majorPlaces:majorPlacesIndex,places:placesIndex,counties:countiesIndex,zips:zipsIndex};
let wantedTiles = new Map();
const decodedTiles = new Map();
const pendingTiles = new Set();
let refreshFrame = 0;
const refreshCallbacks = new Set();
export let basemapRevision = 0;
const cityTerrain = regions
  .map(({key,center}) => ({key,...center}))
  .filter(city => !corridorTiles.some(tile =>
    Math.abs(tile.x-city.x) <= corridorTileSize/2 && Math.abs(tile.y-city.y) <= corridorTileSize/2));

function releaseTerrain(tile) {
  if (!tile.image) return;
  tile.image.onload = null;
  delete tile.image;
}

function drawTerrain(ctx,tiles,tileSize,origin,zoom,width,height,repaint,enabled) {
  const size = tileSize*zoom;
  ctx.save();
  ctx.globalAlpha = .30;
  ctx.globalCompositeOperation = 'soft-light';
  for (const tile of tiles) {
    const left = width/2+(tile.x-origin.x)*zoom-size/2;
    const top = height/2+(origin.y-tile.y)*zoom-size/2;
    if (left+size <= 0 || left >= width || top+size <= 0 || top >= height) {
      releaseTerrain(tile);
      continue;
    }
    if (!enabled) continue;
    if (!tile.image) {
      tile.image = new Image();
      tile.image.onload = () => refreshMap(repaint);
      tile.image.src = new URL(`./basemap/${tile.key}-terrain.png`,import.meta.url).href;
    }
    if (tile.image.naturalWidth) ctx.drawImage(tile.image,left,top,size,size);
  }
  ctx.restore();
}

function makePaths(data, project) {
  return Object.fromEntries(Object.entries(data).map(([layer,features]) => {
    const path = new Path2D();
    for (const coordinates of features) {
      for (let index = 0; index < coordinates.length; index += 2) {
        const x = coordinates[index];
        const y = coordinates[index+1];
        if (project) {
          const point = project({lon:x,lat:y});
          if (index === 0) path.moveTo(point.x,-point.y);
          else path.lineTo(point.x,-point.y);
          continue;
        }
        if (index === 0) path.moveTo(x,y);
        else path.lineTo(x,y);
      }
    }
    return [layer,path];
  }));
}

const {lakes,greatLakes,rivers} = makePaths(nationalData,mercator);
const publicLandPaths = makePaths(publicLandData,mercator);

function drawLandUse(ctx,paths) {
  for (const [layer,path] of Object.entries(paths)) {
    const style = landUseStyles[layer];
    if (style) {
      ctx.fillStyle = style.color;
      ctx.fill(path);
    }
  }
}

export function drawNationalMap(ctx,camera,width,height,layers,repaint) {
  const {zoom} = camera;
  const {x,y} = mercator(camera.center);
  const boundaries = boundariesForZoom(zoom,() => refreshMap(repaint));
  const {land} = boundaries;
  ctx.save();
  ctx.translate(width/2-x*zoom,height/2+y*zoom);
  ctx.scale(zoom,zoom);
  if (layers.water !== false && zoom < .008) {
    ctx.fillStyle = '#123d54';
    ctx.fill(greatLakes,'evenodd');
  }
  ctx.fillStyle = '#102d3d';
  ctx.fill(land,'evenodd');
  ctx.clip(land,'evenodd');
  if (layers.landUse !== false) drawLandUse(ctx,publicLandPaths);
  if (layers.water !== false && zoom < .008) {
    ctx.fillStyle = '#123d54';
    ctx.strokeStyle = '#34718b';
    ctx.lineWidth = .85/zoom;
    ctx.stroke(rivers);
    ctx.fill(lakes,'evenodd');
  }
  ctx.restore();
  return boundaries;
}

export function drawNationalBorders(ctx,camera,width,height,layers,boundaries) {
  const {zoom} = camera;
  const {x,y} = mercator(camera.center);
  const showCounties = layers.counties === true && zoom >= geographyLayers.counties.minZoom;
  ctx.save();
  ctx.translate(width/2-x*zoom,height/2+y*zoom);
  ctx.scale(zoom,zoom);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (showCounties) {
    ctx.strokeStyle = '#718299';
    ctx.lineWidth = .85/zoom;
    strokeBoundaryGroups(ctx,boundaries.counties,x,-y,width,height,zoom);
  }
  if (layers.states !== false || showCounties) {
    ctx.strokeStyle = layers.states === false ? '#718299' : '#537488';
    ctx.lineWidth = .85/zoom;
    strokeBoundaryGroups(ctx,boundaries.states,x,-y,width,height,zoom);
  }
  ctx.strokeStyle = '#48687a';
  ctx.lineWidth = 1.4/zoom;
  ctx.stroke(boundaries.land);
  ctx.restore();
}

function refreshMap(repaint) {
  if (repaint) refreshCallbacks.add(repaint);
  if (refreshFrame) return;
  refreshFrame = requestAnimationFrame(() => {
    refreshFrame = 0;
    basemapRevision++;
    const callbacks = [...refreshCallbacks];
    refreshCallbacks.clear();
    for (const callback of callbacks) callback();
  });
}

function readVisibleTiles(repaint) {
  const available = [...wantedTiles.values()]
    .filter(tile => !decodedTiles.has(tile.key) && !pendingTiles.has(tile.key))
    .sort((a,b) => Number(b.visible)-Number(a.visible) || a.distance-b.distance);
  for (const tile of available.slice(0,Math.max(0,maxTileReads-pendingTiles.size))) {
    pendingTiles.add(tile.key);
    window.railwayMap.readTile(tile.bundle,tile.id).then(async bytes => {
      if (!wantedTiles.has(tile.key)) return;
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      const {labels=[],...paths} = await new Response(stream).json();
      if (wantedTiles.has(tile.key)) decodedTiles.set(tile.key,{paths,drawPaths:{},labels});
    }).catch(error => {
      if (wantedTiles.has(tile.key)) decodedTiles.set(tile.key,null);
      console.error('Could not load offline map tile ' + tile.key,error);
    }).finally(() => {
      pendingTiles.delete(tile.key);
      if (wantedTiles.size) {
        readVisibleTiles(repaint);
        refreshMap(repaint);
      }
    });
  }
}

export function clearMapTiles() {
  wantedTiles.clear();
  decodedTiles.clear();
  if (refreshFrame) cancelAnimationFrame(refreshFrame);
  refreshFrame = 0;
  refreshCallbacks.clear();
  for (const tile of [...corridorTiles,...cityTerrain]) releaseTerrain(tile);
}

function bundleIndex(region,kind,repaint) {
  if (!region[kind]) {
    const bundle = kind === 'detail' ? region.key : `${region.key}-regional`;
    region[kind] = {bundle};
    loadIndex(region[kind],repaint);
  }
  return region[kind];
}

function loadIndex(entry,repaint) {
  import(`./basemap/${entry.bundle}-index.js`).then(({default:data}) => {
    Object.assign(entry,data);
    refreshMap(repaint);
  }).catch(error => console.error('Could not load offline map index ' + entry.bundle,error));
}

export function drawBasemap(ctx, camera, width, height, layers, repaint) {
  const { zoom } = camera;
  if (zoom < geographyLayers.majorPlaces.minZoom) {
    clearMapTiles();
    return [];
  }
  const origin = mercator(camera.center);
  if (zoom >= .001) drawTerrain(ctx,corridorTiles,corridorTileSize,origin,zoom,width,height,repaint,layers.terrain !== false);
  else corridorTiles.forEach(releaseTerrain);
  if (zoom >= .008) drawTerrain(ctx,cityTerrain,terrainRadius*2,origin,zoom,width,height,repaint,layers.terrain !== false);
  else cityTerrain.forEach(releaseTerrain);
  const nextTiles = new Map();
  if (zoom >= .008) for (const region of regions) {
    const x = width/2 + (region.center.x-origin.x)*zoom;
    const y = height/2 + (origin.y-region.center.y)*zoom;
    const reach = 100000*zoom+tilePadding;
    if (x+reach < 0 || x-reach > width || y+reach < 0 || y-reach > height) continue;
    const showBuildings = layers.buildings !== false && zoom >= .032;
    if (!showBuildings && [layers.roads,layers.green,layers.water,layers.landUse].every(layer => layer === false)) continue;
    const detailReach = 10000*zoom+tilePadding;
    const useDetail = zoom >= .032 && Math.abs(x-width/2) <= width/2+detailReach && Math.abs(y-height/2) <= height/2+detailReach;
    const detail = useDetail ? visibleTiles(bundleIndex(region,'detail',repaint),detailTileWidth) : null;
    const regional = detail?.coversViewport ? [] : visibleTiles(bundleIndex(region,'regional',repaint),regionalTileWidth).ready;
    ctx.save();
    if (detail?.ready.length && regional.length) {
      ctx.beginPath();
      ctx.rect(0,0,width,height);
      for (const {left,top,size} of detail.ready) ctx.rect(left,top,size,size);
      ctx.clip('evenodd');
    }
    drawTiles(regional);
    ctx.restore();
    if (detail) drawTiles(detail.ready);
  }
  const labels = [];
  for (const [layer,{bundle,tileZoom,minZoom,maxZoom = Infinity,control = layer}] of Object.entries(geographyLayers)) {
    if (zoom < minZoom || zoom >= maxZoom || !mapLayerEnabled(layers,control)) continue;
    const {ready} = visibleTiles({bundle,...geographyIndexes[layer]},circumference/2**tileZoom);
    for (const entry of ready) {
      for (const label of entry.tile.labels) labels.push(label);
      if (layer === 'zips') drawZipBoundary(entry);
    }
  }
  wantedTiles = nextTiles;
  for (const key of decodedTiles.keys()) {
    if (!wantedTiles.has(key)) decodedTiles.delete(key);
  }
  readVisibleTiles(repaint);
  return labels;

  function drawZipBoundary({tile,left,top,size}) {
    if (!tile.drawPaths.boundaries) {
      tile.drawPaths = makePaths(tile.paths);
      delete tile.paths.boundaries;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(left,top,size,size);
    ctx.clip();
    ctx.translate(left,top);
    ctx.scale(size/tileExtent,size/tileExtent);
    ctx.strokeStyle = '#8b7967';
    ctx.lineWidth = .85*tileExtent/size;
    ctx.stroke(tile.drawPaths.boundaries);
    ctx.restore();
  }

  function visibleTiles({bundle,bounds,index},tileWidth) {
    if (!bounds) return {ready:[],coversViewport:false};
    const [minX,minY,maxX,maxY] = bounds;
    const size = tileWidth*zoom;
    const mapLeft = width/2-(circumference/2+origin.x)*zoom;
    const mapTop = height/2-(circumference/2-origin.y)*zoom;
    const firstX = Math.max(minX,Math.floor((-tilePadding-mapLeft)/size));
    const firstY = Math.max(minY,Math.floor((-tilePadding-mapTop)/size));
    const lastX = Math.min(maxX,Math.floor((width+tilePadding-mapLeft)/size));
    const lastY = Math.min(maxY,Math.floor((height+tilePadding-mapTop)/size));
    const ready = [];
    let coversViewport = mapLeft+minX*size <= -tilePadding && mapTop+minY*size <= -tilePadding
      && mapLeft+(maxX+1)*size >= width+tilePadding && mapTop+(maxY+1)*size >= height+tilePadding;
    for (let y = firstY; y <= lastY; y++) {
      for (let x = firstX; x <= lastX; x++) {
        const id = `${x},${y}`;
        if (!index[id]) {
          coversViewport = false;
          continue;
        }
        const key = `${bundle}/${id}`;
        const left = mapLeft+x*size;
        const top = mapTop+y*size;
        const visible = left+size > 0 && left < width && top+size > 0 && top < height;
        const distance = Math.hypot(
          Math.max(0,left-width/2,width/2-left-size),
          Math.max(0,top-height/2,height/2-top-size),
        );
        nextTiles.set(key,{key,bundle,id,visible,distance});
        const tile = decodedTiles.get(key);
        if (tile && visible) ready.push({tile,left,top,size});
      }
    }
    return {ready,coversViewport};
  }

  function drawTiles(tiles) {
    const showBuildings = layers.buildings !== false && zoom >= .032;
    const showStreams = layers.water !== false && zoom >= streamZoom;
    for (const {tile,left,top,size} of tiles) {
      for (const [layer,paths] of Object.entries(tile.paths)) {
        if (layer === 'buildings' && !showBuildings) continue;
        if (layer === 'streams' && !showStreams) continue;
        Object.assign(tile.drawPaths,makePaths({[layer]:paths}));
        delete tile.paths[layer];
      }
      const { green,water,streams,roads,mainRoads,buildings } = tile.drawPaths;
      ctx.save();
      ctx.beginPath();
      ctx.rect(left,top,size,size);
      ctx.clip();
      ctx.translate(left,top);
      ctx.scale(size/tileExtent,size/tileExtent);
      if (layers.green !== false) {
        ctx.fillStyle = '#215347';
        ctx.fill(green);
      }
      if (layers.landUse !== false) drawLandUse(ctx,tile.drawPaths);
      if (layers.water !== false) {
        if (showStreams) {
          ctx.strokeStyle = '#34718b';
          ctx.lineWidth = tileExtent/size;
          ctx.stroke(streams);
        }
        ctx.fillStyle = '#144763';
        ctx.fill(water);
      }
      if (showBuildings) {
        ctx.fillStyle = '#718394';
        ctx.fill(buildings);
      }
      if (layers.roads !== false) {
        ctx.strokeStyle = '#617a90';
        ctx.lineWidth = .85*tileExtent/size;
        if (zoom >= .032) ctx.stroke(roads);
        ctx.strokeStyle = '#809bb0';
        ctx.lineWidth = 1.15*tileExtent/size;
        ctx.stroke(mainRoads);
      }
      ctx.restore();
    }
  }
}
