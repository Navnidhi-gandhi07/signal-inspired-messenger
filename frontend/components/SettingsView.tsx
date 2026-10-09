import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  BookOpen,
  ChevronLeft,
  CircleDollarSign,
  Contact,
  Download,
  LockKeyhole,
  MessageCircle,
  Monitor,
  Phone,
  Settings as SettingsIcon,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { Avatar, IconButton, SettingSection, SettingSelect, ToggleRow } from './SignalUI';
import type {
  LocalSettings,
  LocalSettingValue,
  Preferences,
  SettingsPage,
  User,
} from '../lib/types';

const navigation: { page: SettingsPage; icon: typeof UserRound }[] = [
  { page: 'Account', icon: Contact },
  { page: 'Donate to Signal', icon: CircleDollarSign },
  { page: 'General', icon: SettingsIcon },
  { page: 'Appearance', icon: Monitor },
  { page: 'Chats', icon: MessageCircle },
  { page: 'Calls', icon: Phone },
  { page: 'Notifications', icon: Bell },
  { page: 'Privacy', icon: LockKeyhole },
  { page: 'Data usage', icon: Download },
  { page: 'Backups', icon: BookOpen },
];

interface SettingsViewProps {
  user: User;
  page: SettingsPage;
  preferences: Preferences;
  localSettings: LocalSettings;
  onNavigate: (page: SettingsPage) => void;
  onBack: () => void;
  onPreferenceChange: (changes: Partial<Preferences>) => Promise<void>;
  onLocalSettingChange: (key: string, value: LocalSettingValue) => void;
  onProfileSave: (profile: { display_name: string; about: string }) => Promise<void>;
  onAvatarUpload: (file: File) => Promise<void>;
  onLogout: () => void;
}

