export const cities = [
  ['Washington, D.C.', -77.0369, 38.9072],
  ['New York', -74.006, 40.7128],
  ['Chicago', -87.6298, 41.8781],
  ['Atlanta', -84.388, 33.749],
  ['Denver', -104.9903, 39.7392],
  ['Seattle', -122.3321, 47.6062],
  ['Los Angeles', -118.2437, 34.0522],
  ['Dallas', -96.797, 32.7767],
].map(([name, lon, lat]) => ({ name, lon, lat }));

export const catalog = [
  { id: 'diesel', name: 'Regional diesel', track: 'standard', power: null, carLength: 25, cars: [2, 4, 6], speed: 150, price: 1800000 },
  { id: 'electric', name: 'Intercity electric', track: 'standard', power: 'overhead', carLength: 26, cars: [4, 6, 8], speed: 220, price: 2500000 },
  { id: 'metro', name: 'Metro electric', track: 'standard', power: 'third rail', carLength: 19, cars: [4, 6, 8], speed: 90, price: 1200000 },
  { id: 'narrow', name: 'Narrow-gauge diesel', track: 'narrow', power: null, carLength: 17, cars: [2, 4], speed: 95, price: 900000 },
];

export function newWorld(city, name = city.name) {
  return {
    version: 1, id: crypto.randomUUID(), name, city, budget: 250000000,
    clock: 360, stations: [], tracks: [], projects: [], fleet: [], routes: [],
    colors: [], layers: {}, createdAt: new Date().toISOString(),
  };
}

export function distance(a, b) {
  const radians = Math.PI / 180;
  const lat = (b.lat - a.lat) * radians;
  const lon = (b.lon - a.lon) * radians;
  const chord = Math.sin(lat / 2) ** 2
    + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(lon / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(chord)));
}

export function pathLength(points) {
  return points.slice(1).reduce((total, point, index) => total + distance(points[index], point), 0);
}

export function projectCost(project) {
  return project.items.map(item => {
    const elevation = { surface: 1, elevated: 2.2, tunnel: 4 }[item.elevation];
    const power = item.power === 'none' ? 0 : 500;
    const cost = item.kind === 'station'
      ? 900000 + item.length * (item.platforms * 3200 + item.lanes * (2200 + power)) * elevation
      : pathLength(item.points) * item.lanes * (1900 + power) * elevation;
    return { id: item.id, cost: Math.round(cost) };
  });
}

function validateItem(item) {
  if (!['station', 'track'].includes(item.kind)
    || !Number.isInteger(item.lanes) || item.lanes < 1 || item.lanes > 6
    || !['standard', 'narrow'].includes(item.track)
    || !['none', 'overhead', 'third rail'].includes(item.power)
    || !['surface', 'elevated', 'tunnel'].includes(item.elevation)
    || !Array.isArray(item.points) || item.points.length < 2
    || item.points.some(point => !Number.isFinite(point.lat) || !Number.isFinite(point.lon)
      || Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180)
    || pathLength(item.points) < 1) {
    throw new Error('Enter valid construction settings and geometry.');
  }
  if (item.kind === 'station' && (!item.name?.trim() || !Number.isFinite(item.length)
    || item.length < 30 || item.length > 1200 || !Number.isInteger(item.platforms)
    || item.platforms < 1 || item.platforms > item.lanes * 2)) {
    throw new Error('Enter a station name, a length from 30 to 1,200 m, and a valid platform count.');
  }
}

export function buildProject(world, projectId) {
  const project = world.projects.find(item => item.id === projectId);
  if (!project?.items.length) throw new Error('Add construction to this project first.');
  project.items.forEach(validateItem);
  const existing = [...world.tracks, ...world.stations];
  const ids = [...existing, ...project.items].map(item => item.id);
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) {
    throw new Error('Construction item IDs must be unique.');
  }
  const cost = projectCost(project).reduce((total, row) => total + row.cost, 0);
  if (cost > world.budget) throw new Error('Insufficient funds to build this project.');
  const stations = project.items.filter(item => item.kind === 'station');
  const tracks = project.items.filter(item => item.kind === 'track');
  world.stations.push(...stations);
  world.tracks.push(...tracks);
  world.budget -= cost;
  world.projects = world.projects.filter(item => item.id !== projectId);
  return cost;
}

