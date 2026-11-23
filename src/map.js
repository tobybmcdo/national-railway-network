import { createProjection, offsetPoint } from './geometry.js';
import { cities, stationCenter } from './railway.js';

const outline = [
  [-124.7,48.4],[-123,49],[-95,49],[-89,48],[-84.8,46],[-83,42],[-79,43.6],
  [-76,44.7],[-71,45],[-67,47],[-67,44.7],[-70,42.1],[-74,40.5],[-75,38.2],
  [-77.1,34.5],[-81,31],[-80,26],[-81.6,25.1],[-83,28.7],[-85,30],
  [-89,29],[-94,29.3],[-97,25.9],[-100,28.7],[-103,29],[-106.5,31.8],
  [-111,31.3],[-117,32.5],[-119,34.3],[-122.5,37.8],[-124.3,41.8],[-124.7,48.4],
].map(([lon,lat]) => ({ lon,lat }));

export const layerOptions = {
  tracks:'Track', trains:'Moving trains', routes:'Route lines', arrows:'Route direction',
  stationNames:'Station names', stationFootprints:'Station footprints', cities:'City names',
};

export function drawMap(canvas, camera, world, options = {}) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const dpi = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * dpi) || canvas.height !== Math.round(height * dpi)) {
    canvas.width = Math.round(width * dpi);
    canvas.height = Math.round(height * dpi);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpi,0,0,dpi,0,0);
  ctx.clearRect(0,0,width,height);
  const projection = createProjection(camera.center, camera.zoom, width, height);
  const { project } = projection;
  const layers = world?.layers ?? {};
  function line(points, color, weight, fill) {
    ctx.beginPath();
    points.forEach((point, index) => {
      const { x,y } = project(point);
      if (index) ctx.lineTo(x,y);
      else ctx.moveTo(x,y);
    });
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
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
      ctx.strokeStyle = '#182825';
      ctx.strokeText(label,x+9,y-7);
      ctx.fillStyle = '#e9f3f0';
      ctx.fillText(label,x+9,y-7);
    }
  }
  line(outline,'#557874',1.5,'#274742');
  const step = camera.zoom > .02 ? .001 : camera.zoom > .002 ? .02 : camera.zoom > .0004 ? .2 : 5;
  const nw = projection.unproject({ x:0,y:0 });
  const se = projection.unproject({ x:width,y:height });
  for (let lon = Math.ceil(nw.lon/step)*step; lon < se.lon; lon += step) {
    line([{lat:nw.lat,lon},{lat:se.lat,lon}],'#96c4bd23',1);
  }
  for (let lat = Math.ceil(se.lat/step)*step; lat < nw.lat; lat += step) {
    line([{lat,lon:nw.lon},{lat,lon:se.lon}],'#96c4bd23',1);
  }
  if (layers.cities !== false) {
    for (const city of cities) mark(city,options.picker ? 6 : 3,'#b9cdda',city.name);
  }
  if (!world) return projection;
  function infrastructure(item, draft) {
    const station = item.kind === 'station';
    if (station && layers.stationFootprints === false && !draft) return;
    if (!station && layers.tracks === false && !draft) return;
    const zoom = camera.zoom / Math.cos(camera.center.lat * Math.PI / 180);
    const color = draft ? '#f3cd7c' : station ? '#abdcc5' : '#b9cdda';
    const spacing = 4.5 * zoom;
    const count = spacing < 1.3 ? 1 : item.lanes;
    const first = item.points[0];
    const last = item.points.at(-1);
    const bearing = Math.atan2(last.lat-first.lat,(last.lon-first.lon)*Math.cos(first.lat*Math.PI/180));
    ctx.setLineDash(draft ? [7,5] : []);
    for (let i = 0; i < count; i++) {
      const delta = (i-(count-1)/2)*4.5;
      const points = delta === 0 ? item.points : item.points.map(point => offsetPoint(point,-Math.sin(bearing)*delta,Math.cos(bearing)*delta));
      line(points,color,station ? Math.max(2,3*zoom) : 1.5);
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
    for (const leg of plan.legs) {
      for (const segment of leg.segments) {
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
      ctx.strokeStyle = '#182825';
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
