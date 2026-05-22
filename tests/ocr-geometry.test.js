import assert from 'node:assert/strict';
import { createOrientedBoxFromComponent } from '../src/pipeline/ocr.js';

export function runOcrGeometryTests(runTest) {
  runTest('creates an oriented quadrilateral for slanted detector components', () => {
    const component = makeComponent((points) => {
      for (let x = 0; x < 48; x += 1) {
        const centerY = 14 + Math.round(x * 0.25);
        for (let dy = -1; dy <= 1; dy += 1) {
          points.push([x, centerY + dy]);
        }
      }
    });

    const box = createOrientedBoxFromComponent(component, 2, 2, 160, 100);

    assert.equal(box.quad.length, 4);
    assert.ok(Math.abs(box.angle) > 0.1);
    assert.ok(box.orientedWidth > box.orientedHeight);
    assert.ok(box.x >= 0);
    assert.ok(box.y >= 0);
    assert.ok(box.xMax <= 160);
    assert.ok(box.yMax <= 100);
  });

  runTest('falls back to an axis-aligned box for degenerate components', () => {
    const component = makeComponent((points) => {
      points.push([10, 10]);
    });

    const box = createOrientedBoxFromComponent(component, 2, 2, 160, 100);

    assert.equal(box.quad, undefined);
    assert.ok(box.x < box.xMax);
    assert.ok(box.y < box.yMax);
  });
}

function makeComponent(fillPoints) {
  const points = [];
  fillPoints(points);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;
  const pointsX = [];
  const pointsY = [];

  for (const [x, y] of points) {
    const pointX = x + 0.5;
    const pointY = y + 0.5;
    pointsX.push(x);
    pointsY.push(y);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    sumX += pointX;
    sumY += pointY;
    sumXX += pointX * pointX;
    sumYY += pointY * pointY;
    sumXY += pointX * pointY;
  }

  return {
    area: points.length,
    maxX,
    maxY,
    minX,
    minY,
    pointsX,
    pointsY,
    score: 0.8,
    sumX,
    sumXX,
    sumXY,
    sumY,
    sumYY
  };
}
