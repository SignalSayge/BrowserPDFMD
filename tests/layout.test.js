import assert from 'node:assert/strict';
import { orderLinesByLayout } from '../src/pipeline/layout.js';

export function runLayoutTests(runTest) {
  runTest('orders two-column pages by column before vertical position', () => {
    const warnings = [];
    const interleaved = [];

    for (let index = 0; index < 6; index += 1) {
      interleaved.push(
        line({ text: `L${index}`, x: 40, xMax: 240, y: index * 18 }),
        line({ text: `R${index}`, x: 360, xMax: 560, y: index * 18 })
      );
    }

    const ordered = orderLinesByLayout(interleaved, warnings);

    assert.deepEqual(
      ordered.map((item) => item.text),
      ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'R0', 'R1', 'R2', 'R3', 'R4', 'R5']
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /2-column text layout/);
  });

  runTest('keeps sparse pages in top-to-bottom order', () => {
    const ordered = orderLinesByLayout([
      line({ text: 'Second', y: 40 }),
      line({ text: 'First', y: 10 }),
      line({ text: 'Third', y: 70 })
    ]);

    assert.deepEqual(
      ordered.map((item) => item.text),
      ['First', 'Second', 'Third']
    );
  });
}

function line(overrides) {
  return {
    fontSize: 12,
    pageHeight: 800,
    pageNum: 1,
    pageWidth: 600,
    text: 'Body text',
    x: 40,
    xMax: 240,
    y: 0,
    ...overrides
  };
}
