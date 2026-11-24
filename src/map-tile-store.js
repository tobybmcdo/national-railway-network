import { open } from 'node:fs/promises';
import { cities } from './railway.js';
import { geographyLayers } from './geography-layers.js';

const bundles = new Set(cities.flatMap(city => {
  const key = city.name.split(',')[0].toLowerCase().replaceAll(' ','-');
  return [key,`${key}-regional`];
}));
for (const {bundle} of Object.values(geographyLayers)) bundles.add(bundle);
const indexes = new Map();

export async function readMapTile(bundle,id) {
  if (!bundles.has(bundle) || typeof id !== 'string' || !/^\d+,\d+$/.test(id)) {
    throw Error('Invalid offline map tile request.');
  }
  if (!indexes.has(bundle)) indexes.set(bundle,import(`./basemap/${bundle}-index.js`));
  const {default:{index}} = await indexes.get(bundle);
  const entry = index[id];
  if (!entry) throw Error('Offline map tile is outside the bundle.');
  const [offset,length] = entry;
  const file = await open(new URL(`./basemap/${bundle}.tiles`,import.meta.url));
  try {
    const bytes = new Uint8Array(length);
    const {bytesRead} = await file.read(bytes,0,length,offset);
    if (bytesRead !== length) throw Error('Incomplete offline map tile.');
    return bytes;
  } finally {
    await file.close();
  }
}
