import overview from './basemap/us-boundaries-overview.js';

const levels = [
  {minZoom:0,data:overview},
  {minZoom:.00045,load:() => import('./basemap/us-boundaries-regional.js')},
  {minZoom:.0045,load:() => import('./basemap/us-boundaries-local.js')},
  {minZoom:.04,load:() => import('./basemap/us-boundaries-detail.js')},
];
const cachedPaths = new WeakMap();

function paths(data) {
  if (!cachedPaths.has(data)) {
    const path = new Path2D();
    for (const coordinates of data) {
      let x = coordinates[0];
      let y = coordinates[1];
      path.moveTo(x,y);
      for (let i = 2; i < coordinates.length; i += 2) {
        x += coordinates[i];
        y += coordinates[i+1];
        path.lineTo(x,y);
      }
    }
    cachedPaths.set(data,path);
  }
  return cachedPaths.get(data);
}

export function boundariesForZoom(zoom,onLoad) {
  const selected = levels.findLast(level => zoom >= level.minZoom);
  if (!selected.data) {
    selected.onLoad = onLoad;
    selected.pending ??= selected.load().then(({default:data}) => {
      selected.data = data;
      selected.onLoad();
      delete selected.onLoad;
    }).catch(error => console.error('Could not load offline borders',error));
  }
  const {data} = levels.findLast(level => level.data && zoom >= level.minZoom);
  return {land:paths(data.land),states:data.states,counties:data.counties};
}

export function strokeBoundaryGroups(ctx, groups, x, y, width, height, zoom) {
  const halfWidth = (width/2+2)/zoom;
  const halfHeight = (height/2+2)/zoom;
  for (const [left,top,right,bottom,data] of groups) {
    if (left <= x+halfWidth && right >= x-halfWidth && top <= y+halfHeight && bottom >= y-halfHeight) {
      ctx.stroke(paths(data));
    }
  }
}
