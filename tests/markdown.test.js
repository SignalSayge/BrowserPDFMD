import assert from 'node:assert/strict';
import { linesToMarkdown } from '../src/convert/heuristics.js';
import { postprocessMarkdown } from '../src/convert/postprocess.js';
import { buildLineTexts } from '../src/pipeline/text.js';

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

  runTest('wraps bold and italic runs with emphasis markers', () => {
    const { text, mdText } = buildLineTexts([
      textItem({ text: 'Plain then ', x: 0, width: 60 }),
      textItem({ text: 'bold', x: 60, width: 24, bold: true }),
      textItem({ text: ' and ', x: 84, width: 28 }),
      textItem({ text: 'italic', x: 112, width: 30, italic: true }),
      textItem({ text: ' end.', x: 142, width: 26 })
    ]);

    assert.equal(text, 'Plain then bold and italic end.');
    assert.equal(mdText, 'Plain then **bold** and *italic* end.');
  });

  runTest('promotes bold body-sized lines to headings', () => {
    const markdown = linesToMarkdown([
      line({ text: 'Methods', mdText: '**Methods**', bold: true, fontSize: 12, y: 10 }),
      line({ text: 'Body text follows the bold heading.', fontSize: 12, y: 40 })
    ]);

    assert.match(markdown, /^### Methods\n/);
  });

  runTest('renders aligned multi-cell lines as a pipe table', () => {
    const markdown = linesToMarkdown([
      line({ text: 'Intro paragraph.', fontSize: 12, y: 10 }),
      line({
        text: 'Name Value',
        cells: [cell(40, 70, 'Name'), cell(300, 340, 'Value')],
        fontSize: 12,
        y: 40
      }),
      line({
        text: 'Alpha 1',
        cells: [cell(40, 75, 'Alpha'), cell(300, 310, '1')],
        fontSize: 12,
        y: 60
      })
    ]);

    assert.equal(
      markdown,
      'Intro paragraph.\n\n| Name | Value |\n| --- | --- |\n| Alpha | 1 |'
    );
  });

  runTest('rejects multi-cell lines whose gaps do not align', () => {
    const markdown = linesToMarkdown([
      line({
        text: 'Report Title 2024',
        cells: [cell(40, 100, 'Report Title'), cell(160, 200, '2024')],
        fontSize: 12,
        y: 10
      }),
      line({
        text: 'Prepared by Team',
        cells: [cell(40, 250, 'Prepared by'), cell(300, 340, 'Team')],
        fontSize: 12,
        y: 30
      })
    ]);

    assert.ok(!markdown.includes('|'), `expected no table, got:\n${markdown}`);
  });

  runTest('does not pull a distant gapped line into a table run', () => {
    const markdown = linesToMarkdown([
      line({
        text: 'Body text with incidental gap.',
        cells: [cell(40, 200, 'Body text with'), cell(230, 340, 'incidental gap.')],
        fontSize: 12,
        y: 10
      }),
      line({
        text: 'Name Value',
        cells: [cell(40, 70, 'Name'), cell(300, 340, 'Value')],
        fontSize: 12,
        y: 60
      }),
      line({
        text: 'Alpha 1',
        cells: [cell(40, 75, 'Alpha'), cell(300, 310, '1')],
        fontSize: 12,
        y: 80
      })
    ]);

    assert.match(markdown, /^Body text with incidental gap\.\n/);
    assert.match(markdown, /\| Name \| Value \|/);
  });

  runTest('merges extra per-row splits back into shared columns', () => {
    const markdown = linesToMarkdown([
      line({
        text: 'Name Value',
        cells: [cell(40, 70, 'Name'), cell(300, 340, 'Value')],
        fontSize: 12,
        y: 40
      }),
      line({
        text: 'Alpha Beta 1',
        cells: [cell(40, 75, 'Alpha'), cell(120, 150, 'Beta'), cell(300, 310, '1')],
        fontSize: 12,
        y: 60
      })
    ]);

    assert.match(markdown, /\| Alpha Beta \| 1 \|/);
  });

  runTest('postprocesses hyphenated line wraps and isolated page numbers', () => {
    const markdown = postprocessMarkdown('Long hyphen-\nated word\n\n12\n\nFinal paragraph');

    assert.equal(markdown, 'Long hyphenated word\n\nFinal paragraph');
  });
}

function cell(x, xEnd, text) {
  return { text, x, xEnd };
}

function textItem(overrides) {
  return { bold: false, fontSize: 12, italic: false, text: '', width: 0, x: 0, ...overrides };
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
