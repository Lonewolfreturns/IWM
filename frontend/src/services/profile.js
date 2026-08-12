// Current user's own profile. Role and status are deliberately not editable
// here — the API rejects them; only an admin can change those via /users.
import api from './api';

export async function getMyProfile() {
  const { data } = await api.get('/me');
  return data;
}

export async function updateMyProfile({ name, phone, city }) {
  const { data } = await api.patch('/me', { name, phone, city });
  // Keep the cached session user in sync so the sidebar/navbar update too.
  try {
    const cached = JSON.parse(localStorage.getItem('ww_user') || '{}');
    localStorage.setItem('ww_user', JSON.stringify({ ...cached, ...data }));
  } catch {
    /* a cache-refresh failure must not fail the save */
  }
  return data;
}
