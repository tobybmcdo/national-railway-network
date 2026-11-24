import { writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

export async function writeTilePack(directory,key,tiles,snapshot,source = 'Protomaps and OpenStreetMap contributors') {
  const index = {};
  let offset = 0;
  const parts = tiles.map(({x,y,paths}) => {
    const bytes = gzipSync(JSON.stringify(paths));
    index[`${x},${y}`] = [offset,bytes.length];
    offset += bytes.length;
    return bytes;
  });
  const bounds = [
    Math.min(...tiles.map(tile => tile.x)),tiles[0].y,
    Math.max(...tiles.map(tile => tile.x)),tiles.at(-1).y,
  ];
  await writeFile(new URL(`${key}.tiles`,directory),Buffer.concat(parts));
  await writeFile(new URL(`${key}-index.js`,directory),
    `// ${source}. See LICENSE.md.\n// Source snapshot: ${snapshot}\nexport default ${JSON.stringify({bounds,index})};\n`);
}