export function buyTrain(world, modelId, cars) {
  const model = catalog.find(item => item.id === modelId);
  if (!model?.cars.includes(cars)) throw new Error('Choose an available trainset length.');
  const cost = model.price * cars;
  if (cost > world.budget) throw new Error('Insufficient funds for this trainset.');
  const unit = { id: crypto.randomUUID(), modelId, cars };
  world.fleet.push(unit);
  world.budget -= cost;
  return unit;
}

function compatible(item, model) {
  return item.track === model.track && (!model.power || item.power === model.power);
}

export function endpoint(point) {
  return `${point.lat.toFixed(6)},${point.lon.toFixed(6)}`;
}

export function findRailPath(world, origin, destination, unit) {
  const model = catalog.find(item => item.id === unit.modelId);
  if (!model) throw new Error('Unknown train model.');
  const graph = new Map();
  function addEdge(from, to, points, item) {
    const edges = graph.get(from) ?? [];
    edges.push({ to, points, itemId: item.id, length: pathLength(points) });
    graph.set(from, edges);
  }

  for (const item of [...world.tracks, ...world.stations]) {
    if (!compatible(item, model)) continue;
    const start = endpoint(item.points[0]);
    const end = endpoint(item.points.at(-1));
    if (item.kind === 'station') {
      const middle = stationCenter(item);
      addEdge(start, item.id, [item.points[0], middle], item);
      addEdge(item.id, start, [middle, item.points[0]], item);
      addEdge(item.id, end, [middle, item.points.at(-1)], item);
      addEdge(end, item.id, [item.points.at(-1), middle], item);
    } else {
      addEdge(start, end, item.points, item);
      addEdge(end, start, item.points.toReversed(), item);
    }
  }

  const frontier = new Map([[origin, 0]]);
  const settled = new Set();
  const previous = new Map();
  while (frontier.size) {
    let node;
    let best = Infinity;
    for (const [candidate, length] of frontier) {
      if (length < best) [node, best] = [candidate, length];
    }
    if (node === destination) {
      const segments = [];
      for (let cursor = destination; cursor !== origin;) {
        const edge = previous.get(cursor);
        segments.push(edge);
        cursor = edge.from;
      }
      return { length: best, segments: segments.reverse() };
    }
    frontier.delete(node);
    settled.add(node);
    for (const edge of graph.get(node) ?? []) {
      const next = best + edge.length;
      if (!settled.has(edge.to) && next < (frontier.get(edge.to) ?? Infinity)) {
        frontier.set(edge.to, next);
        previous.set(edge.to, { ...edge, from: node });
      }
    }
  }
  return null;
}

export function stationCenter(station) {
  const [a, b] = station.points;
  return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
}

export function routePlan(world, route, service) {
  const unit = world.fleet.find(item => item.id === service.unitId);
  const model = catalog.find(item => item.id === unit?.modelId);
  if (!model) throw new Error('Choose an owned trainset.');
  if (!Number.isInteger(service.interval) || service.interval < 1 || service.interval > 360) {
    throw new Error('Enter a service interval from 1 to 360 minutes.');
  }
  const stops = service.stops ?? route.stops;
  if (stops.length < 2 || new Set(stops).size !== stops.length) {
    throw new Error('Select at least two distinct stops.');
  }
  const stations = stops.map(id => world.stations.find(item => item.id === id));
  if (stations.some(station => !station || !compatible(station, model)
    || station.length < unit.cars * model.carLength)) {
    throw new Error('Each stop needs compatible track and a platform long enough for the trainset.');
  }
  if (!route.loop) {
    for (const [index, platform] of [[0, route.firstPlatform], [stations.length - 1, route.lastPlatform]]) {
      if (platform != null && (!Number.isInteger(platform) || platform < 1 || platform > stations[index].platforms)) {
        throw new Error('Choose a valid platform at each terminus.');
      }
    }
  }
  const sequence = route.loop ? [...stops, stops[0]] : stops;
  const legs = sequence.slice(1).map((stop, index) => {
    const plan = findRailPath(world, sequence[index], stop, unit);
    if (!plan) throw new Error(`No compatible track connects ${stations[index].name} to ${stations[(index + 1) % stations.length].name}.`);
    return plan;
  });
  return { legs, unit, model, minutes: legs.reduce((sum, leg) => sum + leg.length / model.speed * 0.06 + 1, 0) };
}
