// =============================================================================
// IWM — Minimal multi-sheet XLSX writer
// =============================================================================
//
// Why hand-rolled rather than SheetJS: the only thing needed here is "several
// tables, typed cells, a styled header row". That is a few hundred lines of
// OOXML against ~400 kB of library, and this file sits next to the equally
// hand-rolled CSV and PDF helpers in fileExport.js.
//
// An .xlsx is a zip of XML parts. The minimum Excel will open:
//
//   [Content_Types].xml        declares the MIME type of every part
//   _rels/.rels                points at the workbook
//   xl/workbook.xml            lists the sheets
//   xl/_rels/workbook.xml.rels maps sheet ids to their files
//   xl/styles.xml              fonts/fills the cells reference by index
//   xl/worksheets/sheetN.xml   the actual cells
//
// Strings are written inline (t="inlineStr") rather than through a shared
// string table. Slightly larger on disk, and one whole part we don't maintain.
// =============================================================================

import { zipSync, strToU8 } from 'fflate';

// Style ids, matching the order of <cellXfs> in styles.xml below.
const STYLE = {
  normal: 0,
  head: 1,   // white on IWM sky — the header row of a data table
  title: 2,  // big bold, for a sheet's first line
  bold: 3,   // section labels
  wrap: 4,   // long prose that should wrap rather than run off the sheet
  muted: 5,  // secondary notes
};

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch]);
}

/** 0 -> A, 25 -> Z, 26 -> AA. Spreadsheet columns are bijective base-26. */
function colName(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * Excel rejects a workbook whose sheet names collide, exceed 31 characters or
 * contain []:*?/\ — all of which are easy to hit from a generated label, and
 * all of which surface as "the file is corrupt" rather than anything useful.
 */
function sheetNames(sheets) {
  const used = new Set();
  return sheets.map((s, i) => {
    let name = String(s.name || `Sheet${i + 1}`).replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31);
    if (!name) name = `Sheet${i + 1}`;
    let candidate = name;
    let n = 2;
    while (used.has(candidate.toLowerCase())) {
      const suffix = ` (${n++})`;
      candidate = name.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/**
 * A cell is either a bare value or { v, s } where `s` is a key of STYLE.
 * Numbers are written as numbers so Excel can sum and chart them; everything
 * else becomes an inline string. `null`/`undefined`/'' produce an empty cell
 * rather than the text "null".
 */
function cellXml(cell, ref) {
  const value = cell != null && typeof cell === 'object' && 'v' in cell ? cell.v : cell;
  const styleId = cell != null && typeof cell === 'object' && cell.s ? STYLE[cell.s] ?? 0 : 0;
  const s = styleId ? ` s="${styleId}"` : '';

  if (value == null || value === '') return `<c r="${ref}"${s}/>`;
  // isFinite guards NaN/Infinity, which are not representable in a numeric
  // cell and would make the sheet unreadable.
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"${s}><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

function sheetXml(sheet) {
  const rows = sheet.rows || [];

  const cols = (sheet.cols || []).length
    ? `<cols>${sheet.cols
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';

  // Freezing the header keeps the column names visible while scrolling several
  // thousand raw readings, which is the whole point of putting them in a sheet.
  const freeze = sheet.freeze
    ? '<sheetViews><sheetView workbookViewId="0">'
      + '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
      + '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'
      + '</sheetView></sheetViews>'
    : '';

  const body = rows
    .map((cells, r) => {
      const inner = cells
        .map((cell, c) => cellXml(cell, `${colName(c)}${r + 1}`))
        .join('');
      return `<row r="${r + 1}">${inner}</row>`;
    })
    .join('');

  // autoFilter goes after sheetData in the schema; putting it earlier is one of
  // the ways a generated workbook ends up "needing repair".
  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const filter =
    sheet.autoFilter && rows.length > 1 && width > 0
      ? `<autoFilter ref="A1:${colName(width - 1)}${rows.length}"/>`
      : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + freeze
    + cols
    + `<sheetData>${body}</sheetData>`
    + filter
    + `</worksheet>`;
}

// Fill 0 (none) and fill 1 (gray125) are required by the spec to occupy those
// exact slots — Excel reads fills positionally and mis-renders everything if
// custom fills start any earlier.
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="5">
<font><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="16"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
<font><sz val="10"/><color rgb="FF64748B"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF0EA5E9"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/**
 * Builds a workbook as a Blob.
 *
 * sheets: [{
 *   name,                       tab label
 *   rows: [[cell, ...], ...],   cell = value | { v, s: 'head'|'title'|'bold'|'wrap'|'muted' }
 *   cols: [width, ...],         optional column widths, in characters
 *   freeze: bool,               freeze the first row
 *   autoFilter: bool,           filter dropdowns across the first row
 * }]
 */
export function buildXLSX(sheets) {
  const names = sheetNames(sheets);

  const files = {
    '[Content_Types].xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
      + `<Default Extension="xml" ContentType="application/xml"/>`
      + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
      + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
      + sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
        )
        .join('')
      + `</Types>`,

    '_rels/.rels':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
      + `</Relationships>`,

    'xl/workbook.xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"`
      + ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
      + `<sheets>`
      + names
        .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')
      + `</sheets></workbook>`,

    'xl/_rels/workbook.xml.rels':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
        )
        .join('')
      + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + `</Relationships>`,

    'xl/styles.xml': STYLES_XML,
  };

  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s);
  });

  const zipped = zipSync(
    Object.fromEntries(Object.entries(files).map(([path, xml]) => [path, strToU8(xml)])),
    { level: 6 }
  );

  // Copy into a fresh ArrayBuffer: fflate may hand back a view onto a larger
  // pooled buffer, and Blob would otherwise capture the surrounding bytes.
  return new Blob([zipped.slice().buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export { STYLE };
