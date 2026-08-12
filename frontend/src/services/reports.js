// Report payloads — served by the iwm-reports Lambda.
//
// `/reports/build` composes only the sections asked for, so a summary export
// doesn't drag several thousand raw rows across the wire. Every response
// carries `coverage`, which a generated document has to be able to state on
// its own face: "this covers 15–30 June, not the whole month".
import { reportsApi as api } from './api';

export const SECTIONS = {
  TOTAL: 'total',
  CATEGORY: 'category',
  SCALE: 'scale',
  MEALS: 'meals',
  DAILY: 'daily',
  RAW: 'raw',
};

function buildParams({ from, to, uid, sections, limit } = {}) {
  const params = {};
  if (from) params.from = from;
  if (to) params.to = to;
  if (uid && uid !== 'all') params.uid = uid;
  if (sections?.length) params.sections = sections.join(',');
  if (limit) params.limit = limit;
  return params;
}

/**
 * One payload: { coverage, generatedAt, scope, sections }.
 *
 * Throws rather than returning an error envelope — unlike a chart, a report is
 * an explicit user action, and silently producing an empty document is worse
 * than telling someone the export failed.
 */
export async function buildReport(opts) {
  const { data } = await api.get('/reports/build', { params: buildParams(opts) });
  return data;
}

/** { coverage, raw: { columns, rows, count, totalAvailable, truncated } } */
export async function getRawRows(opts) {
  const { data } = await api.get('/reports/raw', { params: buildParams(opts) });
  return data;
}

/** Coverage only — for showing what a range holds before generating anything. */
export async function getReportCoverage(opts) {
  const { data } = await api.get('/reports/coverage', { params: buildParams(opts) });
  return data;
}
