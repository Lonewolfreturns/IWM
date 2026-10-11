// =============================================================================
// IWM — Client-side file generation utilities (CSV / JSON / PDF)
// =============================================================================
//
// Used by Reports to produce real downloadable files (no backend).
// PDFs are styled with the IWM brand.
// =============================================================================

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { buildXLSX } from './xlsx.js';
import { saveFile } from '../native/saveFile.js';

/*
 * Every export in this file ends here.
 *
 * On the web this is still an `<a download>` click. In the Android and iOS
 * apps there is no download manager for that to talk to, so the blob is
 * written into the app's cache and handed to the system share sheet instead.
 * See native/saveFile.js.
 *
 * Returns the promise so a caller can tell a completed save from a dismissed
 * share sheet. Nothing awaits it today — the exports are fire-and-forget from
 * a click handler — but swallowing it here would make that impossible to add.
 */
function triggerDownload(blob, filename) {
  return saveFile(blob, filename);
}

// -----------------------------------------------------------------------------
// CSV — RFC-4180 escaping + UTF-8 BOM for Excel compatibility.
// -----------------------------------------------------------------------------
export function downloadCSV(filename, columns, rows) {
  const escape = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map(escape).join(',');
  const body = rows.map((r) => r.map(escape).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + header + '\n' + body], {
    type: 'text/csv;charset=utf-8',
  });
  return triggerDownload(blob, filename);
}

// -----------------------------------------------------------------------------
// XLSX — a real workbook, one sheet per table.
//
// The CSV above can only ever be one flat grid, which is why the summary and
// the raw readings used to be stacked into the same four columns. A workbook
// lets each table keep its own shape and its own headers.
//
// `sheets` is passed straight through to buildXLSX; see xlsx.js for the shape.
// -----------------------------------------------------------------------------
export function downloadXLSX(filename, sheets) {
  return triggerDownload(buildXLSX(sheets), filename);
}

// -----------------------------------------------------------------------------
// JSON — pretty-printed, with sensible export envelope.
// -----------------------------------------------------------------------------
export function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  return triggerDownload(blob, filename);
}

// -----------------------------------------------------------------------------
// PDF — branded IWM report.
//
// opts: {
//   title, subtitle, dateRange,
//   sections: [
//     { type: 'heading', text }
//   | { type: 'paragraph', text }
//   | { type: 'kv', items: [[label, value], ...] }
//   | { type: 'table', columns, rows }
//   ],
//   footer
// }
// -----------------------------------------------------------------------------

const BRAND = {
  navy: [15, 23, 42],
  sky: [56, 189, 248],
  leaf: [34, 197, 94],
  amber: [245, 158, 11],
  violet: [167, 139, 250],
  danger: [239, 68, 68],
  ink: [30, 41, 59],
  text: [15, 23, 42],
  mute: [100, 116, 139],
  soft: [148, 163, 184],
  rule: [226, 232, 240],
  wash: [248, 250, 252],
};

/**
 * Makes a string safe for jsPDF's built-in Helvetica.
 *
 * The standard PDF fonts are WinAnsi-encoded and hold no glyph for the
 * typographic characters this app uses freely on screen. Given one, jsPDF
 * silently switches that run to a 16-bit encoding it cannot render, and the
 * text comes out as spaced-apart characters around a stray "!" — which is
 * exactly what "2026-06-10 → 2026-06-30" turned into in the first exports.
 *
 * Sanitising here rather than at the call sites keeps the arrow on screen,
 * where it renders perfectly well, and only substitutes at the point the text
 * enters a PDF. Anything above Latin-1 that isn't explicitly mapped is dropped
 * rather than passed through, since one unmapped glyph corrupts a whole run.
 */
const PDF_CHAR_MAP = {
  '→': '->', '←': '<-', '–': '-', '—': '-',
  '‘': "'", '’': "'", '“': '"', '”': '"',
  '…': '...', '−': '-', ' ': ' ', '•': '-',
  '≥': '>=', '≤': '<=', '×': 'x',
};

function T(value) {
  if (value == null) return '';
  return String(value)
    .replace(/[←→–—‘’“”…− •≥≤×]/g,
      (c) => PDF_CHAR_MAP[c])
    .replace(/[^\x00-\xFF]/g, '');
}

