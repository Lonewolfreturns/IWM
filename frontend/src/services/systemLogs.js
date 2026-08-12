// System event log — backed by the real API.
import api from './api';

export async function getSystemLogs() {
  const { data } = await api.get('/system-logs');
  return data; // [{ id, timestamp, level, source, user, message }]
}
