import assert from 'node:assert/strict';
import test from 'node:test';

const levels = ['overview','regional','local','detail'];
const groupedPaths = groups => groups.flatMap(group => group[4]);

function points(path) {
  let x = 0, y = 0;
  const result = [];
  for (let i = 0; i < path.length; i += 2) {
    x += path[i];
    y += path[i+1];
    result.push(x+','+y);
  }
  return result;
}

test('county lines meet the same state and coast geometry as borders gain detail', async () => {
  const details = await Promise.all(levels.map(async level =>
    (await import('../src/basemap/us-boundaries-'+level+'.js')).default,
  ));
  let previous;
  for (const detail of details) {
    const coastPoints = new Set(detail.land.flatMap(points));
    const statePoints = new Set(groupedPaths(detail.states).flatMap(points));
    const countyPaths = groupedPaths(detail.counties);
    const countyEnds = new Set(countyPaths.flatMap(path => {
      const vertices = points(path);
      return [vertices[0],vertices.at(-1)];
    }));
    const coastJunctions = new Set([...countyEnds].filter(point => coastPoints.has(point)));
    const stateJunctions = new Set([...countyEnds].filter(point => statePoints.has(point)));
    const vertexCounts = [coastPoints.size,statePoints.size,countyPaths.reduce((sum,path) => sum+path.length/2,0)];

    assert.ok(coastJunctions.size > 300,'County lines reach the land outline');
    assert.ok(stateJunctions.size > 900,'County lines reach state borders');
    if (previous) {
      vertexCounts.forEach((count,i) => assert.ok(count > previous.vertexCounts[i]));
      assert.deepEqual(stateJunctions,previous.stateJunctions);
      assert.ok([...previous.coastJunctions].every(point => coastJunctions.has(point)),
        'Coast junctions survive finer rendering');
    }
    previous = {vertexCounts,stateJunctions,coastJunctions};
  }
});