/** Accepts "#38BDF8" or [r,g,b]; falls back to sky. */
function toRGB(color, fallback = BRAND.sky) {
  if (Array.isArray(color) && color.length === 3) return color;
  if (typeof color === 'string' && /^#?[0-9a-f]{6}$/i.test(color)) {
    const h = color.replace('#', '');
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  return fallback;
}

function niceNumber(v) {
  if (!Number.isFinite(v)) return '0';
  if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString('en-CA');
  return String(Math.round(v * 10) / 10);
}

/**
 * Charts are drawn with jsPDF primitives rather than rasterised from the DOM.
 *
 * Screen-capturing the live Recharts components would mean the export could
 * only contain what happened to be rendered and visible at that moment, at
 * screen resolution, and would need the charts mounted to export at all.
 * Drawing them here keeps the PDF vector-sharp, independent of what is on
 * screen, and able to show sections the page never displays.
 */
function drawBarChart(doc, x, y, w, h, data, opts = {}) {
  const { unit = 'kg', axisLabel = true } = opts;
  const values = data.map((d) => Number(d.value) || 0);
  const max = Math.max(...values, 0) || 1;

  const padLeft = 44;
  const padBottom = axisLabel ? 26 : 12;
  const plotW = w - padLeft;
  const plotH = h - padBottom;

  // Gridlines and y-axis ticks
  doc.setDrawColor(...BRAND.rule);
  doc.setLineWidth(0.4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...BRAND.soft);
  for (let i = 0; i <= 4; i++) {
    const gy = y + plotH - (plotH * i) / 4;
    doc.line(x + padLeft, gy, x + w, gy);
    doc.text(niceNumber((max * i) / 4), x + padLeft - 5, gy + 2.5, { align: 'right' });
  }

  const slot = plotW / Math.max(1, data.length);
  const barW = Math.min(46, slot * 0.62);

  data.forEach((d, i) => {
    const value = Number(d.value) || 0;
    const bh = max > 0 ? (plotH * value) / max : 0;
    const bx = x + padLeft + slot * i + (slot - barW) / 2;
    const by = y + plotH - bh;

    doc.setFillColor(...toRGB(d.color));
    if (bh > 2) doc.roundedRect(bx, by, barW, bh, 2, 2, 'F');

    // Value above the bar
    if (value > 0) {
      doc.setFontSize(7);
      doc.setTextColor(...BRAND.text);
      doc.setFont('helvetica', 'bold');
      doc.text(niceNumber(value), bx + barW / 2, by - 3, { align: 'center' });
    }

    if (axisLabel) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...BRAND.mute);
      const label = doc.splitTextToSize(T(d.label), slot - 2)[0] || '';
      doc.text(label, bx + barW / 2, y + plotH + 11, { align: 'center' });
      if (d.sublabel) {
        doc.setFontSize(6);
        doc.setTextColor(...BRAND.soft);
        doc.text(T(d.sublabel), bx + barW / 2, y + plotH + 19, { align: 'center' });
      }
    }
  });

  // Baseline
  doc.setDrawColor(...BRAND.mute);
  doc.setLineWidth(0.6);
  doc.line(x + padLeft, y + plotH, x + w, y + plotH);

  if (unit) {
    doc.setFontSize(7);
    doc.setTextColor(...BRAND.soft);
    doc.text(T(unit), x + padLeft - 5, y - 3, { align: 'right' });
  }
  return h;
}