export function SettingsView({
  user,
  page,
  preferences,
  localSettings,
  onNavigate,
  onBack,
  onPreferenceChange,
  onLocalSettingChange,
  onProfileSave,
  onAvatarUpload,
  onLogout,
}: SettingsViewProps) {
  const [displayName, setDisplayName] = useState(user.display_name);
  const [about, setAbout] = useState(user.about);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const avatarInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplayName(user.display_name);
    setAbout(user.about);
  }, [user.about, user.display_name]);

  const localBoolean = (key: string) => Boolean(localSettings[key]);
  const localString = (key: string, fallback = '') =>
    String(localSettings[key] ?? fallback);
  const localToggle = (key: string) => (value: boolean) =>
    onLocalSettingChange(key, value);
  const updateProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingProfile(true);
    try {
      await onProfileSave({ display_name: displayName.trim(), about: about.trim() });
    } catch {
      return;
    } finally {
      setSavingProfile(false);
    }
  };
  const uploadAvatar = async (file?: File) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
      setAvatarError('Choose a PNG, JPEG, GIF, or WebP image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError('Profile photos must be 5 MB or smaller.');
      return;
    }
    setUploadingAvatar(true);
    setAvatarError('');
    try {
      await onAvatarUpload(file);
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : 'Could not upload profile photo');
    } finally {
      setUploadingAvatar(false);
    }
  };

  return (
    <div className="settings-layout">
      <aside className="settings-sidebar">
        <div className="settings-sidebar-title">
          <IconButton title="Back to chats" onClick={onBack}>
            <ChevronLeft size={18} />
          </IconButton>
          <h1>Settings</h1>
        </div>
        <button className="settings-profile" onClick={() => onNavigate('Account')}>
          <Avatar name={user.display_name} src={user.avatar} size={38} />
          <span>
            <strong>{user.display_name}</strong>
            <small>@{user.username}</small>
          </span>
        </button>
        <nav className="settings-nav" aria-label="Settings categories">
          {navigation.map(({ page: target, icon: Icon }) => (
            <button
              className={`settings-nav-item ${page === target ? 'selected' : ''} ${
                target === 'General' ? 'settings-nav-divider' : ''
              }`}
              key={target}
              onClick={() => onNavigate(target)}
              aria-current={page === target ? 'page' : undefined}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{target}</span>
            </button>
          ))}
        </nav>
        <button className="settings-nav-item settings-logout" onClick={onLogout}>
          <ShieldCheck size={18} strokeWidth={1.8} />
          <span>Log out</span>
        </button>
      </aside>

      <main className="settings-content">
        <div className="settings-content-inner">
          <h2>{page}</h2>
          {page === 'Account' && (
            <>
              <SettingSection
                title="Profile"
                description="Update the details people see when they chat with you."
              >
                <form className="profile-form" onSubmit={updateProfile}>
                  <div className="profile-photo-row">
                    <Avatar name={displayName || user.display_name} src={user.avatar} size={72} />
                    <div>
                      <strong>Profile photo</strong>
                      <small>PNG, JPEG, GIF, or WebP · up to 5 MB</small>
                    </div>
                    <input
                      ref={avatarInput}
                      className="visually-hidden"
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      aria-label="Choose a profile photo"
                      onChange={(event) => {
                        void uploadAvatar(event.target.files?.[0]);
                        event.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={uploadingAvatar}
                      onClick={() => avatarInput.current?.click()}
                    >
                      {uploadingAvatar ? 'Uploading…' : user.avatar ? 'Replace photo' : 'Add photo'}
                    </button>
                  </div>
                  {avatarError && <p className="error-message">{avatarError}</p>}
                  <label className="field-label">
                    <span>Display name</span>
                    <input
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      maxLength={120}
                      required
                    />
                  </label>
                  <label className="field-label">
                    <span>About</span>
                    <input
                      value={about}
                      onChange={(event) => setAbout(event.target.value)}
                      maxLength={250}
                      placeholder="A little about you"
                    />
                  </label>
                  <div className="profile-save-row">
                    <span className="subtle-note">Username: @{user.username}</span>
                    <button className="primary-button" disabled={savingProfile}>
                      {savingProfile ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </form>
              </SettingSection>
              <SettingSection title="Linked devices">
                <SettingRow
                  label="This device"
                  description="Browser session · linked-device management is not implemented."
                  trailing={<span className="status-label">Active now</span>}
                />
              </SettingSection>
              <SettingSection title="About this app">
                <SettingRow
                  label="Signal-inspired Messenger"
                  description="An independent demo; it is not an official Signal product."
                />
              </SettingSection>
            </>
          )}

          {page === 'Donate to Signal' && (
            <SettingSection
              title="Support private communication"
              description="Signal is an independent nonprofit. This educational clone is not affiliated with or endorsed by Signal."
            >
              <SettingRow
                label="Donate to Signal"
                description="This link opens Signal's official donation page in a new tab."
                trailing={
                  <a
                    className="secondary-button"
                    href="https://signal.org/donate/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Visit Signal.org
                  </a>
                }
              />
            </SettingSection>
          )}

          {page === 'General' && (
            <>
              <SettingSection title="Account">
                <SettingRow label="Phone number" description="This demo uses usernames and does not collect phone numbers." />
                <SettingRow label="Device name" description="Browser device name is unavailable to web apps." />
              </SettingSection>
              <SettingSection title="System preferences">
                <SettingRow label="Launch at system login" description="Not available in a browser." trailing={<span className="status-label">Unavailable</span>} />
                <SettingRow label="Language" description="The interface is currently in English." trailing={<span className="status-label">English</span>} />
              </SettingSection>
              <SettingSection title="Permissions">
                <SettingRow label="Notifications" description="Control whether this app can show notification toasts." trailing={<span className="status-label">Browser controlled</span>} />
                <SettingRow label="Microphone and camera" description="Calling is not implemented." trailing={<span className="status-label">Not in use</span>} />
              </SettingSection>
              <SettingSection title="Updates">
                <SettingRow label="Application updates" description="Updates are delivered by the site host." trailing={<span className="status-label">Up to date</span>} />
              </SettingSection>
              <SettingSection title="Delete application data">
                <SettingRow
                  label="Sign out and clear this browser session"
                  description="This removes the saved sign-in token; it does not delete server messages or your account."
                  trailing={<button className="secondary-button" onClick={onLogout}>Sign out</button>}
                />
              </SettingSection>
            </>
          )}

          {page === 'Appearance' && (
            <>
              <SettingSection title="Appearance">
                <SettingRow label="Language" description="Change the language used by the app." trailing={<span className="status-label">English</span>} />
                <SettingSelect
                  label="Theme"
                  description="Light is the default until you choose another theme."
                  value={preferences.theme}
                  options={[
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' },
                    { value: 'system', label: 'System' },
                  ]}
                  onChange={(value) =>
                    onPreferenceChange({ theme: value as Preferences['theme'] })
                  }
                />
                <SettingSelect
                  label="Chat color"
                  value={localString('chat_color', 'blue')}
                  options={[
                    { value: 'blue', label: 'Signal blue' },
                    { value: 'teal', label: 'Teal' },
                    { value: 'purple', label: 'Purple' },
                    { value: 'green', label: 'Green' },
                  ]}
                  onChange={(value) => onLocalSettingChange('chat_color', value)}
                />
                <SettingSelect
                  label="Zoom level"
                  value={localString('zoom_level', '100')}
                  options={[
                    { value: '80', label: '80%' },
                    { value: '90', label: '90%' },
                    { value: '100', label: '100%' },
                    { value: '110', label: '110%' },
                    { value: '125', label: '125%' },
                  ]}
                  onChange={(value) => onLocalSettingChange('zoom_level', Number(value))}
                />
              </SettingSection>
            </>
          )}

          {page === 'Chats' && (
            <>
              <SettingSection title="Chat list">
                <LocalToggle label="Use address book photos" description="Contact photos are not provided by the browser demo." value={localBoolean('use_address_book_photos')} onChange={localToggle('use_address_book_photos')} />
                <LocalToggle label="Keep muted chats archived" description="Muted chat management is not implemented." value={localBoolean('keep_muted_chats_archived')} onChange={localToggle('keep_muted_chats_archived')} />
                <LocalToggle label="Spell check" description="Controls spell checking in the message composer." value={localBoolean('spell_check')} onChange={localToggle('spell_check')} />
              </SettingSection>
              <SettingSection title="Message composition">
                <LocalToggle label="Text formatting" description="Formatting shortcuts are not implemented." value={localBoolean('text_formatting')} onChange={localToggle('text_formatting')} />
                <LocalToggle label="Generate link previews" description="Links are sent as text; previews are not generated." value={localBoolean('link_previews')} onChange={localToggle('link_previews')} />
                <LocalToggle label="Convert emoticons to emoji" value={localBoolean('emoticons_to_emoji')} onChange={localToggle('emoticons_to_emoji')} />
                <SettingSelect label="Emoji skin tone" value={localString('emoji_skin_tone', 'default')} options={['default', 'light', 'medium-light', 'medium', 'medium-dark', 'dark'].map((tone) => ({ value: tone, label: tone === 'default' ? 'Default' : tone.replace('-', ' ') }))} onChange={(value) => onLocalSettingChange('emoji_skin_tone', value)} />
              </SettingSection>
              <SettingSection title="Chat tools">
                <LocalToggle label="Chat folders" description="Chat folders are not implemented." value={localBoolean('chat_folders')} onChange={localToggle('chat_folders')} />
                <SettingRow label="Export chat history" description="Export is not implemented; chat history remains in the local demo database." trailing={<button className="secondary-button" disabled>Export</button>} />
                <SettingRow label="Import contacts" description="Contact import is not implemented." trailing={<button className="secondary-button" disabled>Import</button>} />
              </SettingSection>
            </>
          )}

          {page === 'Calls' && (
            <>
              <div className="notice-panel">Voice and video calling are not implemented in this browser demo. These controls are shown for layout reference only.</div>
              <SettingSection title="Calling">
                <LocalToggle label="Enable incoming calls" value={localBoolean('incoming_calls')} onChange={localToggle('incoming_calls')} disabled />
                <LocalToggle label="Play calling sounds" value={localBoolean('calling_sounds')} onChange={localToggle('calling_sounds')} disabled />
              </SettingSection>
              <SettingSection title="Devices">
                {(['video_device', 'microphone', 'speakers'] as const).map((key) => (
                  <SettingSelect
                    key={key}
                    label={{ video_device: 'Video device', microphone: 'Microphone', speakers: 'Speakers' }[key]}
                    value={localString(key)}
                    options={[{ value: String(localSettings[key]), label: String(localSettings[key]) }]}
                    onChange={(value) => onLocalSettingChange(key, value)}
                    disabled
                  />
                ))}
                <LocalToggle label="Always relay calls" value={localBoolean('always_relay_calls')} onChange={localToggle('always_relay_calls')} disabled />
              </SettingSection>
            </>
          )}

          {page === 'Notifications' && (
            <>
              <SettingSection title="Notifications">
                <PreferenceToggle label="Enable notifications" description="Saved as a preference. Browser and operating-system notifications are not implemented." value={preferences.notifications} onChange={(value) => onPreferenceChange({ notifications: value })} />
                <SettingSelect
                  label="Notification content"
                  value={localString('notification_visibility', 'name-and-message')}
                  options={[
                    { value: 'name-and-message', label: 'Name and message' },
                    { value: 'name-only', label: 'Name only' },
                    { value: 'no-name-or-message', label: 'No name or message' },
                  ]}
                  onChange={(value) => onLocalSettingChange('notification_visibility', value)}
                />
                <LocalToggle label="Notifications while muted" value={localBoolean('notifications_while_muted')} onChange={localToggle('notifications_while_muted')} />
                <LocalToggle label="Reaction notifications" value={localBoolean('reaction_notifications')} onChange={localToggle('reaction_notifications')} />
                <LocalToggle label="Unread reminders" value={localBoolean('unread_reminders')} onChange={localToggle('unread_reminders')} />
                <LocalToggle label="Window attention" value={localBoolean('window_attention')} onChange={localToggle('window_attention')} />
                <LocalToggle label="Push notification sounds" value={localBoolean('push_sounds')} onChange={localToggle('push_sounds')} />
                <LocalToggle label="In-chat sounds" value={localBoolean('in_chat_sounds')} onChange={localToggle('in_chat_sounds')} />
                <LocalToggle label="Unread badge count" value={localBoolean('unread_badge_count')} onChange={localToggle('unread_badge_count')} />
                <LocalToggle label="Include muted chats in app badge" value={localBoolean('muted_chats_in_badge')} onChange={localToggle('muted_chats_in_badge')} />
              </SettingSection>
              <SettingSection title="Notification profiles">
                <SettingRow label="Notification profiles" description="Profiles are not implemented; the selected preferences above are saved on this device." trailing={<span className="status-label">Default</span>} />
                <SettingRow label="Reset notification settings" trailing={<button className="secondary-button" onClick={() => onPreferenceChange({ notifications: true })}>Reset</button>} />
              </SettingSection>
            </>
          )}

          {page === 'Privacy' && (
            <>
              <SettingSection title="Phone number">
                <SettingSelect label="Phone-number privacy" description="This app uses usernames and does not store phone numbers." value={localString('phone_number_privacy', 'contacts')} options={[{ value: 'contacts', label: 'Contacts' }, { value: 'nobody', label: 'Nobody' }]} onChange={(value) => onLocalSettingChange('phone_number_privacy', value)} />
                <SettingRow label="Blocked contacts" description="Contact blocking is not implemented." trailing={<button className="secondary-button" disabled>Manage</button>} />
              </SettingSection>
              <SettingSection title="Messaging privacy">
                <PreferenceToggle label="Read receipts" description="When off, other members will not receive read receipts from you." value={preferences.read_receipts} onChange={(value) => onPreferenceChange({ read_receipts: value })} />
                <PreferenceToggle label="Typing indicators" description="When off, your typing activity is not sent to other members." value={preferences.typing_indicators} onChange={(value) => onPreferenceChange({ typing_indicators: value })} />
                <SettingSelect
                  label="Default disappearing-message timer"
                  description="Applied when you start a new direct or group conversation."
                  value={localString('default_disappearing_seconds', '0')}
                  options={[
                    { value: '0', label: 'Off' },
                    { value: '30', label: '30 seconds' },
                    { value: '300', label: '5 minutes' },
                    { value: '3600', label: '1 hour' },
                    { value: '86400', label: '1 day' },
                    { value: '604800', label: '1 week' },
                  ]}
                  onChange={(value) => onLocalSettingChange('default_disappearing_seconds', Number(value))}
                />
                <LocalToggle label="Screen security" description="Browser screenshots cannot be blocked." value={localBoolean('screen_security')} onChange={localToggle('screen_security')} />
                <LocalToggle label="Stories preferences" description="Stories are not implemented." value={localBoolean('stories_preferences')} onChange={localToggle('stories_preferences')} />
                <LocalToggle label="Advanced privacy" description="Advanced privacy controls are not implemented." value={localBoolean('advanced_privacy')} onChange={localToggle('advanced_privacy')} />
              </SettingSection>
            </>
          )}

          {page === 'Data usage' && (
            <>
              <SettingSection title="Auto-download media" description="These preferences are saved locally. This demo does not automatically download attachments.">
                <LocalToggle label="Photos" value={localBoolean('photos_auto_download')} onChange={localToggle('photos_auto_download')} />
                <LocalToggle label="Videos" value={localBoolean('videos_auto_download')} onChange={localToggle('videos_auto_download')} />
                <LocalToggle label="Audio" value={localBoolean('audio_auto_download')} onChange={localToggle('audio_auto_download')} />
                <LocalToggle label="Documents" value={localBoolean('documents_auto_download')} onChange={localToggle('documents_auto_download')} />
              </SettingSection>
              <SettingSection title="Media quality">
                <SettingSelect label="Sent media quality" value={localString('sent_media_quality', 'standard')} options={[{ value: 'standard', label: 'Standard' }, { value: 'high', label: 'High' }]} onChange={(value) => onLocalSettingChange('sent_media_quality', value)} />
              </SettingSection>
            </>
          )}

          {page === 'Backups' && (
            <>
              <div className="settings-lead">
                <ShieldCheck size={24} />
                <p>Message history backups are not implemented in this demo. Messages are stored in the local SQLite database; no Signal-compatible encrypted backup is created.</p>
              </div>
              <SettingSection title="Secure Backups">
                <SettingRow label="Signal Secure Backups" description="This independent demo cannot create, restore, or access Signal Secure Backups." trailing={<span className="status-label">Not available</span>} />
              </SettingSection>
              <SettingSection title="Desktop backups">
                <SettingRow label="Back up message history" description="Backup setup is a visual placeholder and does not export or encrypt data." trailing={<button className="primary-button" disabled>Set up</button>} />
              </SettingSection>
            </>
          )}

          <p className="settings-footnote">Signal-inspired Messenger · independent educational demo · not affiliated with Signal</p>
        </div>
      </main>
    </div>
  );
}

function SettingRow({
  label,
  description,
  trailing,
}: {
  label: string;
  description?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="setting-row">
      <span className="setting-copy">
        <span>{label}</span>
        {description && <small>{description}</small>}
      </span>
      {trailing}
    </div>
  );
}

function LocalToggle({
  label,
  description,
  value,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <ToggleRow
      label={label}
      description={description}
      checked={value}
      onChange={onChange}
      disabled={disabled}
    />
  );
}

function PreferenceToggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <ToggleRow
      label={label}
      description={description}
      checked={value}
      onChange={onChange}
    />
  );
}
