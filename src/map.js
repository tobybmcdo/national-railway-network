import { createProjection, mercator, offsetPoint } from './geometry.js';
import { cities, stationCenter } from './railway.js';
import { basemapRevision, drawBasemap, drawNationalBorders, drawNationalMap } from './basemap.js';
import { mapLayerEnabled } from './geography-layers.js';

export const layerOptions = {
  tracks:'Track', trains:'Moving trains', routes:'Route lines', arrows:'Route direction',
  stationNames:'Station names', stationFootprints:'Station footprints', cities:'Place names',
  roads:'Roads', buildings:'Buildings', terrain:'Terrain relief', water:'Water', green:'Parks and woodland',
  states:'State borders', counties:'County borders', zips:'ZIP Code areas', landUse:'Land-use colors',
};
const gridSteps = [.0002,.0005,.001,.002,.005,.01,.02,.05,.1,.2,.5,1,2];
const metersPerDegree = mercator({lat:0,lon:1}).x;
const basemapLayers = ['states','counties','zips','landUse','water','terrain','roads','buildings','green','cities'];
const backgrounds = new WeakMap();
const pathBounds = new WeakMap();
const startingCityKeys = cities.map(city => ({...city,key:city.name.split(',')[0].toLowerCase()}));

function boundsFor(points) {
  let bounds = pathBounds.get(points);
  if (!bounds) {
    bounds = {west:Infinity,east:-Infinity,south:Infinity,north:-Infinity};
    for (const {lat,lon} of points) {
      bounds.west = Math.min(bounds.west,lon);
      bounds.east = Math.max(bounds.east,lon);
      bounds.south = Math.min(bounds.south,lat);
      bounds.north = Math.max(bounds.north,lat);
    }
    pathBounds.set(points,bounds);
  }
  return bounds;
}

