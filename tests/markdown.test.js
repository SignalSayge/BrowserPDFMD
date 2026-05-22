import assert from 'node:assert/strict';
import { linesToMarkdown } from '../src/convert/heuristics.js';
import { postprocessMarkdown } from '../src/convert/postprocess.js';

export function runMarkdownTests(runTest) {
  runTest('promotes short oversized lines to headings and keeps body text as paragraphs', () => {
    const markdown = linesToMarkdown([
      line({ text: 'Quarterly Summary', fontSize: 24, y: 10 }),
      line({ text: 'This is the first body paragraph.', fontSize: 12, y: 48 }),
      line({ text: 'This is the second body paragraph.', fontSize: 12, y: 68 }),
      line({ text: 'This is the third body paragraph.', fontSize: 12, y: 88 })
    ]);

    assert.equal(
      markdown,
      '# Quarterly Summary\nThis is the first body paragraph.\nThis is the second body paragraph.\nThis is the third body paragraph.'
    );
  });

  runTest('normalizes bullet and ordered list markers', () => {
    const markdown = linesToMarkdown([
      line({ text: 'Checklist', fontSize: 18, y: 10 }),
      line({ text: '\u2022 First task', fontSize: 12, y: 42, x: 36 }),
      line({ text: '2) Second task', fontSize: 12, y: 62, x: 72 }),
      line({ text: '- Third task', fontSize: 12, y: 82, x: 72 })
    ]);

    assert.match(markdown, /^## Checklist/);
    assert.match(markdown, /\n- First task/);
    assert.match(markdown, /\n\s*2\. Second task/);
    assert.match(markdown, /\n\s*- Third task/);
  });

  runTest('postprocesses hyphenated line wraps and isolated page numbers', () => {
    const markdown = postprocessMarkdown('Long hyphen-\nated word\n\n12\n\nFinal paragraph');

    assert.equal(markdown, 'Long hyphenated word\n\nFinal paragraph');
  });
}

function line(overrides) {
  return {
    fontSize: 12,
    pageHeight: 800,
    pageNum: 1,
    pageWidth: 600,
    text: 'Body text',
    x: 0,
    xMax: 300,
    y: 0,
    ...overrides
  };
}
