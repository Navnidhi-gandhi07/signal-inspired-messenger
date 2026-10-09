import type { User } from './types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/+$/, '') ?? '';

function configuredApiUrl(): string {
  if (!API_BASE_URL) {
    throw new Error('The API server URL is not configured. Set NEXT_PUBLIC_API_URL and redeploy.');
  }
  return API_BASE_URL;
}

export function apiUrl(path: string): string {
  return `${configuredApiUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

async function apiFetch(path: string, init: RequestInit): Promise<Response> {
  const url = apiUrl(path);
  try {
    return await fetch(url, init);
  } catch {
    throw new Error('Could not reach the API server. Check your connection and NEXT_PUBLIC_API_URL.');
  }
}

export function webSocketUrl(): string {
  const url = new URL(configuredApiUrl());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_API_URL must use HTTP or HTTPS.');
  }
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export async function request<T = unknown>(
  path: string,
  token: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await apiFetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
  });

  if (!response.ok) {
    let message = 'Request failed';
    try {
      const error: { detail?: string } = await response.json();
      message = error.detail || message;
    } catch {
      // Some error responses do not contain JSON.
    }
    throw new Error(message);
  }

  return response.json();
}

export async function uploadFile(
  file: File,
  token: string,
): Promise<{ url: string; name: string; kind: string }> {
  const data = new FormData();
  data.append('file', file);
  const response = await apiFetch('/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: data,
  });

  if (!response.ok) {
    let message = 'Upload failed';
    try {
      const error: { detail?: string } = await response.json();
      message = error.detail || message;
    } catch {
      // Some error responses do not contain JSON.
    }
    throw new Error(message);
  }

  const result: unknown = await response.json();
  if (
    !result ||
    typeof result !== 'object' ||
    !('url' in result) ||
    !('name' in result) ||
    !('kind' in result) ||
    typeof result.url !== 'string' ||
    typeof result.name !== 'string' ||
    typeof result.kind !== 'string'
  ) {
    throw new Error('The server returned an invalid attachment response');
  }
  return { url: result.url, name: result.name, kind: result.kind };
}

export async function uploadProfilePhoto(file: File, token: string): Promise<User> {
  const data = new FormData();
  data.append('file', file);
  const response = await apiFetch('/profile/avatar', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: data,
  });
  if (!response.ok) {
    let message = 'Profile photo upload failed';
    try {
      const error: { detail?: string } = await response.json();
      message = error.detail || message;
    } catch {
      // Some error responses do not contain JSON.
    }
    throw new Error(message);
  }
  const user: User = await response.json();
  return user;
}
