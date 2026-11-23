import { distance, routePlan } from './railway.js';

export const servicePeriods = [
  { id: 'night', name: 'Night', start: 0, end: 360 },
  { id: 'morning', name: 'Morning peak', start: 360, end: 600 },
  { id: 'day', name: 'Midday', start: 600, end: 960 },
  { id: 'evening', name: 'Evening peak', start: 960, end: 1200 },
  { id: 'late', name: 'Late evening', start: 1200, end: 1440 },
];

export function validateRoute(world, route) {
  if (!route.name?.trim() || !/^#[0-9a-f]{6}$/i.test(route.color)) {
    throw new Error('Enter a route name and a valid color.');
  }
  const enabled = servicePeriods.filter(period => route.services[period.id]?.unitId);
  if (!enabled.length) throw new Error('Configure at least one operating period.');
  for (const period of enabled) routePlan(world, route, route.services[period.id]);
  return route;
}

export function compileServices(world) {
  return world.routes.flatMap(route => servicePeriods.flatMap(period => {
    const service = route.services[period.id];
    return service?.unitId ? [{ route, period, service, plan: routePlan(world, route, service) }] : [];
  }));
}

export function getActiveTrains(services, clock) {
  const active = [];
  for (const { route, period, service, plan } of services) {
    const offset = ((Number(route.offset ?? 0) % service.interval) + service.interval) % service.interval;
    const duration = route.loop ? plan.minutes : plan.minutes * 2;
    const firstDay = Math.max(0, Math.floor((clock - duration) / 1440));
    const lastDay = Math.floor(clock / 1440);
    for (let day = firstDay; day <= lastDay; day++) {
      const start = day * 1440 + period.start + offset;
      const end = day * 1440 + period.end;
      const firstDeparture = start + Math.max(0, Math.floor((clock - duration - start) / service.interval)) * service.interval;
      for (let departure = firstDeparture; departure < end && departure <= clock; departure += service.interval) {
        const age = clock - departure;
        if (age >= duration) continue;
        const reverse = !route.loop && age >= plan.minutes;
        let elapsed = reverse ? age - plan.minutes : age;
        const legs = reverse ? plan.legs.toReversed() : plan.legs;
        for (const leg of legs) {
          const travel = leg.length * 0.06 / plan.model.speed;
          if (elapsed < travel + 1) {
            const fraction = Math.min(1, elapsed / travel);
            active.push({
              id: `${route.id}-${departure}`,
              color: route.color,
              routeId: route.id,
              point: pointOnLeg(leg, reverse ? 1 - fraction : fraction),
            });
            break;
          }
          elapsed -= travel + 1;
        }
      }
    }
  }
  return active;
}

function pointOnLeg(leg, fraction) {
  let remaining = leg.length * fraction;
  for (const segment of leg.segments) {
    if (remaining <= segment.length) {
      for (let index = 1; index < segment.points.length; index++) {
        const a = segment.points[index - 1];
        const b = segment.points[index];
        const length = distance(a, b);
        if (length > 0 && remaining <= length) {
          const blend = remaining / length;
          return { lat: a.lat + (b.lat - a.lat) * blend, lon: a.lon + (b.lon - a.lon) * blend };
        }
        remaining -= length;
      }
      return segment.points.at(-1);
    }
    remaining -= segment.length;
  }
  return leg.segments.at(-1).points.at(-1);
}
