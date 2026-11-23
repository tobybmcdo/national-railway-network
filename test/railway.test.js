import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { cities, newWorld, buildProject, buyTrain, routePlan } from '../src/railway.js';
import { compileServices, getActiveTrains, validateRoute } from '../src/simulation.js';
import { createSaveStore } from '../src/saves.js';

function fixture() {
  const world = newWorld(cities[0]);
  const common = { track: 'standard', power: 'none', elevation: 'surface', lanes: 1 };
  const station = (id, start) => ({
    ...common, id, name: id, kind: 'station', platforms: 1, length: 175,
    points: [{ lat: 39, lon: start }, { lat: 39, lon: start + 0.002 }],
  });
  const a = station('Union Station', -77);
  const b = station('West Station', -76.98);
  world.projects.push({ id: 'starter', items: [
    a, b, { ...common, id: 'connector', kind: 'track', points: [a.points[1], b.points[0]] },
  ] });
  return { world, a, b };
}

test('construction commits both stations and the connector as a single project', () => {
  const { world } = fixture();
  const initial = world.budget;
  assert.ok(buildProject(world, 'starter') > 0);
  assert.ok(world.budget < initial);
  assert.equal(world.stations.length, 2);
  assert.equal(world.tracks.length, 1);
  assert.equal(world.projects.length, 0);
});

test('an unaffordable project keeps the draft and places no infrastructure', () => {
  const { world } = fixture();
  world.budget = 0;
  assert.throws(() => buildProject(world, 'starter'), /Insufficient/);
  assert.equal(world.projects.length, 1);
  assert.equal(world.stations.length + world.tracks.length, 0);
});

test('routes enforce connectivity, electrification, length, and terminus platforms', () => {
  const { world, a, b } = fixture();
  buildProject(world, 'starter');
  const unit = buyTrain(world, 'diesel', 4);
  const route = { stops: [a.id, b.id], firstPlatform: 1 };
  assert.equal(routePlan(world, route, { unitId: unit.id, interval: 10 }).legs[0].segments.length, 3);
  assert.throws(() => routePlan(world, { ...route, firstPlatform: 2 }, { unitId: unit.id, interval: 10 }), /terminus/);
  const electric = buyTrain(world, 'electric', 4);
  assert.throws(() => routePlan(world, route, { unitId: electric.id, interval: 10 }), /compatible/);
  b.length = 40;
  assert.throws(() => routePlan(world, route, { unitId: unit.id, interval: 10 }), /long enough/);
  b.length = 175;
  world.tracks = [];
  assert.throws(() => routePlan(world, route, { unitId: unit.id, interval: 10 }), /connects/);
});

test('timetable offsets affect departures and trains move on the connected railway', () => {
  const { world, a, b } = fixture();
  buildProject(world, 'starter');
  const unit = buyTrain(world, 'diesel', 4);
  const route = validateRoute(world, {
    id: 'a', name: 'A Line', color: '#008888', stops: [a.id, b.id], offset: 3,
    services: { morning: { unitId: unit.id, interval: 15 } },
  });
  world.routes.push(route);
  const schedules = compileServices(world);
  assert.equal(getActiveTrains(schedules, 362).length, 0);
  const [departure] = getActiveTrains(schedules, 363);
  const [moving] = getActiveTrains(schedules, 363.5);
  assert.ok(moving.point.lon > departure.point.lon);
  assert.equal(getActiveTrains(schedules, 371).length, 0);
});

test('three-slot save store keeps manual saves and two autosave snapshots', async () => {
  const directory = await mkdtemp(join(process.cwd(), '.railway-test-'));
  try {
    const store = createSaveStore(directory);
    const { world } = fixture();
    assert.equal(await store.load(2), null);
    await store.save(2, world);
    const first = store.save(2, { ...world, clock: 420 }, 'auto');
    const second = store.save(2, { ...world, clock: 480 }, 'auto');
    await Promise.all([first, second]);
    assert.equal((await store.load(2)).clock, 360);
    assert.equal((await store.load(2, 'auto')).clock, 480);
    assert.equal((await store.load(2, 'previous')).clock, 420);
    assert.equal(await store.load(1), null);
    assert.equal(await store.load(3), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test('station dimensions are at map scale and connected tracks follow the endpoint tangent', async () => {
  const { distance } = await import('../src/railway.js');
  const { stationGeometry, closestEndpoint, trackGeometry } = await import('../src/geometry.js');
  const center = { lat: 39, lon: -77 };
  const points = stationGeometry(center, 240, 90);
  assert.ok(Math.abs(distance(...points) - 240) < 0.1);
  const snap = closestEndpoint(points[1], [{ id: 'station', points }], 50);
  assert.equal(snap.itemId, 'station');
  assert.equal(closestEndpoint(center, [{ id: 'station', points }], 50), null);
  const end = { lat: 39.006, lon: -76.998 };
  const curved = trackGeometry(snap.point, end, snap.inside);
  assert.deepEqual(curved[0], points[1]);
  assert.deepEqual(curved.at(-1), end);
  assert.ok(curved[1].lon > curved[0].lon);
  assert.ok(Math.abs(curved[1].lat - curved[0].lat) < Math.abs(curved[1].lon - curved[0].lon));
});

test('map projection and pointer coordinates round-trip at regional and station zoom', async () => {
  const { createProjection, offsetPoint } = await import('../src/geometry.js');
  const { distance } = await import('../src/railway.js');
  const center = cities[0];
  for (const zoom of [0.0001, 0.03, 5]) {
    const camera = createProjection(center, zoom, 1280, 720);
    assert.deepEqual(camera.project(center), { x: 640, y: 360 });
    const location = offsetPoint(center, 30, 140);
    assert.ok(distance(location, camera.unproject(camera.project(location))) < 0.001);
  }
});

test('loop services honor period-specific stop order and keep running across midnight', () => {
  const { world, a, b } = fixture();
  buildProject(world, 'starter');
  const unit = buyTrain(world, 'diesel', 4);
  world.routes.push(validateRoute(world, {
    id: 'loop', name: 'Loop', color: '#008888', loop: true, stops: [a.id, b.id],
    services: { late: { unitId: unit.id, interval: 1, stops: [b.id, a.id] } },
  }));
  const [schedule] = compileServices(world);
  assert.equal(schedule.plan.legs.length, 2);
  assert.equal(schedule.plan.legs[0].segments[0].from, b.id);
  const trains = getActiveTrains([schedule], 1440);
  assert.ok(trains.length > 0);
  assert.ok(trains.every(train => train.id !== 'loop-1440'));
});
