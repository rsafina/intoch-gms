const fs = require('fs');
const path = require('path');
const d = require('docx');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  LevelFormat, Footer, PageNumber, ImageRun, convertInchesToTwip,
} = d;

// ── Screenshots ─────────────────────────────────────────────────────────
// Produced by capture-manual-screens.mjs into this folder under fixed
// names. When a file is absent the figure is simply skipped, so the
// document stays clean until the pictures exist. SHOW_PLACEHOLDERS=1 draws
// a marked frame instead, for reviewing where each picture will land.
const SCREENS = process.env.SCREENS || path.join(__dirname, 'screens');
const SHOW_PLACEHOLDERS = process.env.SHOW_PLACEHOLDERS === '1';
const CAPTURED_AT = (() => {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(SCREENS, 'manifest.json'), 'utf8'));
    return m.captured_at ? new Date(m.captured_at).toLocaleDateString('id-ID',
      { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  } catch { return null; }
})();

// PNG dimensions straight out of the IHDR chunk. No image library needed.
function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

let chapterNo = 0;
let figNo = 0;

// One picture per procedure. Scaled to the text column and capped in height
// so a tall modal cannot push its own caption onto the next page.
function figure(file, caption) {
  figNo += 1;
  const label = 'Gambar ' + chapterNo + '.' + figNo;
  const full = path.join(SCREENS, file + '.png');
  const captionPara = (extra) => new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240, before: 80 },
    children: [
      new TextRun({ text: label + '. ', size: 18, bold: true, color: GREY }),
      new TextRun({ text: caption, size: 18, color: GREY }),
      ...(extra ? [new TextRun({ text: extra, size: 18, color: GREY, italics: true })] : []),
    ],
  });

  if (fs.existsSync(full)) {
    const data = fs.readFileSync(full);
    const { width, height } = pngSize(data);
    const maxW = 600, maxH = 620;
    const scale = Math.min(maxW / width, maxH / height, 1);
    return [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 140, after: 0 },
        children: [new ImageRun({
          data, type: 'png',
          transformation: { width: Math.round(width * scale), height: Math.round(height * scale) },
        })],
      }),
      captionPara(CAPTURED_AT ? '  ·  diambil ' + CAPTURED_AT : ''),
    ];
  }

  if (!SHOW_PLACEHOLDERS) return [];
  return [
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [9360],
      borders: {
        top: { style: BorderStyle.DASHED, size: 6, color: 'BDB6AA' },
        bottom: { style: BorderStyle.DASHED, size: 6, color: 'BDB6AA' },
        left: { style: BorderStyle.DASHED, size: 6, color: 'BDB6AA' },
        right: { style: BorderStyle.DASHED, size: 6, color: 'BDB6AA' },
        insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      },
      rows: [new TableRow({ cantSplit: true, children: [new TableCell({
        width: { size: 9360, type: WidthType.DXA },
        margins: { top: 420, bottom: 420, left: 200, right: 200 },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 },
          children: [new TextRun({ text: 'screenshot menyusul: ' + file + '.png', size: 19, color: GREY, italics: true })] })],
      })] })],
    }),
    captionPara(''),
  ];
}

const INK = '1F3864';
const ACC = '9F6404';
const GREY = '595959';
const BLUE = '1F6FA8';
const GREEN = '3D7A4E';
const RED = 'C0392B';

let stepInstance = 0;

const spacer = (after = 200) => new Paragraph({ spacing: { after }, children: [] });

const P = (text, opts = {}) => new Paragraph({
  spacing: { after: opts.after ?? 130, line: 288 },
  alignment: opts.align,
  children: [new TextRun({ text, size: opts.size ?? 21, color: opts.color, bold: opts.bold, italics: opts.italics })],
});

const H1 = (text) => {
  // The figure number follows the chapter, so a picture is "Gambar 3.2"
  // rather than a running count nobody can locate.
  const m = /^(\d+)\./.exec(text);
  if (m) { chapterNo = Number(m[1]); figNo = 0; }
  return H1para(text);
};

const H1para = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1, pageBreakBefore: true,
  spacing: { before: 0, after: 220 },
  children: [new TextRun({ text, size: 32, bold: true, color: INK })],
});

const H2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 300, after: 150 },
  children: [new TextRun({ text, size: 25, bold: true, color: INK })],
});

const H3 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_3,
  spacing: { before: 230, after: 110 },
  children: [new TextRun({ text, size: 22, bold: true, color: ACC })],
});

