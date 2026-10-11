// Current user's own profile. Role and status are deliberately not editable
// here — the API rejects them; only an admin can change those via /users.
import api from './api';
import { patchUser } from '../native/session.js';

export async function getMyProfile() {
  const { data } = await api.get('/me');
  return data;
}

export async function updateMyProfile({ name, phone, city }) {
  const { data } = await api.patch('/me', { name, phone, city });
  // Keep the cached session user in sync so the sidebar/navbar update too.
  try {
    await patchUser(data);
  } catch {
    /* a cache-refresh failure must not fail the save */
  }
  return data;
}