/** Two series side by side — this period against the one before it. */
function drawGroupedBars(doc, x, y, w, h, data, opts = {}) {
  const { series = [], unit = 'kg' } = opts;
  const values = data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0));
  const max = Math.max(...values, 0) || 1;

  const padLeft = 44;
  const padBottom = 26;
  const plotW = w - padLeft;
  const plotH = h - padBottom;

  doc.setDrawColor(...BRAND.rule);
  doc.setLineWidth(0.4);
  doc.setFontSize(7);
  doc.setTextColor(...BRAND.soft);
  for (let i = 0; i <= 4; i++) {
    const gy = y + plotH - (plotH * i) / 4;
    doc.line(x + padLeft, gy, x + w, gy);
    doc.text(niceNumber((max * i) / 4), x + padLeft - 5, gy + 2.5, { align: 'right' });
  }

  const slot = plotW / Math.max(1, data.length);
  const groupW = Math.min(52, slot * 0.66);
  const barW = groupW / Math.max(1, series.length);

  data.forEach((d, i) => {
    const gx = x + padLeft + slot * i + (slot - groupW) / 2;
    series.forEach((s, j) => {
      const value = Number(d[s.key]) || 0;
      const bh = max > 0 ? (plotH * value) / max : 0;
      const bx = gx + barW * j;
      doc.setFillColor(...toRGB(s.color));
      if (bh > 1.5) doc.roundedRect(bx + 1, y + plotH - bh, barW - 2, bh, 1.5, 1.5, 'F');
    });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...BRAND.mute);
    doc.text(T(d.label), gx + groupW / 2, y + plotH + 11, { align: 'center' });
  });

  doc.setDrawColor(...BRAND.mute);
  doc.setLineWidth(0.6);
  doc.line(x + padLeft, y + plotH, x + w, y + plotH);

  // Legend
  let lx = x + padLeft;
  series.forEach((s) => {
    doc.setFillColor(...toRGB(s.color));
    doc.roundedRect(lx, y + plotH + 16, 7, 7, 1.5, 1.5, 'F');
    doc.setFontSize(7.5);
    doc.setTextColor(...BRAND.mute);
    doc.text(T(s.label), lx + 11, y + plotH + 22);
    lx += doc.getTextWidth(T(s.label)) + 28;
  });

  if (unit) {
    doc.setFontSize(7);
    doc.setTextColor(...BRAND.soft);
    doc.text(unit, x + padLeft - 5, y - 3, { align: 'right' });
  }
  return h;
}

/**
 * Calendar heatmap — one cell per day, shaded by intensity.
 *
 * Reads as a month at a glance: gaps in coverage show up as blank squares
 * in the grid, which is far more legible than the same information as a
 * column of zeroes in a table.
 */
function drawHeatmap(doc, x, y, w, weeks, opts = {}) {
  const { dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'], legend = 'samples' } = opts;
  const all = weeks.flat().filter((c) => c && c.value != null).map((c) => c.value);
  const max = Math.max(...all, 0) || 1;

  const labelW = 26;
  const cell = Math.min(30, (w - labelW) / 7 - 4);
  const gap = 4;
  const gridW = (cell + gap) * 7;

  // Column headers
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...BRAND.soft);
  dayLabels.forEach((d, i) => {
    doc.text(d, x + labelW + i * (cell + gap) + cell / 2, y, { align: 'center' });
  });

  let cy = y + 8;
  weeks.forEach((week, wi) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...BRAND.soft);
    doc.text(`W${wi + 1}`, x + labelW - 6, cy + cell / 2 + 2, { align: 'right' });

    week.forEach((c, di) => {
      const cx = x + labelW + di * (cell + gap);
      if (!c) {
        // Outside the month entirely — left blank rather than drawn as zero,
        // which would read as "a day with no waste".
        return;
      }
      const t = max > 0 ? c.value / max : 0;
      // Light sky -> deep blue, matching the app's own heatmap ramp.
      const r = Math.round(226 - 170 * t);
      const g = Math.round(240 - 141 * t);
      const b = Math.round(253 - 45 * t);
      doc.setFillColor(r, g, b);
      doc.roundedRect(cx, cy, cell, cell, 3, 3, 'F');

      doc.setFontSize(6.5);
      doc.setTextColor(...(t > 0.55 ? [255, 255, 255] : BRAND.mute));
      doc.text(String(c.day), cx + 3, cy + 8);
      if (c.value > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.text(String(c.value), cx + cell / 2, cy + cell - 5, { align: 'center' });
        doc.setFont('helvetica', 'normal');
      }
    });
    cy += cell + gap;
  });

  // Scale legend
  doc.setFontSize(7);
  doc.setTextColor(...BRAND.soft);
  doc.text(T(`0 ${legend}`), x + labelW, cy + 10);
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    doc.setFillColor(
      Math.round(226 - 170 * t),
      Math.round(240 - 141 * t),
      Math.round(253 - 45 * t)
    );
    doc.rect(x + labelW + 52 + i * 14, cy + 4, 12, 8, 'F');
  }
  doc.text(`${max}`, x + labelW + 52 + 6 * 14 + 4, cy + 10);

  return cy - y + 20;
}