const steps = (items, instance) => items.map(t => new Paragraph({
  numbering: { reference: 'steps', level: 0, instance },
  spacing: { after: 100, line: 288 },
  children: [new TextRun({ text: t, size: 21 })],
}));

const proc = (items) => { stepInstance += 1; return steps(items, stepInstance); };

const bullets = (items) => items.map(t => new Paragraph({
  numbering: { reference: 'dots', level: 0 },
  spacing: { after: 90, line: 288 },
  children: [new TextRun({ text: t, size: 21 })],
}));

// A field list: what to type into each box on screen.
const fields = (rows) => [
  spacer(60),
  table(['Kolom di layar', 'Isi dengan apa', 'Wajib?'], rows, [2300, 5400, 1660]),
  spacer(170),
];

const box = (title, lines, fill, bar) => new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [9360],
  borders: {
    top: { style: BorderStyle.SINGLE, size: 2, color: fill },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: fill },
    right: { style: BorderStyle.SINGLE, size: 2, color: fill },
    left: { style: BorderStyle.SINGLE, size: 18, color: bar },
    insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  },
  rows: [new TableRow({
    cantSplit: true,
    children: [new TableCell({
      width: { size: 9360, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill, color: 'auto' },
      margins: { top: 150, bottom: 150, left: 200, right: 200 },
      children: [
        new Paragraph({
          spacing: { after: 90 },
          children: [new TextRun({ text: title, size: 19, bold: true, color: bar, allCaps: true })],
        }),
        ...lines.map((l, i) => new Paragraph({
          spacing: { after: i === lines.length - 1 ? 0 : 90, line: 288 },
          children: [new TextRun({ text: l, size: 20 })],
        })),
      ],
    })],
  })],
});

const istilah = (lines) => [box('Istilah', lines, 'EAF1F6', BLUE), spacer(170)];
const ingat = (lines) => [box('Ingat ini', lines, 'F4F1EA', ACC), spacer(170)];
const jangan = (lines) => [box('Jangan sampai begini', lines, 'FBEEE9', RED), spacer(170)];
const salah = (lines) => [box('Kalau tadi salah isi', lines, 'EDF3EC', GREEN), spacer(170)];

function table(header, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (text, { bold, fill } = {}) => (w) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    shading: fill ? { type: ShadingType.CLEAR, fill, color: 'auto' } : undefined,
    margins: { top: 95, bottom: 95, left: 135, right: 135 },
    children: [new Paragraph({
      spacing: { after: 0, line: 270 },
      children: [new TextRun({ text, size: 19, bold, color: bold ? INK : undefined })],
    })],
  });
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'D8D2C8' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D8D2C8' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'D8D2C8' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'D8D2C8' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'E6E1D8' },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'E6E1D8' },
    },
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true,
        children: header.map((h, i) => cell(h, { bold: true, fill: 'F4F1EA' })(widths[i])) }),
      ...rows.map(r => new TableRow({ cantSplit: true,
        children: r.map((c, i) => cell(c)(widths[i])) })),
    ],
  });
}

// One-line flow strip: A → B → C
const flow = (stages) => [
  spacer(60),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: Array(stages.length).fill(Math.floor(9360 / stages.length)),
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    },
    rows: [new TableRow({
      cantSplit: true,
      children: stages.map((s, i) => new TableCell({
        width: { size: Math.floor(9360 / stages.length), type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: i % 2 ? 'F4F1EA' : 'EAF1F6', color: 'auto' },
        margins: { top: 130, bottom: 130, left: 110, right: 110 },
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 },
            children: [new TextRun({ text: 'Langkah ' + (i + 1), size: 16, bold: true, color: GREY, allCaps: true })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0, line: 260 },
            children: [new TextRun({ text: s, size: 19, bold: true, color: INK })] }),
        ],
      })),
    })],
  }),
  spacer(210),
];


// Figure numbering is reset per document by the builder.
function resetFigures() { chapterNo = 0; figNo = 0; }

module.exports = {
  d, fs, path, INK, ACC, GREY, BLUE, GREEN, RED,
  P, H1, H2, H3, proc, bullets, fields, table, box, flow,
  istilah, ingat, jangan, salah, spacer, figure, resetFigures,
  Document: d.Document, Packer: d.Packer, Paragraph: d.Paragraph, TextRun: d.TextRun,
  AlignmentType: d.AlignmentType, LevelFormat: d.LevelFormat, Footer: d.Footer,
  PageNumber: d.PageNumber, convertInchesToTwip: d.convertInchesToTwip,
};
