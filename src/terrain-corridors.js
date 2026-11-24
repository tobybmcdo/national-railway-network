import { mercator } from './geometry.js';
import { cities, distance } from './railway.js';

export const corridorTileSize = 64000;
const coverage = 85000;
const tiles = new Map();

for (const [index,city] of cities.entries()) {
  for (const neighbor of cities.slice(index+1)) {
    if (distance(city,neighbor) > 450000) continue;
    const start = mercator(city);
    const end = mercator(neighbor);
    const dx = end.x-start.x;
    const dy = end.y-start.y;
    const lengthSquared = dx*dx+dy*dy;
    for (let column = Math.floor((Math.min(start.x,end.x)-coverage)/corridorTileSize);
      column <= Math.floor((Math.max(start.x,end.x)+coverage)/corridorTileSize); column++) {
      for (let row = Math.floor((Math.min(start.y,end.y)-coverage)/corridorTileSize);
        row <= Math.floor((Math.max(start.y,end.y)+coverage)/corridorTileSize); row++) {
        const x = (column+.5)*corridorTileSize;
        const y = (row+.5)*corridorTileSize;
        const progress = Math.max(0,Math.min(1,((x-start.x)*dx+(y-start.y)*dy)/lengthSquared));
        if (Math.hypot(x-start.x-progress*dx,y-start.y-progress*dy) <= coverage) {
          tiles.set(`corridor-${column}-${row}`,{x,y});
        }
      }
    }
  }
}

export const corridorTiles = [...tiles].map(([key,center]) => ({key,...center}));