/** Horizontal proportion bar — category share without a pie. */
function drawStackedShare(doc, x, y, w, data) {
  const total = data.reduce((a, d) => a + (Number(d.value) || 0), 0) || 1;
  const h = 16;
  let cx = x;

  data.forEach((d) => {
    const seg = (w * (Number(d.value) || 0)) / total;
    if (seg <= 0) return;
    doc.setFillColor(...toRGB(d.color));
    doc.rect(cx, y, seg, h, 'F');
    cx += seg;
  });

  // Rounded ends via a hairline frame keeps it crisp at any zoom.
  doc.setDrawColor(...BRAND.rule);
  doc.setLineWidth(0.4);
  doc.rect(x, y, w, h);

  let ly = y + h + 12;
  let lx = x;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  data.forEach((d) => {
    const pct = Math.round(((Number(d.value) || 0) / total) * 100);
    const text = T(`${d.label} ${pct}%`);
    const tw = doc.getTextWidth(text) + 26;
    if (lx + tw > x + w) {
      lx = x;
      ly += 13;
    }
    doc.setFillColor(...toRGB(d.color));
    doc.roundedRect(lx, ly - 6, 7, 7, 1.5, 1.5, 'F');
    doc.setTextColor(...BRAND.mute);
    doc.text(text, lx + 11, ly);
    lx += tw;
  });

  return ly - y + 8;
}

