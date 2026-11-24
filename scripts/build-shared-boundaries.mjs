import { writeFile } from 'node:fs/promises';
import { mercator } from '../src/geometry.js';

function simplify(points,tolerance) {
  if (!tolerance || points.length <= 2) return points;
  const last = points.length-1;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[last] = 1;
  const pending = [[0,last]];
  while (pending.length) {
    const [first,end] = pending.pop();
    const [x,y] = points[first];
    const dx = points[end][0]-x;
    const dy = points[end][1]-y;
    const length = dx*dx+dy*dy;
    let furthest = tolerance*tolerance;
    let split = -1;
    for (let i = first+1; i < end; i++) {
      const px = points[i][0]-x;
      const py = points[i][1]-y;
      const t = length ? Math.max(0,Math.min(1,(px*dx+py*dy)/length)) : 0;
      const distance = (px-t*dx)**2+(py-t*dy)**2;
      if (distance > furthest) {
        furthest = distance;
        split = i;
      }
    }
    if (split !== -1) {
      keep[split] = 1;
      pending.push([first,split],[split,end]);
    }
  }
  return points.filter((_point,i) => keep[i]);
}

function groupPaths(paths) {
  const groups = new Map();
  for (const path of paths) {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const [x,y] of path) {
      left = Math.min(left,x);
      top = Math.min(top,y);
      right = Math.max(right,x);
      bottom = Math.max(bottom,y);
    }
    const key = Math.floor((left+right)/200000)+','+Math.floor((top+bottom)/200000);
    if (!groups.has(key)) groups.set(key,[Infinity,Infinity,-Infinity,-Infinity,[]]);
    const group = groups.get(key);
    group[0] = Math.min(group[0],left);
    group[1] = Math.min(group[1],top);
    group[2] = Math.max(group[2],right);
    group[3] = Math.max(group[3],bottom);
    group[4].push(encodePath(path));
  }
  return [...groups.values()];
}

function encodePath(points) {
  let x = 0, y = 0;
  const encoded = [];
  for (const [nextX,nextY] of points) {
    encoded.push(nextX-x,nextY-y);
    x = nextX;
    y = nextY;
  }
  return encoded;
}

const indexOf = ref => ref < 0 ? ~ref : ref;

export async function writeSharedBoundaries(directory, features, {topology,mergeArcs}) {
  const projected = features.map(({geometry,properties}) => ({
    type:'Feature',
    properties,
    geometry:{
      type:'MultiPolygon',
      coordinates:geometry.coordinates.map(polygon => polygon.map(ring => ring.map(([lon,lat]) => {
        const {x,y} = mercator({lon,lat});
        return [Math.round(x),Math.round(-y)];
      }))),
    },
  }));
  const data = topology({counties:{type:'FeatureCollection',features:projected}});
  const counties = data.objects.counties.geometries;
  const stateByArc = Array.from(data.arcs,() => new Set());
  const uses = new Uint16Array(data.arcs.length);
  for (const county of counties) {
    for (const index of new Set(county.arcs.flat(2).map(indexOf))) {
      uses[index]++;
      stateByArc[index].add(county.properties.STATEFP);
    }
  }
  const borderRings = mergeArcs(data,counties).arcs.flat();
  if (!borderRings.length || !stateByArc.some(states => states.size > 1)) {
    throw Error('The Census county topology has no shared state or exterior boundaries.');
  }

  for (const [level,tolerance] of [['overview',1100],['regional',110],['local',12],['detail',0]]) {
    const arcs = data.arcs.map(points => simplify(points,tolerance));
    const land = [];
    for (const ring of borderRings) {
      const path = [];
      for (const ref of ring) {
        const points = arcs[indexOf(ref)];
        if (ref < 0) {
          for (let i = points.length-1; i > 0; i--) path.push(points[i]);
        } else {
          for (let i = 0; i < points.length-1; i++) path.push(points[i]);
        }
      }
      if (path.length >= 3) land.push(encodePath([...path,path[0]]));
    }
    const states = [];
    const interior = [];
    arcs.forEach((path,index) => {
      if (stateByArc[index].size > 1) states.push(path);
      else if (uses[index] > 1) interior.push(path);
    });
    const result = {land,states:groupPaths(states),counties:groupPaths(interior)};
    await writeFile(new URL('us-boundaries-'+level+'.js',directory),
      '// U.S. Census Bureau 2025 county topology. See LICENSE.md.\nexport default '+JSON.stringify(result)+';\n');
    console.log(level,land.length,states.length,interior.length);
  }
}