function drawingTools(ctx,project,width,height) {
  function line(points, color, weight) {
    ctx.beginPath();
    points.forEach((point, index) => {
      const { x,y } = project(point);
      if (index) ctx.lineTo(x,y);
      else ctx.moveTo(x,y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = weight;
    ctx.stroke();
  }
  function mark(point, size, color, label) {
    const { x,y } = project(point);
    if (x < -70 || y < -30 || x > width+30 || y > height+30) return;
    ctx.beginPath();
    ctx.arc(x,y,size,0,Math.PI*2);
    ctx.fillStyle = color;
    ctx.fill();
    if (label) {
      ctx.font = '13px system-ui';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#031926';
      ctx.strokeText(label,x+9,y-7);
      ctx.fillStyle = '#e9f3f0';
      ctx.fillText(label,x+9,y-7);
    }
  }
  return {line,mark};
}

function drawBackground(ctx,camera,projection,width,height,layers,world,options) {
  const {line,mark} = drawingTools(ctx,projection.project,width,height);
  const boundaries = drawNationalMap(ctx,camera,width,height,layers,options.repaint);
  if (camera.zoom > .0004) {
    const step = gridSteps.find(degrees => degrees*metersPerDegree*camera.zoom >= 48);
    const nw = projection.unproject({ x:0,y:0 });
    const se = projection.unproject({ x:width,y:height });
    for (let lon = Math.ceil(nw.lon/step)*step; lon < se.lon; lon += step) {
      line([{lat:nw.lat,lon},{lat:se.lat,lon}],'#a4c6dc23',1);
    }
    for (let lat = Math.ceil(se.lat/step)*step; lat < nw.lat; lat += step) {
      line([{lat,lon:nw.lon},{lat,lon:se.lon}],'#a4c6dc23',1);
    }
  }
  const labels = world ? drawBasemap(ctx,camera,width,height,layers,options.repaint) : [];
  drawNationalBorders(ctx,camera,width,height,layers,boundaries);
  if (layers.cities !== false) {
    for (const city of cities) mark(city,options.picker ? 6 : 3,'#b9cdda',city.name);
  }
  if (labels.length) drawGeographyLabels(ctx,projection,width,height,camera.zoom,labels,layers.cities !== false);
}

function drawGeographyLabels(ctx,projection,width,height,zoom,labels,showCities) {
  const {project,unproject} = projection;
  const northwest = unproject({x:0,y:0});
  const southeast = unproject({x:width,y:height});
  const occupied = [];
  ctx.font = '13px system-ui';
  if (showCities) for (const city of cities) {
    const {x,y} = project(city);
    occupied.push({left:x-5,right:x+14+ctx.measureText(city.name).width,top:y-23,bottom:y+5});
  }
  const population = zoom >= .032 ? 0 : zoom >= .012 ? 500 : zoom >= .003 ? 5000 : zoom >= .001 ? 35000 : 200000;
  const candidates = labels.filter(([name,lon,lat,rank,type]) => {
    if (!(lon >= northwest.lon && lon <= southeast.lon && lat <= northwest.lat && lat >= southeast.lat)) return false;
    if (type === 'place') {
      if (rank < population) return false;
      const key = name.toLowerCase().replace(/ city$/,'');
      return !startingCityKeys.some(city => city.key === key && Math.abs(city.lat-lat) < .16 && Math.abs(city.lon-lon) < .16);
    }
    if (type === 'neighborhood') return zoom >= .028;
    if (type === 'zips') return zoom >= .004;
    return zoom >= .0016;
  });
  const priority = ([,,,rank,type]) => {
    if (type === 'place') return rank >= 5000 ? 0 : 4;
    if (type === 'neighborhood') return 1;
    return type === 'counties' ? 2 : 3;
  };
  candidates.sort((a,b) => priority(a)-priority(b) || b[3]-a[3] || a[0].localeCompare(b[0]));
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#031926';
  ctx.lineWidth = 3;
  for (const [name,lon,lat,,type] of candidates) {
    const {x,y} = project({lon,lat});
    ctx.font = type === 'place' ? '12px system-ui' : '11px system-ui';
    const half = ctx.measureText(name).width/2+7;
    const box = {left:x-half,right:x+half,top:y-10,bottom:y+10};
    if (occupied.some(other => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)) continue;
    occupied.push(box);
    ctx.fillStyle = type === 'zips' ? '#e7c4a4' : type === 'counties' ? '#b3c1d4' : '#d6e7ed';
    ctx.strokeText(name,x,y);
    ctx.fillText(name,x,y);
  }
  ctx.restore();
}

export function drawMap(canvas, camera, world, options = {}) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const dpi = window.devicePixelRatio || 1;
  const pixelsWide = Math.round(width*dpi);
  const pixelsHigh = Math.round(height*dpi);
  if (canvas.width !== pixelsWide || canvas.height !== pixelsHigh) {
    canvas.width = pixelsWide;
    canvas.height = pixelsHigh;
  }
  const projection = createProjection(camera.center,camera.zoom,width,height);
  if (!pixelsWide || !pixelsHigh) return projection;
  const {project} = projection;
  const layers = world?.layers ?? {};
  let background = backgrounds.get(canvas);
  if (!background) {
    background = {canvas:new OffscreenCanvas(pixelsWide,pixelsHigh)};
    backgrounds.set(canvas,background);
  }
  const signature = [width,height,dpi,camera.center.lat,camera.center.lon,camera.zoom,
    !!world,!!options.picker,world ? basemapRevision : 0,...basemapLayers.map(layer => mapLayerEnabled(layers,layer))].join('/');
  if (background.signature !== signature) {
    const surface = background.canvas;
    if (surface.width !== pixelsWide) surface.width = pixelsWide;
    if (surface.height !== pixelsHigh) surface.height = pixelsHigh;
    const base = surface.getContext('2d');
    base.setTransform(1,0,0,1,0,0);
    base.clearRect(0,0,pixelsWide,pixelsHigh);
    base.setTransform(dpi,0,0,dpi,0,0);
    drawBackground(base,camera,projection,width,height,layers,world,options);
    background.signature = signature;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,pixelsWide,pixelsHigh);
  ctx.drawImage(background.canvas,0,0);
  ctx.setTransform(dpi,0,0,dpi,0,0);
  if (!world) return projection;
  const {line,mark} = drawingTools(ctx,project,width,height);
  const localZoom = camera.zoom / Math.cos(camera.center.lat * Math.PI / 180);
  const margin = 100;
  const northwest = projection.unproject({x:-margin,y:-margin});
  const southeast = projection.unproject({x:width+margin,y:height+margin});
  function pathVisible(points) {
    const {west,east,south,north} = boundsFor(points);
    return west <= southeast.lon && east >= northwest.lon && south <= northwest.lat && north >= southeast.lat;
  }
  function infrastructure(item, draft) {
    const station = item.kind === 'station';
    if (station && layers.stationFootprints === false && !draft) return;
    if (!station && layers.tracks === false && !draft) return;
    const color = draft ? '#f3cd7c' : station ? '#a9d5f5' : '#b9cdda';
    const spacing = 4.5 * localZoom;
    const count = spacing < 1.3 ? 1 : item.lanes;
    if ((count-1)*spacing/2+1.5*localZoom <= margin && !pathVisible(item.points)) return;
    const first = item.points[0];
    const last = item.points.at(-1);
    const bearing = Math.atan2(last.lat-first.lat,(last.lon-first.lon)*Math.cos(first.lat*Math.PI/180));
    ctx.setLineDash(draft ? [7,5] : []);
    for (let i = 0; i < count; i++) {
      const delta = (i-(count-1)/2)*4.5;
      const points = delta === 0 ? item.points : item.points.map(point => offsetPoint(point,-Math.sin(bearing)*delta,Math.cos(bearing)*delta));
      line(points,color,station ? Math.max(2,3*localZoom) : 1.5);
    }
    ctx.setLineDash([]);
    if (station) mark(stationCenter(item),3,color,layers.stationNames !== false && item.name);
  }
  world.tracks.forEach(item => infrastructure(item,false));
  world.stations.forEach(item => infrastructure(item,false));
  for (const item of options.drafts ?? []) infrastructure(item,true);
  if (options.preview) infrastructure(options.preview,true);
  if (options.anchor) mark(options.anchor,6,'#f3cd7c');
  for (const { route, plan } of options.routes ?? []) {
    if (layers.routes === false && layers.arrows === false) break;
    for (const leg of plan.legs) {
      for (const segment of leg.segments) {
        if (!pathVisible(segment.points)) continue;
        if (layers.routes !== false) line(segment.points,route.color,3);
        if (layers.arrows !== false && segment.length * camera.zoom > 65) {
          const i = Math.ceil((segment.points.length-1)/2);
          const a = project(segment.points[i-1]);
          const b = project(segment.points[i]);
          const bearing = Math.atan2(b.y-a.y,b.x-a.x);
          const x = (a.x+b.x)/2;
          const y = (a.y+b.y)/2;
          ctx.beginPath();
          ctx.moveTo(x-8*Math.cos(bearing-.6),y-8*Math.sin(bearing-.6));
          ctx.lineTo(x,y);
          ctx.lineTo(x-8*Math.cos(bearing+.6),y-8*Math.sin(bearing+.6));
          ctx.strokeStyle = route.color;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }
    if (layers.routes !== false && route.letter && plan.legs.length) {
      const leg = plan.legs[Math.floor(plan.legs.length / 2)];
      const segment = leg.segments.reduce((longest, current) => current.length > longest.length ? current : longest);
      const i = Math.max(1, Math.floor(segment.points.length / 2));
      const a = project(segment.points[i - 1]);
      const b = project(segment.points[i]);
      const x = (a.x + b.x) / 2;
      const y = (a.y + b.y) / 2;
      const radius = route.letter.length > 2 ? 17 : 11;
      if (x+radius < 0 || x-radius > width || y+radius < 0 || y-radius > height) continue;
      ctx.beginPath();
      if (route.shape === 'Square') ctx.rect(x - radius, y - radius, radius * 2, radius * 2);
      else if (route.shape === 'Diamond') {
        ctx.moveTo(x, y - radius);
        ctx.lineTo(x + radius, y);
        ctx.lineTo(x, y + radius);
        ctx.lineTo(x - radius, y);
        ctx.closePath();
      } else ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = route.color;
      ctx.fill();
      ctx.font = 'bold 11px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#031926';
      ctx.strokeText(route.letter, x, y);
      ctx.fillStyle = '#fff';
      ctx.fillText(route.letter, x, y);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }
  }
  if (layers.trains !== false) {
    for (const train of options.trains ?? []) mark(train.point,4,train.color);
  }
  return projection;
}
