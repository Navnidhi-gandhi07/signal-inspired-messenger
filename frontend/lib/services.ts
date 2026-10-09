import { request, uploadFile, uploadProfilePhoto } from './api';
import type { Chat, Message, Preferences, User } from './types';

export interface AuthResult {
  token: string;
  user: User;
}

export interface ConversationMember extends User {
  is_admin: boolean;
}

export const authService = {
  signIn: (username: string, password: string) =>
    request<AuthResult>('/auth/login', '', 'POST', { username, password }),
  register: (user: { username: string; password: string; display_name: string }) =>
    request<AuthResult>('/auth/register', '', 'POST', user),
  getProfile: (token: string) => request<User>('/me', token),
  signOut: (token: string) => request<{ ok: boolean }>('/auth/logout', token, 'POST'),
  updateAvatar: (token: string, file: File) => uploadProfilePhoto(file, token),
  updateProfile: (
    token: string,
    profile: { display_name: string; about: string },
  ) => request<User>('/me', token, 'PATCH', profile),
};

export const contactService = {
  search: (token: string, query = '') =>
    request<User[]>(`/users${query ? `?q=${encodeURIComponent(query)}` : ''}`, token),
};

export const conversationService = {
  list: (token: string) => request<Chat[]>('/conversations', token),
  openDirect: (token: string, userId: number) =>
    request<{ id: number }>('/conversations/direct', token, 'POST', { user_id: userId }),
  createGroup: (token: string, name: string, memberIds: number[]) =>
    request<{ id: number }>('/conversations/group', token, 'POST', {
      name,
      member_ids: memberIds,
    }),
  members: (token: string, conversationId: number) =>
    request<ConversationMember[]>(
      `/conversations/${conversationId}/members`,
      token,
    ),
  addMember: (token: string, conversationId: number, userId: number) =>
    request(
      `/conversations/${conversationId}/members`,
      token,
      'POST',
      { user_id: userId },
    ),
  removeMember: (token: string, conversationId: number, userId: number) =>
    request(
      `/conversations/${conversationId}/members/${userId}`,
      token,
      'DELETE',
    ),
  updateTimer: (token: string, conversationId: number, seconds: number) =>
    request(`/conversations/${conversationId}/timer`, token, 'PATCH', { seconds }),
};

export const messagingService = {
  list: (token: string, conversationId: number) =>
    request<Message[]>(`/conversations/${conversationId}/messages`, token),
  send: (
    token: string,
    conversationId: number,
    message: {
      body: string;
      reply_to_id?: number;
      file_url?: string;
      file_name?: string;
      kind?: string;
    },
  ) =>
    request<Message>(
      `/conversations/${conversationId}/messages`,
      token,
      'POST',
      message,
    ),
  markRead: (token: string, conversationId: number) =>
    request(`/conversations/${conversationId}/read`, token, 'POST'),
  react: (token: string, messageId: number, emoji: string) =>
    request(`/messages/${messageId}/reactions`, token, 'POST', { emoji }),
  upload: (file: File, token: string) => uploadFile(file, token),
};

export const settingsService = {
  get: (token: string) => request<Preferences>('/settings', token),
  update: (token: string, changes: Partial<Preferences>) =>
    request<Preferences>('/settings', token, 'PATCH', changes),
};
