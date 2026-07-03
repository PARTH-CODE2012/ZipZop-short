const API_BASE = import.meta.env.VITE_API_BASE || '';

async function call(path, opts = {}) {
  const headers = opts.headers || {};
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  return res;
}

export async function register(username, password) {
  const res = await call('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return res.json();
}

export async function login(username, password) {
  const res = await call('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return res.json();
}

export async function upload(token, file) {
  const fd = new FormData();
  fd.append('video', file);
  const res = await fetch(`${API_BASE}/api/videos/upload`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: fd
  });
  return res.json();
}

export async function createJob(token, filename, operations) {
  const res = await fetch(`${API_BASE}/api/videos/process-v10`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, operations })
  });
  return res.json();
}

export async function getJob(token, id) {
  const res = await fetch(`${API_BASE}/api/videos/${id}/status`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return res.json();
}

export async function analyzeClipping(token, filename) {
  const res = await fetch(`${API_BASE}/api/clipping/analyze`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename })
  });
  return res.json();
}

export default {
  register,
  login,
  upload,
  createJob,
  getJob,
  analyzeClipping
};
