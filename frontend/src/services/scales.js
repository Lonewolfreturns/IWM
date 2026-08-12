// Scale registry — backed by the real API (see services/api.js for base URL).
import api from './api';

export async function getScales() {
  const { data } = await api.get('/scales');
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
