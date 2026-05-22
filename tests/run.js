import { runLayoutTests } from './layout.test.js';
import { runMarkdownTests } from './markdown.test.js';
import { runOcrGeometryTests } from './ocr-geometry.test.js';

const failures = [];

function runTest(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures.push({ error, name });
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

runMarkdownTests(runTest);
runLayoutTests(runTest);
runOcrGeometryTests(runTest);

if (failures.length) {
  console.error(`${failures.length} test(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('All tests passed.');
}
