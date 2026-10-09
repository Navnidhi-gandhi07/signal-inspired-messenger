export type ThemePreference = 'light' | 'dark' | 'system';

export interface User {
  id: number;
  username: string;
  display_name: string;
  avatar: string;
  about: string;
  online: boolean;
}

export interface Message {
  id: number;
  conversation_id: number;
  sender_id: number;
  sender: User;
  body: string;
  kind: string;
  file_url: string;
  file_name: string;
  reply_to_id: number | null;
  created_at: string;
  expires_at: string | null;
  reactions: { user_id: number; emoji: string }[];
  receipts: { user_id: number; status: string }[];
}

export interface Chat {
  id: number;
  name: string;
  avatar: string;
  is_group: boolean;
  member_ids: number[];
  other: User;
  last_message: Message | null;
  unread: number;
  disappearing_seconds: number;
}

export interface Preferences {
  theme: ThemePreference;
  read_receipts: boolean;
  typing_indicators: boolean;
  notifications: boolean;
}

export type LocalSettingValue = boolean | number | string;
export type LocalSettings = Record<string, LocalSettingValue>;

export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  use_address_book_photos: false,
  keep_muted_chats_archived: false,
  spell_check: true,
  text_formatting: true,
  link_previews: true,
  emoticons_to_emoji: false,
  emoji_skin_tone: 'default',
  chat_folders: false,
  incoming_calls: true,
  calling_sounds: true,
  video_device: 'Default camera',
  microphone: 'Default microphone',
  speakers: 'Default speakers',
  always_relay_calls: false,
  notification_visibility: 'name-and-message',
  notifications_while_muted: false,
  reaction_notifications: true,
  unread_reminders: false,
  window_attention: true,
  push_sounds: true,
  in_chat_sounds: true,
  unread_badge_count: true,
  muted_chats_in_badge: false,
  photos_auto_download: true,
  videos_auto_download: false,
  audio_auto_download: true,
  documents_auto_download: false,
  sent_media_quality: 'standard',
  phone_number_privacy: 'contacts',
  blocked_contacts: false,
  default_disappearing_seconds: 0,
  screen_security: false,
  stories_preferences: true,
  advanced_privacy: false,
  chat_color: 'blue',
  zoom_level: 100,
};

export type SettingsPage =
  | 'Account'
  | 'Donate to Signal'
  | 'General'
  | 'Appearance'
  | 'Chats'
  | 'Calls'
  | 'Notifications'
  | 'Privacy'
  | 'Data usage'
  | 'Backups';
