import { distance } from './railway.js';

const earthRadius = 6371000;
const radians = Math.PI / 180;

export function offsetPoint(point, east, north) {
  return {
    lat: point.lat + north / earthRadius / radians,
    lon: point.lon + east / (earthRadius * Math.cos(point.lat * radians)) / radians,
  };
}

export function stationGeometry(center, length, heading) {
  const angle = heading * radians;
  const east = Math.sin(angle) * length / 2;
  const north = Math.cos(angle) * length / 2;
  return [offsetPoint(center, -east, -north), offsetPoint(center, east, north)];
}

export function closestEndpoint(point, infrastructure, radius) {
  let result = null;
  let nearest = radius;
  for (const item of infrastructure) {
    const points = item.points;
    const candidates = [[points[0], points[1]], [points.at(-1), points.at(-2)]];
    for (const [end, inside] of candidates) {
      const separation = distance(point, end);
      if (separation <= nearest) {
        result = { point: end, inside, itemId: item.id };
        nearest = separation;
      }
    }
  }
  return result;
}

export function trackGeometry(start, end, startInside, endInside) {
  if (!startInside && !endInside) return [start, end];
  const span = Math.hypot(end.lon - start.lon, end.lat - start.lat);
  function handle(origin, fallback, inside) {
    const x = inside ? origin.lon - inside.lon : fallback.lon - origin.lon;
    const y = inside ? origin.lat - inside.lat : fallback.lat - origin.lat;
    const magnitude = Math.hypot(x, y);
    if (magnitude === 0) return origin;
    return { lon: origin.lon + x / magnitude * span / 3, lat: origin.lat + y / magnitude * span / 3 };
  }
  const a = handle(start, end, startInside);
  const b = handle(end, start, endInside);
  const segments = Math.max(12, Math.min(128, Math.ceil(distance(start, end) / 30)));
  function cubic(t, p0, p1, p2, p3) {
    const u = 1 - t;
    return u ** 3 * p0 + 3 * u ** 2 * t * p1 + 3 * u * t ** 2 * p2 + t ** 3 * p3;
  }
  return Array.from({ length: segments + 1 }, (_, index) => {
    const t = index / segments;
    return {
      lon: cubic(t, start.lon, a.lon, b.lon, end.lon),
      lat: cubic(t, start.lat, a.lat, b.lat, end.lat),
    };
  });
}

export function mercator(point) {
  const lat = Math.max(-85.051129, Math.min(85.051129, point.lat)) * radians;
  return {
    x: earthRadius * point.lon * radians,
    y: earthRadius * Math.log(Math.tan(Math.PI / 4 + lat / 2)),
  };
}

export function geographic({ x, y }) {
  return {
    lon: x / earthRadius / radians,
    lat: (2 * Math.atan(Math.exp(y / earthRadius)) - Math.PI / 2) / radians,
  };
}

export function createProjection(center, pixelsPerMeter, width, height) {
  const origin = mercator(center);
  return {
    project(point) {
      const { x, y } = mercator(point);
      return { x: width / 2 + (x - origin.x) * pixelsPerMeter, y: height / 2 - (y - origin.y) * pixelsPerMeter };
    },
    unproject({ x, y }) {
      return geographic({
        x: origin.x + (x - width / 2) / pixelsPerMeter,
        y: origin.y - (y - height / 2) / pixelsPerMeter,
      });
    },
  };
}
