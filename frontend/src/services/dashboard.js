// Dashboard summary data — served by the iwm-readings Lambda.
import { readingsApi as api } from './api';

export async function getDashboardStats() {
  const { data } = await api.get('/dashboard/stats');
  return data; // { totalWasteToday, totalWasteYesterday, weeklyChangePct, activeScales, totalScales }
}

export async function getRecentAlerts() {
  const { data } = await api.get('/dashboard/alerts');
  return data; // [{ id, timestamp, scale, type, severity, status }]
}
