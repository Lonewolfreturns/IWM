// Scale registry — backed by the real API (see services/api.js for base URL).
import api from './api';

/**
 * The caller's scales. Admins also get devices that are sending telemetry but
 * were never provisioned.
 *
 * `{ refresh: 1 }` bypasses the API's cache of which UIDs have reported. That
 * cache lives in the api Lambda and is invisible to the readings Lambda, so
 * after purging a device's readings this is the only way to stop the list
 * naming a device that no longer has any.
 */
export async function getScales(params) {
  const { data } = await api.get('/scales', params ? { params } : undefined);
  return data;
}

export async function addScale(payload) {
  const { data } = await api.post('/scales', payload);
  return data;
}

export async function updateScale(id, payload) {
  const { data } = await api.patch(`/scales/${id}`, payload);
  return data;
}

export async function deleteScale(id) {
  await api.delete(`/scales/${id}`);
  return { id };
}