export function downloadPDF(filename, opts) {
  const {
    title = 'IWM Report',
    subtitle,
    dateRange,
    sections = [],
    footer = 'IWM · iwm.ca',
  } = opts;

  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;

  // --- Cover band ----------------------------------------------------------
  // The title sits inside the navy band rather than below it, so the first
  // thing on the page is what the document is and what it covers — matching
  // the site's own dark header instead of reading like a generic memo.
  const bandH = 132;
  doc.setFillColor(...BRAND.navy);
  doc.rect(0, 0, pageW, bandH, 'F');
  // Sky underline along the band edge, echoing the app's accent rule.
  doc.setFillColor(...BRAND.sky);
  doc.rect(0, bandH - 3, pageW, 3, 'F');

  doc.setFillColor(...BRAND.leaf);
  doc.roundedRect(margin, 26, 26, 26, 8, 8, 'F');
  doc.setTextColor(...BRAND.navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('IWM', margin + 13, 42, { align: 'center' });

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Innovative Waste Management', margin + 36, 38);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...BRAND.soft);
  doc.text('Reducing Food Waste Across Canada', margin + 36, 50);

  doc.setFontSize(8);
  doc.setTextColor(...BRAND.soft);
  doc.text(
    new Date().toLocaleString('en-CA', {
      month: 'short', day: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }),
    pageW - margin,
    38,
    { align: 'right' }
  );
  doc.setTextColor(...BRAND.sky);
  doc.setFont('helvetica', 'bold');
  doc.text('CONFIDENTIAL', pageW - margin, 50, { align: 'right' });

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(21);
  const titleLines = doc.splitTextToSize(T(title), pageW - margin * 2);
  doc.text(titleLines[0], margin, 92);

  if (dateRange) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...BRAND.sky);
    doc.text(T(dateRange), margin, 112);
  }
  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...BRAND.soft);
    doc.text(T(subtitle), pageW - margin, 112, { align: 'right' });
  }

  let y = bandH + 34;

  // --- Sections ------------------------------------------------------------
  const ensureSpace = (needed) => {
    if (y + needed > pageH - 60) {
      doc.addPage();
      y = 60;
    }
  };

  for (const section of sections) {
    if (section.type === 'heading') {
      ensureSpace(28);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(...BRAND.text);
      doc.text(T(section.text), margin, y);

      // Accent underline
      doc.setDrawColor(...BRAND.sky);
      doc.setLineWidth(1.5);
      doc.line(margin, y + 4, margin + 32, y + 4);
      y += 20;
    } else if (section.type === 'paragraph') {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(...BRAND.mute);
      const lines = doc.splitTextToSize(T(section.text), pageW - margin * 2);
      ensureSpace(lines.length * 14 + 8);
      doc.text(lines, margin, y);
      y += lines.length * 14 + 10;
    } else if (section.type === 'kv') {
      const colW = (pageW - margin * 2) / 2 - 6;
      doc.setFontSize(10);
      section.items.forEach(([k, v], idx) => {
        const col = idx % 2;
        const x = margin + col * (colW + 12);
        if (col === 0) ensureSpace(36);

        doc.setFillColor(248, 250, 252);
        doc.roundedRect(x, y - 12, colW, 32, 6, 6, 'F');
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...BRAND.mute);
        doc.setFontSize(8.5);
        doc.text(T(k).toUpperCase(), x + 10, y - 1);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...BRAND.text);
        doc.setFontSize(12);
        doc.text(T(v), x + 10, y + 13);

        if (col === 1 || idx === section.items.length - 1) {
          y += 40;
        }
      });
      y += 4;
    } else if (section.type === 'table') {
      ensureSpace(50);
      autoTable(doc, {
        startY: y,
        head: [section.columns.map(T)],
        body: section.rows.map((r) => r.map(T)),
        theme: 'striped',
        headStyles: {
          fillColor: BRAND.sky,
          textColor: BRAND.navy,
          fontStyle: 'bold',
          fontSize: 9,
          halign: 'left',
        },
        bodyStyles: {
          fontSize: 9,
          textColor: BRAND.text,
        },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        styles: { cellPadding: 7, lineColor: BRAND.rule, lineWidth: 0.4 },
        margin: { left: margin, right: margin },
      });
      y = doc.lastAutoTable.finalY + 18;
    } else if (section.type === 'barchart') {
      const h = section.height || 150;
      ensureSpace(h + 16);
      y += drawBarChart(doc, margin, y, pageW - margin * 2, h, section.data || [], {
        unit: section.unit,
      });
      y += 18;
    } else if (section.type === 'groupedbar') {
      const h = section.height || 160;
      ensureSpace(h + 16);
      y += drawGroupedBars(doc, margin, y, pageW - margin * 2, h, section.data || [], {
        series: section.series || [],
        unit: section.unit,
      });
      y += 18;
    } else if (section.type === 'heatmap') {
      // Height is data-dependent (weeks in the month), so it is measured
      // before reserving space rather than assumed.
      const estimated = (section.weeks?.length || 0) * 34 + 44;
      ensureSpace(estimated);
      y += drawHeatmap(doc, margin, y, pageW - margin * 2, section.weeks || [], {
        legend: section.legend,
      });
      y += 12;
    } else if (section.type === 'share') {
      ensureSpace(70);
      y += drawStackedShare(doc, margin, y, pageW - margin * 2, section.data || []);
      y += 10;
    } else if (section.type === 'callout') {
      // Font must be set BEFORE measuring: splitTextToSize wraps against
      // whatever size is currently active, and the charts above leave it at 6
      // or 7pt. Measuring first produced lines sized for 7pt text that were
      // then drawn at 9.5pt, so a long callout ran clean off the page edge.
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      const lines = doc.splitTextToSize(T(section.text), pageW - margin * 2 - 28);
      const h = lines.length * 12 + 20;
      ensureSpace(h + 8);
      const tint =
        section.tone === 'warn' ? [255, 251, 235]
          : section.tone === 'bad' ? [254, 242, 242]
          : BRAND.wash;
      const edge =
        section.tone === 'warn' ? BRAND.amber
          : section.tone === 'bad' ? BRAND.danger
          : BRAND.sky;
      doc.setFillColor(...tint);
      doc.roundedRect(margin, y - 10, pageW - margin * 2, h, 5, 5, 'F');
      doc.setFillColor(...edge);
      doc.rect(margin, y - 10, 3, h, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(...BRAND.text);
      doc.text(lines, margin + 14, y + 2);
      y += h + 6;
    } else if (section.type === 'spacer') {
      y += section.size || 12;
    } else if (section.type === 'pagebreak') {
      doc.addPage();
      y = 60;
    }
  }

  // --- Footer (every page) -------------------------------------------------
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);

    doc.setDrawColor(...BRAND.rule);
    doc.setLineWidth(0.4);
    doc.line(margin, pageH - 36, pageW - margin, pageH - 36);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...BRAND.soft);
    doc.text(T(footer), margin, pageH - 22);
    doc.text(`Page ${i} of ${total}`, pageW - margin, pageH - 22, {
      align: 'right',
    });
  }

  // `doc.save()` is jsPDF's own `<a download>` click, so it silently does
  // nothing inside a WebView. Taking the blob and routing it through the same
  // path as every other export is what makes PDF reports work in the apps.
  return triggerDownload(doc.output('blob'), filename);
}

// -----------------------------------------------------------------------------
// Convenience: slugify a string for filenames.
// -----------------------------------------------------------------------------
export function slugify(s) {
  return String(s || 'iwm')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80);
}
