import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

function validateWorld(world) {
  const collections = ['stations', 'tracks', 'projects', 'fleet', 'routes', 'colors'];
  if (world?.version !== 1 || !world.id || !world.city
    || !Number.isFinite(world.budget) || !Number.isFinite(world.clock)
    || collections.some(key => !Array.isArray(world[key]))) {
    throw new Error('Unsupported or damaged save.');
  }
  return world;
}

export function createSaveStore(directory) {
  let pending = Promise.resolve();

  function filename(slot, kind) {
    if (![1, 2, 3].includes(slot) || !['manual', 'auto', 'previous'].includes(kind)) {
      throw new Error('Unknown save slot or snapshot.');
    }
    return join(directory, `world-${slot}-${kind}.json`);
  }

  async function read(slot, kind) {
    try {
      return validateWorld(JSON.parse(await readFile(filename(slot, kind), 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function write(target, payload) {
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, payload, { flag: 'wx' });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  return {
    async load(slot, kind = 'manual') {
      await pending;
      return read(slot, kind);
    },
    save(slot, world, kind = 'manual') {
      const target = filename(slot, kind);
      if (kind === 'previous') throw new Error('Previous autosaves are read-only.');
      const { id } = validateWorld(world);
      const payload = JSON.stringify({ ...world, savedAt: new Date().toISOString() });
      const operation = pending.then(async () => {
        await mkdir(directory, { recursive: true });
        if (kind === 'auto') {
          const prior = await read(slot, 'auto');
          if (prior?.id === id) await write(filename(slot, 'previous'), JSON.stringify(prior));
        }
        await write(target, payload);
      });
      pending = operation.catch(() => {});
      return operation;
    },
  };
}
