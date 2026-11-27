// Builds test/fixtures/sample.pptx (text, bullets, numbering, shapes, gradient, picture, table, chart, notes, hidden slide)
import PptxGenJS from 'pptxgenjs';
import { readFileSync, writeFileSync } from 'node:fs';

const p = new PptxGenJS();
p.layout = 'LAYOUT_WIDE';
p.title = 'Quarterly review';

p.defineSlideMaster({
  title: 'BRANDED',
  background: { color: 'F7F9FC' },
  objects: [
    { rect: { x: 0, y: 0, w: '100%', h: 0.35, fill: { color: 'C00000' } } },
    { text: { text: 'ACME Corp · Confidential', options: { x: 0.4, y: 7.0, w: 6, h: 0.4, fontSize: 11, color: '7F7F7F' } } },
    { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.6, w: 12, h: 1.0, fontSize: 36, bold: true, color: 'C00000' }, text: '' } },
    { placeholder: { options: { name: 'body', type: 'body', x: 0.5, y: 1.8, w: 12, h: 4.8, fontSize: 22, color: '262626' }, text: '' } },
  ],
  slideNumber: { x: 12.3, y: 7.0, w: 0.8, h: 0.4, fontSize: 11, color: '7F7F7F' },
});

let s = p.addSlide();
s.background = { color: '1F3864' };
s.addText('Quarterly Business Review', { x: 0.6, y: 2.2, w: 12, h: 1.4, fontSize: 44, bold: true, color: 'FFFFFF', fontFace: 'Calibri' });
s.addText('Q3 2026 · Sales & Operations', { x: 0.6, y: 3.6, w: 12, h: 0.8, fontSize: 24, color: 'BDD7EE', fontFace: 'Calibri' });
s.addShape(p.ShapeType.rect, { x: 0.6, y: 4.5, w: 3, h: 0.08, fill: { color: 'FFC000' }, line: { color: 'FFC000' } });

s = p.addSlide();
s.addText('Highlights', { x: 0.5, y: 0.3, w: 12, h: 0.9, fontSize: 32, bold: true, color: '1F3864' });
s.addText([
  { text: 'Revenue grew 18% year over year', options: { bullet: true } },
  { text: 'Driven by new enterprise customers', options: { bullet: true, indentLevel: 1 } },
  { text: 'Churn fell to 2.1%', options: { bullet: true } },
  { text: 'First step', options: { bullet: { type: 'number' } } },
  { text: 'Second step with a much longer line of text that has to wrap onto the next line inside the box', options: { bullet: { type: 'number' } } },
  { text: 'اردو متن بھی درست دکھنا چاہیے', options: { bullet: true, rtlMode: true } },
], { x: 0.5, y: 1.3, w: 6.5, h: 4.5, fontSize: 20, color: '333333', valign: 'top' });
s.addImage({ data: 'image/png;base64,' + readFileSync('test/fixtures/image.png').toString('base64'), x: 7.6, y: 1.4, w: 4.8, h: 3.2 });
s.addShape(p.ShapeType.roundRect, { x: 7.6, y: 5, w: 4.8, h: 1.2, fill: { color: '70AD47' }, line: { color: '507E32', width: 2 }, rectRadius: 0.2 });
s.addText('On track', { x: 7.6, y: 5, w: 4.8, h: 1.2, fontSize: 24, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle' });
s.addNotes('Speaker notes are not printed.');

s = p.addSlide();
s.addText('Regional results', { x: 0.5, y: 0.3, w: 12, h: 0.9, fontSize: 32, bold: true, color: '1F3864' });
s.addTable([
  [{ text: 'Region', options: { bold: true, fill: { color: '1F3864' }, color: 'FFFFFF' } }, { text: 'Q2', options: { bold: true, fill: { color: '1F3864' }, color: 'FFFFFF' } }, { text: 'Q3', options: { bold: true, fill: { color: '1F3864' }, color: 'FFFFFF' } }],
  ['North', '1.2M', '1.5M'], ['South', '0.9M', '1.1M'], ['East', '0.7M', '0.8M'],
], { x: 0.5, y: 1.4, w: 6, colW: [2.4, 1.8, 1.8], fontSize: 16, border: { type: 'solid', pt: 1, color: 'BFBFBF' }, fill: { color: 'F2F2F2' } });
s.addChart(p.ChartType.bar, [{ name: 'Q2', labels: ['North', 'South', 'East'], values: [1.2, 0.9, 0.7] }, { name: 'Q3', labels: ['North', 'South', 'East'], values: [1.5, 1.1, 0.8] }],
  { x: 7, y: 1.4, w: 5.8, h: 4.2, showLegend: true, legendPos: 'b', showTitle: true, title: 'Revenue by region' });
s.addShape(p.ShapeType.rightArrow, { x: 0.5, y: 5, w: 2.5, h: 1, fill: { color: 'ED7D31' }, rotate: 0 });
s.addShape(p.ShapeType.ellipse, { x: 3.4, y: 5, w: 1.6, h: 1, fill: { color: '5B9BD5' } });
s.addShape(p.ShapeType.line, { x: 5.3, y: 5.5, w: 1.2, h: 0, line: { color: 'C00000', width: 3, endArrowType: 'triangle' } });

s = p.addSlide({ masterName: 'BRANDED' });
s.addText('Placeholder title from the master', { placeholder: 'title' });
s.addText([{ text: 'Body text inherits size and colour', options: { bullet: true } }, { text: 'Second point', options: { bullet: true } }], { placeholder: 'body' });

s = p.addSlide();
s.hidden = true;
s.addText('Hidden backup slide', { x: 1, y: 1, w: 8, h: 1, fontSize: 30 });

writeFileSync('test/fixtures/sample.pptx', Buffer.from(await p.write({ outputType: 'nodebuffer' })));
console.log('wrote test/fixtures/sample.pptx');
