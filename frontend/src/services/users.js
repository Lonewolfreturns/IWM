// User directory — backed by the real API. Admin-only in practice (see
// UserManagement.jsx / Settings.jsx's scale-assignment tab).
import api from './api';

export async function getUsers() {
  const { data } = await api.get('/users');
  return data;
}

// There is deliberately no createUser(): accounts are only ever created by
// the user themselves via /auth/signup, and admins are provisioned directly
// in DynamoDB with aws/scripts/create_admin.py.

export async function updateUser(id, payload) {
  const { data } = await api.patch(`/users/${id}`, payload);
  return data;
}

export async function deleteUser(id) {
  await api.delete(`/users/${id}`);
  return { id };
}
