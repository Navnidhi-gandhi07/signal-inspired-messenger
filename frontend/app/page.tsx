'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCheck,
  Ellipsis,
  FileText,
  Filter,
  Menu,
  MessageCircle,
  Mic,
  MoreHorizontal,
  Paperclip,
  Phone,
  Plus,
  Search,
  Send,
  Settings,
  Smile,
  SquarePen,
  Timer,
  Users,
  Video,
  X,
} from 'lucide-react';
import { apiUrl, webSocketUrl } from '../lib/api';
import {
  authService,
  contactService,
  conversationService,
  messagingService,
  settingsService,
} from '../lib/services';
import { useApplicationTheme, usePersistentUiSettings } from '../lib/hooks';
import { SettingsView } from '../components/SettingsView';
import { Avatar, Brand, IconButton, SignalMark, StoriesIcon } from '../components/SignalUI';
import type {
  Chat,
  Message,
  Preferences,
  SettingsPage,
  User,
} from '../lib/types';

const DEFAULT_PREFERENCES: Preferences = {
  theme: 'light',
  read_receipts: true,
  typing_indicators: true,
  notifications: true,
};

const TIMER_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 30, label: '30 seconds' },
  { value: 300, label: '5 minutes' },
  { value: 3600, label: '1 hour' },
  { value: 86400, label: '1 day' },
  { value: 604800, label: '1 week' },
];

const EMOJI_OPTIONS = ['😀', '😂', '🥰', '👍', '❤️', '🎉', '😮', '🙏', '🔥', '😢', '👀', '✅'];

const parseTimestamp = (value: string) => {
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatTime = (value: string) => {
  const date = parseTimestamp(value);
  return date?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '—';
};

const dateLabel = (value: string) => {
  const date = parseTimestamp(value);
  if (!date) return 'Unknown date';
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
};

const formatEmoticons = (value: string) =>
  value
    .replace(/:-\)/g, '🙂')
    .replace(/:\)/g, '🙂')
    .replace(/:-\(/g, '🙁')
    .replace(/:\(/g, '🙁')
    .replace(/<3/g, '❤️');

type ModalKind = 'new' | 'group' | 'members' | null;
type AppSection = 'chats' | 'calls' | 'stories' | 'settings';
type AppMenu = 'File' | 'Edit' | 'View' | 'Window' | 'Help' | null;

interface ConversationEvent {
  type: string;
  conversation_id?: number;
  user_id?: number;
  active?: boolean;
  message?: Message;
}

export default function Home() {
  const [token, setToken] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [loginMode, setLoginMode] = useState(true);
  const [auth, setAuth] = useState({
    username: 'alexmorgan',
    password: 'demo1234',
    display_name: 'Alex Morgan',
  });
  const [authError, setAuthError] = useState('');
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [draft, setDraft] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [section, setSection] = useState<AppSection>('chats');
  const [settingsPage, setSettingsPage] = useState<SettingsPage>('Appearance');
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [localSettings, updateLocalSetting] = usePersistentUiSettings();
  const [modal, setModal] = useState<ModalKind>(null);
  const [people, setPeople] = useState<User[]>([]);
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState<number[]>([]);
  const [members, setMembers] = useState<(User & { is_admin: boolean })[]>([]);
  const [reply, setReply] = useState<Message | null>(null);
  const [typingUserIds, setTypingUserIds] = useState<number[]>([]);
  const [toast, setToast] = useState('');
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [applicationMenu, setApplicationMenu] = useState<AppMenu>(null);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [sidebarMenuOpen, setSidebarMenuOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [messageSearch, setMessageSearch] = useState('');

  const socket = useRef<WebSocket | null>(null);
  const socketAuthenticated = useRef(false);
  const pendingTyping = useRef<{ conversation_id: number; active: boolean } | null>(null);
  const localTypingConversation = useRef<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const selectedChatRef = useRef<number | null>(null);
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteTypingTimeouts = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const lastTypingSentAt = useRef(0);
  selectedChatRef.current = selectedChatId;

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => setToast(''), 3200);
  }, []);

  const sendTypingEvent = useCallback((conversationId: number, active: boolean) => {
    const update = { conversation_id: conversationId, active };
    const connection = socket.current;
    if (socketAuthenticated.current && connection?.readyState === WebSocket.OPEN) {
      connection.send(JSON.stringify({ type: 'typing', ...update }));
    } else {
      pendingTyping.current = update;
    }
  }, []);

  const stopTyping = useCallback((conversationId = localTypingConversation.current) => {
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = null;
    if (conversationId !== null && localTypingConversation.current === conversationId) {
      sendTypingEvent(conversationId, false);
      localTypingConversation.current = null;
    }
  }, [sendTypingEvent]);

  const loadChats = useCallback(
    async (currentToken = token) => {
      if (!currentToken) return;
      try {
        const result = await conversationService.list(currentToken);
        setChats(result);
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Could not load conversations');
      }
    },
    [notify, token],
  );

  const loadMessages = useCallback(
    async (conversationId: number, currentToken = token) => {
      try {
        const result = await messagingService.list(currentToken, conversationId);
        setMessages(result);
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Could not load messages');
      }
    },
    [notify, token],
  );

  useEffect(() => {
    const savedToken = localStorage.getItem('signal_token');
    if (savedToken) setToken(savedToken);
  }, []);

  useEffect(() => {
    if (!token) return;
    authService.getProfile(token)
      .then(setUser)
      .catch(() => {
        localStorage.removeItem('signal_token');
        setToken('');
        setUser(null);
        setLoginMode(true);
      });
    settingsService.get(token)
      .then(setPreferences)
      .catch((error: unknown) =>
        notify(error instanceof Error ? error.message : 'Could not load preferences'),
      );
    loadChats(token);
  }, [loadChats, notify, token]);

  useApplicationTheme(preferences.theme);

  useEffect(() => {
    const root = document.documentElement;
    const zoom = Number(localSettings.zoom_level ?? 100);
    root.style.setProperty('--ui-zoom', String(zoom / 100));
    root.dataset.chatColor = String(localSettings.chat_color ?? 'blue');
  }, [localSettings.chat_color, localSettings.zoom_level]);

  useEffect(
    () => () => {
      if (toastTimeout.current) clearTimeout(toastTimeout.current);
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      remoteTypingTimeouts.current.forEach((timeout) => clearTimeout(timeout));
    },
    [],
  );

  useEffect(() => {
    if (!token) return;
    let connection: WebSocket;
    try {
      connection = new WebSocket(webSocketUrl());
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not configure real-time connection');
      return;
    }
    socket.current = connection;
    socketAuthenticated.current = false;
    let intentionalClose = false;
    let failureReported = false;
    connection.onopen = () => {
      connection.send(JSON.stringify({ type: 'auth', token }));
    };
    connection.onmessage = (event) => {
      let update: ConversationEvent;
      try {
        update = JSON.parse(event.data) as ConversationEvent;
      } catch {
        notify('Received an unreadable real-time update');
        return;
      }
      if (update.type === 'ready') {
        socketAuthenticated.current = true;
        const pending = pendingTyping.current;
        pendingTyping.current = null;
        if (pending) connection.send(JSON.stringify({ type: 'typing', ...pending }));
        return;
      }
      if (update.type === 'message' && update.message) {
        setTypingUserIds((current) =>
          current.filter((id) => id !== update.message?.sender_id),
        );
        const senderTimeout = remoteTypingTimeouts.current.get(update.message.sender_id);
        if (senderTimeout) clearTimeout(senderTimeout);
        remoteTypingTimeouts.current.delete(update.message.sender_id);
        void loadChats();
        if (update.message.conversation_id === selectedChatRef.current) {
          setMessages((current) =>
            current.some((message) => message.id === update.message?.id)
              ? current
              : [...current, update.message!],
          );
          if (update.message.sender_id !== user?.id) {
            void messagingService
              .markRead(token, update.message.conversation_id)
              .catch((error: unknown) =>
              notify(error instanceof Error ? error.message : 'Could not mark chat as read'),
            );
          }
        }
      } else if (
        update.type === 'typing' &&
        update.conversation_id === selectedChatRef.current &&
        update.user_id !== user?.id &&
        preferences.typing_indicators
      ) {
        const userId = update.user_id;
        if (userId === undefined) return;
        const oldTimeout = remoteTypingTimeouts.current.get(userId);
        if (oldTimeout) clearTimeout(oldTimeout);
        if (update.active) {
          setTypingUserIds((current) =>
            current.includes(userId) ? current : [...current, userId],
          );
          remoteTypingTimeouts.current.set(userId, setTimeout(() => {
            setTypingUserIds((current) => current.filter((id) => id !== userId));
            remoteTypingTimeouts.current.delete(userId);
          }, 3000));
        } else {
          setTypingUserIds((current) => current.filter((id) => id !== userId));
          remoteTypingTimeouts.current.delete(userId);
        }
      } else if (update.type === 'reaction' || update.type === 'read') {
        if (selectedChatRef.current) void loadMessages(selectedChatRef.current);
      } else if (update.type === 'conversation_changed') {
        void loadChats();
      }
    };
    connection.onerror = () => {
      if (!failureReported) {
        notify('Real-time connection failed. Live updates may be unavailable.');
        failureReported = true;
      }
    };
    connection.onclose = () => {
      if (!intentionalClose && !failureReported) {
        notify('Real-time connection closed. Refresh the page or check the backend service.');
      }
      socketAuthenticated.current = false;
      pendingTyping.current = null;
      remoteTypingTimeouts.current.forEach((timeout) => clearTimeout(timeout));
      remoteTypingTimeouts.current.clear();
      setTypingUserIds([]);
    };
    return () => {
      intentionalClose = true;
      if (localTypingConversation.current !== null) {
        sendTypingEvent(localTypingConversation.current, false);
        localTypingConversation.current = null;
      }
      connection.close();
      if (socket.current === connection) socket.current = null;
    };
  }, [loadChats, loadMessages, notify, preferences.typing_indicators, sendTypingEvent, token, user?.id]);

  useEffect(() => {
    if (localTypingConversation.current !== null && localTypingConversation.current !== selectedChatId) {
      stopTyping(localTypingConversation.current);
    }
    remoteTypingTimeouts.current.forEach((timeout) => clearTimeout(timeout));
    remoteTypingTimeouts.current.clear();
    setTypingUserIds([]);
    if (!selectedChatId || !token) {
      setMessages([]);
      return;
    }
    void loadMessages(selectedChatId);
    void messagingService.markRead(token, selectedChatId)
      .then(() => loadChats())
      .catch((error: unknown) =>
        notify(error instanceof Error ? error.message : 'Could not mark chat as read'),
      );
  }, [loadChats, loadMessages, notify, selectedChatId, stopTyping, token]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, selectedChatId]);

  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModal(null);
        setEmojiOpen(false);
        setApplicationMenu(null);
        setChatMenuOpen(false);
        return;
      }
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      const target = event.target as HTMLElement;
      const isEditing =
        target.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (key === 'k' && section === 'chats' && !isEditing) {
        event.preventDefault();
        document.getElementById('chat-search')?.focus();
      }
      if (key === 'n' && !isEditing) {
        event.preventDefault();
        void openNewConversation();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  });

  const activeChat = chats.find((chat) => chat.id === selectedChatId) ?? null;
  const typingNames = activeChat
    ? typingUserIds
        .map((id) =>
          activeChat.is_group
            ? members.find((member) => member.id === id)?.display_name
            : activeChat.other.id === id
              ? activeChat.other.display_name
              : undefined,
        )
        .filter((name): name is string => Boolean(name))
    : [];
  const sortedChats = useMemo(
    () =>
      [...chats]
        .sort(
          (left, right) =>
            (right.last_message?.id ?? 0) - (left.last_message?.id ?? 0),
        )
        .filter((chat) => chat.name.toLowerCase().includes(search.toLowerCase()))
        .filter((chat) => !unreadOnly || chat.unread > 0),
    [chats, search, unreadOnly],
  );
  const visibleMessages = useMemo(
    () =>
      messages.filter((message) =>
        message.body.toLowerCase().includes(messageSearch.toLowerCase()),
      ),
    [messageSearch, messages],
  );
  const canAdmin = members.some(
    (member) => member.id === user?.id && member.is_admin,
  );

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError('');
    try {
      const result = loginMode
        ? await authService.signIn(auth.username, auth.password)
        : await authService.register(auth);
      localStorage.setItem('signal_token', result.token);
      setUser(result.user);
      setToken(result.token);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Sign-in failed');
    }
  }

  async function openNewConversation() {
    setModal('new');
    try {
      setPeople(await contactService.search(token));
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not load contacts');
    }
  }

  async function openNewGroup() {
    setModal('group');
    try {
      setPeople(await contactService.search(token));
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not load contacts');
    }
  }

  async function applyDefaultTimer(conversationId: number) {
    const seconds = Number(localSettings.default_disappearing_seconds ?? 0);
    if (!seconds) return;
    try {
      await conversationService.updateTimer(token, conversationId, seconds);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not apply message timer');
    }
  }

  async function openDirectConversation(personId: number) {
    try {
      const existing = chats.some(
        (chat) =>
          !chat.is_group &&
          chat.member_ids.includes(personId) &&
          chat.member_ids.includes(user?.id ?? -1),
      );
      const conversation = await conversationService.openDirect(token, personId);
      if (!existing) await applyDefaultTimer(conversation.id);
      setModal(null);
      setSection('chats');
      setSelectedChatId(conversation.id);
      setMobileChatOpen(true);
      await loadChats();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not open conversation');
    }
  }

  async function createGroup() {
    if (!groupName.trim()) {
      notify('Enter a name for the group');
      return;
    }
    try {
      const conversation = await conversationService.createGroup(
        token,
        groupName.trim(),
        groupMembers,
      );
      await applyDefaultTimer(conversation.id);
      setModal(null);
      setGroupName('');
      setGroupMembers([]);
      setSection('chats');
      setSelectedChatId(conversation.id);
      setMobileChatOpen(true);
      await loadChats();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not create group');
    }
  }

  async function sendMessage() {
    if (!selectedChatId) return;
    const body = localSettings.emoticons_to_emoji
      ? formatEmoticons(draft.trim())
      : draft.trim();
    if (!body && !pendingFile) return;
    stopTyping(selectedChatId);
    try {
      let file: { url: string; name: string; kind: string } | undefined;
      if (pendingFile) {
        file = await messagingService.upload(pendingFile, token);
      }
      await messagingService.send(token, selectedChatId, {
        body,
        ...(reply ? { reply_to_id: reply.id } : {}),
        ...(file ? { file_url: file.url, file_name: file.name, kind: file.kind } : {}),
      });
      setDraft('');
      setPendingFile(null);
      setReply(null);
      setEmojiOpen(false);
      await Promise.all([loadMessages(selectedChatId), loadChats()]);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not send message');
    }
  }

  async function handleFile(file?: File) {
    if (!file || !selectedChatId) return;
    if (file.size > 10 * 1024 * 1024) {
      notify('Attachments must be 10 MB or smaller');
      return;
    }
    setPendingFile(file);
  }

  async function reactToMessage(message: Message, emoji: string) {
    try {
      await messagingService.react(token, message.id, emoji);
      await loadMessages(message.conversation_id);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not add reaction');
    }
  }

  async function updatePreferences(changes: Partial<Preferences>) {
    try {
      const result = await settingsService.update(token, changes);
      setPreferences(result);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save preferences');
    }
  }

  async function updateProfile(profile: { display_name: string; about: string }) {
    try {
      const updated = await authService.updateProfile(token, profile);
      setUser(updated);
      notify('Profile updated');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update profile');
      throw error;
    }
  }

  async function updateAvatar(file: File) {
    try {
      const updated = await authService.updateAvatar(token, file);
      setUser(updated);
      notify('Profile photo updated');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update profile photo');
      throw error;
    }
  }

  async function loadMembers() {
    if (!selectedChatId) return;
    try {
      const [result, contacts] = await Promise.all([
        conversationService.members(token, selectedChatId),
        contactService.search(token),
      ]);
      setMembers(result);
      setPeople(contacts);
      setModal('members');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not load group members');
    }
  }

  async function setDisappearingTimer(seconds: number) {
    if (!selectedChatId) return;
    try {
      await conversationService.updateTimer(token, selectedChatId, seconds);
      setChats((current) =>
        current.map((chat) =>
          chat.id === selectedChatId
            ? { ...chat, disappearing_seconds: seconds }
            : chat,
        ),
      );
      setChatMenuOpen(false);
      notify(
        seconds
          ? `Disappearing messages set to ${
              TIMER_OPTIONS.find((option) => option.value === seconds)?.label
            }`
          : 'Disappearing messages turned off',
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update message timer');
    }
  }

  async function removeMember(personId: number) {
    if (!selectedChatId) return;
    try {
      await conversationService.removeMember(token, selectedChatId, personId);
      if (personId === user?.id) {
        setSelectedChatId(null);
        setMessages([]);
        setMembers([]);
        setMobileChatOpen(false);
        setModal(null);
        await loadChats();
        return;
      }
      await loadMembers();
      await loadChats();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not remove group member');
    }
  }

  async function addMembers(personIds: number[]) {
    if (!selectedChatId || !personIds.length) return;
    try {
      for (const personId of personIds) {
        await conversationService.addMember(token, selectedChatId, personId);
      }
      notify(`${personIds.length} ${personIds.length === 1 ? 'person' : 'people'} added`);
      await loadMembers();
      await loadChats();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not add group members');
      await loadMembers();
      await loadChats();
    }
  }

  async function logout() {
    stopTyping();
    let logoutError = '';
    if (token) {
      try {
        await authService.signOut(token);
      } catch (error) {
        logoutError = error instanceof Error ? error.message : 'Server sign-out failed';
      }
    }
    localStorage.removeItem('signal_token');
    setToken('');
    setUser(null);
    setLoginMode(true);
    setAuthError(
      logoutError
        ? `Signed out on this device, but could not revoke the server session: ${logoutError}`
        : '',
    );
    setSelectedChatId(null);
    setMessages([]);
    setSection('chats');
    setMobileChatOpen(false);
    setModal(null);
  }

  function selectSection(next: AppSection) {
    setSection(next);
    setApplicationMenu(null);
    setSidebarMenuOpen(false);
    if (next === 'chats') setMobileChatOpen(false);
  }

  function updateZoom(delta: number, reset = false) {
    const current = Number(localSettings.zoom_level ?? 100);
    updateLocalSetting(
      'zoom_level',
      reset ? 100 : Math.max(80, Math.min(125, current + delta)),
    );
  }

  function insertEmoji(emoji: string) {
    setDraft((current) => `${current}${emoji}`);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  const pendingUrl = useMemo(
    () => (pendingFile && pendingFile.type.startsWith('image/') ? URL.createObjectURL(pendingFile) : ''),
    [pendingFile],
  );
  useEffect(() => () => {
    if (pendingUrl) URL.revokeObjectURL(pendingUrl);
  }, [pendingUrl]);

  if (!user) {
    return (
      <main className="auth-screen">
        <form className="auth-card" onSubmit={authenticate}>
          <Brand />
          <h1>{loginMode ? 'Welcome back' : 'Create your account'}</h1>
          <p>Private conversations, simplified.</p>
          {!loginMode && (
            <label className="auth-label">
              Display name
              <input
                value={auth.display_name}
                onChange={(event) =>
                  setAuth({ ...auth, display_name: event.target.value })
                }
                required
              />
            </label>
          )}
          <label className="auth-label">
            Username
            <input
              value={auth.username}
              onChange={(event) => setAuth({ ...auth, username: event.target.value })}
              minLength={3}
              required
              autoComplete="username"
            />
          </label>
          <label className="auth-label">
            Password
            <input
              type="password"
              value={auth.password}
              onChange={(event) => setAuth({ ...auth, password: event.target.value })}
              minLength={6}
              required
              autoComplete={loginMode ? 'current-password' : 'new-password'}
            />
          </label>
          {authError && <p className="error-message">{authError}</p>}
          <button className="primary-button auth-submit" type="submit">
            {loginMode ? 'Sign in' : 'Register'}
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => setLoginMode((current) => !current)}
          >
            {loginMode ? 'Create a new account' : 'Already registered? Sign in'}
          </button>
          <small className="auth-hint">Demo: alexmorgan / demo1234</small>
        </form>
      </main>
    );
  }

  return (
    <div className="application-shell">
      <div className="desktop-menu-bar">
        <Brand small />
        <div className="desktop-menu-list" aria-label="Application menu">
          {(['File', 'Edit', 'View', 'Window', 'Help'] as const).map((name) => (
            <div className="desktop-menu-wrap" key={name}>
              <button
                className={`desktop-menu-trigger ${applicationMenu === name ? 'active' : ''}`}
                onClick={() =>
                  setApplicationMenu((current) => (current === name ? null : name))
                }
              >
                {name}
              </button>
              {applicationMenu === name && (
                <ApplicationMenu
                  name={name}
                  onClose={() => setApplicationMenu(null)}
                  onNewMessage={() => void openNewConversation()}
                  onNewGroup={() => void openNewGroup()}
                  onNavigate={selectSection}
                  onLogout={logout}
                  notify={notify}
                  onZoom={updateZoom}
                />
              )}
            </div>
          ))}
        </div>
        <div className="menu-bar-spacer" />
        <span className="menu-user">{user.display_name}</span>
      </div>

      <div
        className={`workspace ${railCollapsed ? 'rail-collapsed' : ''} ${
          mobileChatOpen && section === 'chats' ? 'mobile-chat-active' : ''
        }`}
      >
        <nav className="navigation-rail" aria-label="Main navigation">
          <div className="rail-primary">
            <IconButton
              title={railCollapsed ? 'Show navigation tabs' : 'Hide navigation tabs'}
              onClick={() => setRailCollapsed((current) => !current)}
            >
              <Menu size={20} />
            </IconButton>
            <div className="rail-divider" />
            <IconButton
              title="Chats"
              className={section === 'chats' ? 'active' : ''}
              onClick={() => selectSection('chats')}
            >
              <MessageCircle size={20} />
            </IconButton>
            <IconButton
              title="Calls"
              className={section === 'calls' ? 'active' : ''}
              onClick={() => selectSection('calls')}
            >
              <Phone size={20} />
            </IconButton>
            <IconButton
              title="Stories"
              className={section === 'stories' ? 'active' : ''}
              onClick={() => selectSection('stories')}
            >
              <StoriesIcon size={20} />
            </IconButton>
          </div>
          <IconButton
            title="Settings"
            className={section === 'settings' ? 'active' : ''}
            onClick={() => selectSection('settings')}
          >
            <Settings size={20} />
          </IconButton>
        </nav>

        {section === 'settings' ? (
          <SettingsView
            user={user}
            page={settingsPage}
            preferences={preferences}
            localSettings={localSettings}
            onNavigate={setSettingsPage}
            onBack={() => selectSection('chats')}
            onPreferenceChange={updatePreferences}
            onLocalSettingChange={updateLocalSetting}
            onProfileSave={updateProfile}
            onAvatarUpload={updateAvatar}
            onLogout={logout}
          />
        ) : section === 'chats' ? (
          <>
            <aside
              className={`conversation-sidebar ${
                mobileChatOpen ? 'mobile-sidebar-hidden' : ''
              }`}
            >
              <header className="sidebar-heading">
                <h1>Chats</h1>
                <div className="sidebar-heading-actions">
                  <IconButton title="New message" onClick={() => void openNewConversation()}>
                    <SquarePen size={19} />
                  </IconButton>
                  <div className="sidebar-more-wrap">
                    <IconButton
                      title="More chat options"
                      className={sidebarMenuOpen ? 'active' : ''}
                      onClick={() => setSidebarMenuOpen((current) => !current)}
                    >
                      <MoreHorizontal size={21} />
                    </IconButton>
                    {sidebarMenuOpen && (
                      <div className="dropdown-menu sidebar-options">
                        <button onClick={() => { setSidebarMenuOpen(false); void openNewGroup(); }}>
                          <Users size={16} /> New group
                        </button>
                        <button onClick={() => { setSidebarMenuOpen(false); void openNewConversation(); }}>
                          <SquarePen size={16} /> New message
                        </button>
                        <button onClick={() => { setUnreadOnly((current) => !current); setSidebarMenuOpen(false); }}>
                          <Filter size={16} /> {unreadOnly ? 'Show all chats' : 'Show unread only'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </header>
              <div className="chat-search-row">
                <div className="chat-search">
                  <Search size={16} />
                  <input
                    id="chat-search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search"
                    aria-label="Search conversations"
                  />
                  {search && (
                    <button
                      type="button"
                      className="search-clear"
                      onClick={() => setSearch('')}
                      aria-label="Clear search"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <IconButton
                  title={unreadOnly ? 'Show all chats' : 'Filter unread chats'}
                  className={unreadOnly ? 'active' : ''}
                  onClick={() => setUnreadOnly((current) => !current)}
                >
                  <Filter size={17} />
                </IconButton>
              </div>
              <div className="conversation-list">
                {sortedChats.length ? (
                  sortedChats.map((chat) => (
                    <ConversationRow
                      key={chat.id}
                      chat={chat}
                      selected={chat.id === selectedChatId}
                      onSelect={() => {
                        setSelectedChatId(chat.id);
                        setMobileChatOpen(true);
                      }}
                    />
                  ))
                ) : (
                  <div className="sidebar-empty">
                    {unreadOnly ? 'No unread conversations' : 'No conversations found'}
                  </div>
                )}
              </div>
              <div className="sidebar-shortcut-hint">
                <span>⌘ / Ctrl + K</span> to search
              </div>
            </aside>

            <main
              className={`conversation-pane ${
                mobileChatOpen ? 'mobile-conversation-open' : ''
              }`}
            >
              {activeChat ? (
                <>
                  <header className="conversation-header">
                    <button
                      className="mobile-back"
                      onClick={() => setMobileChatOpen(false)}
                      aria-label="Back to conversations"
                    >
                      <ArrowLeft size={20} />
                    </button>
                    <Avatar name={activeChat.name} src={activeChat.avatar} size={40} />
                    <button
                      className="conversation-title"
                      onClick={() => activeChat.is_group && void loadMembers()}
                    >
                      <strong>{activeChat.name}</strong>
                      <small>
                        {activeChat.is_group
                          ? `${activeChat.member_ids.length} members`
                          : activeChat.other.online
                            ? 'Online'
                            : 'Signal contact'}
                      </small>
                    </button>
                    <div className="conversation-header-actions">
                      <IconButton
                        title="Video call (not available in this demo)"
                        onClick={() => notify('Video calls are not implemented in this demo')}
                      >
                        <Video size={19} />
                      </IconButton>
                      <IconButton
                        title="Voice call (not available in this demo)"
                        onClick={() => notify('Voice calls are not implemented in this demo')}
                      >
                        <Phone size={18} />
                      </IconButton>
                      <IconButton
                        title="Search messages"
                        className={messageSearchOpen ? 'active' : ''}
                        onClick={() => {
                          setMessageSearchOpen((current) => !current);
                          setMessageSearch('');
                        }}
                      >
                        <Search size={18} />
                      </IconButton>
                      <div className="chat-menu-wrap">
                        <IconButton
                          title="Conversation options"
                          className={chatMenuOpen ? 'active' : ''}
                          onClick={() => setChatMenuOpen((current) => !current)}
                        >
                          <Ellipsis size={20} />
                        </IconButton>
                        {chatMenuOpen && (
                          <div className="dropdown-menu conversation-menu">
                            {activeChat.is_group && (
                              <button onClick={() => void loadMembers()}>
                                <Users size={16} /> Group members
                              </button>
                            )}
                            <div className="menu-divider" />
                            <div className="menu-label">Disappearing messages</div>
                            {TIMER_OPTIONS.map((option) => (
                              <button
                                key={option.value}
                                className={
                                  activeChat.disappearing_seconds === option.value
                                    ? 'menu-selected'
                                    : ''
                                }
                                onClick={() => void setDisappearingTimer(option.value)}
                              >
                                {activeChat.disappearing_seconds === option.value ? (
                                  <Check size={15} />
                                ) : (
                                  <span className="menu-icon-spacer" />
                                )}
                                {option.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </header>

                  {messageSearchOpen && (
                    <div className="message-search-bar">
                      <Search size={16} />
                      <input
                        value={messageSearch}
                        onChange={(event) => setMessageSearch(event.target.value)}
                        placeholder="Search this conversation"
                      />
                      <span>{visibleMessages.length} results</span>
                      <IconButton
                        title="Close message search"
                        onClick={() => {
                          setMessageSearchOpen(false);
                          setMessageSearch('');
                        }}
                      >
                        <X size={17} />
                      </IconButton>
                    </div>
                  )}

                  <div className="message-history">
                    <div className="contact-intro">
                      <Avatar name={activeChat.name} src={activeChat.avatar} size={64} />
                      <h2>{activeChat.name}</h2>
                      <p>
                        {activeChat.is_group
                          ? 'Group conversation'
                          : `Your conversation with ${activeChat.name}`}
                      </p>
                      {!activeChat.is_group && (
                        <span className="contact-username">@{activeChat.other.username}</span>
                      )}
                    </div>
                    {visibleMessages.length ? (
                      visibleMessages.map((message, index) => {
                        const previous = visibleMessages[index - 1];
                        const showDate =
                          !previous ||
                          dateLabel(previous.created_at) !== dateLabel(message.created_at);
                        return (
                          <div key={message.id}>
                            {showDate && (
                              <div className="date-separator">
                                <span>{dateLabel(message.created_at)}</span>
                              </div>
                            )}
                            <MessageBubble
                              message={message}
                              mine={message.sender_id === user.id}
                              isGroup={activeChat.is_group}
                              token={token}
                              replyMessage={messages.find(
                                (candidate) => candidate.id === message.reply_to_id,
                              )}
                              onReply={() => setReply(message)}
                              onReact={(emoji) => void reactToMessage(message, emoji)}
                            />
                          </div>
                        );
                      })
                    ) : messages.length && messageSearch ? (
                      <div className="messages-empty">No messages match this search.</div>
                    ) : (
                      <div className="messages-empty">Start a conversation</div>
                    )}
                    {typingUserIds.length > 0 && (
                      <div className="typing-indicator">
                        {typingNames.length
                          ? `${typingNames.join(', ')} ${typingNames.length === 1 ? 'is' : 'are'} typing…`
                          : 'Someone is typing…'}
                      </div>
                    )}
                    <div ref={endRef} />
                  </div>

                  <div className="composer-area">
                    {reply && (
                      <div className="reply-preview">
                        <div className="reply-preview-mark" />
                        <div className="reply-preview-copy">
                          <strong>Replying to {reply.sender.display_name}</strong>
                          <span>{reply.body || reply.file_name || 'Attachment'}</span>
                        </div>
                        <IconButton title="Cancel reply" onClick={() => setReply(null)}>
                          <X size={17} />
                        </IconButton>
                      </div>
                    )}
                    {pendingFile && (
                      <div className="attachment-preview">
                        {pendingUrl ? (
                          <img src={pendingUrl} alt="Attachment preview" />
                        ) : (
                          <FileText size={22} />
                        )}
                        <span>{pendingFile.name}</span>
                        <small>{(pendingFile.size / (1024 * 1024)).toFixed(2)} MB</small>
                        <IconButton title="Remove attachment" onClick={() => setPendingFile(null)}>
                          <X size={16} />
                        </IconButton>
                      </div>
                    )}
                    <div className="composer">
                      <div className="composer-tools">
                        <div className="emoji-picker-wrap">
                          <IconButton
                            title="Emoji"
                            className={emojiOpen ? 'active' : ''}
                            onClick={() => setEmojiOpen((current) => !current)}
                          >
                            <Smile size={19} />
                          </IconButton>
                          {emojiOpen && (
                            <div className="emoji-picker">
                              {EMOJI_OPTIONS.map((emoji) => (
                                <button
                                  key={emoji}
                                  onClick={() => insertEmoji(emoji)}
                                  aria-label={`Insert ${emoji}`}
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <IconButton
                          title="Attach a file"
                          onClick={() => fileRef.current?.click()}
                        >
                          <Paperclip size={19} />
                        </IconButton>
                        <input
                          ref={fileRef}
                          className="visually-hidden"
                          type="file"
                          accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,application/zip"
                          onChange={(event) => {
                            void handleFile(event.target.files?.[0]);
                            event.target.value = '';
                          }}
                        />
                      </div>
                      <textarea
                        value={draft}
                        onBlur={() => stopTyping(selectedChatId)}
                        onChange={(event) => {
                          const value = event.target.value;
                          setDraft(value);
                          if (!selectedChatId || !preferences.typing_indicators || !value) {
                            stopTyping(selectedChatId);
                            return;
                          }
                          if (localTypingConversation.current !== selectedChatId) {
                            localTypingConversation.current = selectedChatId;
                            lastTypingSentAt.current = Date.now();
                            sendTypingEvent(selectedChatId, true);
                          } else if (Date.now() - lastTypingSentAt.current >= 1000) {
                            lastTypingSentAt.current = Date.now();
                            sendTypingEvent(selectedChatId, true);
                          }
                          if (typingTimeout.current) clearTimeout(typingTimeout.current);
                          typingTimeout.current = setTimeout(() => stopTyping(selectedChatId), 1400);
                        }}
                        onKeyDown={handleComposerKeyDown}
                        placeholder="Write a message"
                        aria-label="Write a message"
                        rows={1}
                        spellCheck={Boolean(localSettings.spell_check)}
                      />
                      <IconButton
                        title="Microphone (not available in this demo)"
                        onClick={() => notify('Voice messages are not implemented in this demo')}
                      >
                        <Mic size={19} />
                      </IconButton>
                      <button
                        className="send-button"
                        onClick={() => void sendMessage()}
                        disabled={!draft.trim() && !pendingFile}
                        aria-label="Send message"
                        title="Send message (Enter)"
                      >
                        <Send size={17} />
                      </button>
                    </div>
                    <div className="composer-hint">Enter to send · Shift + Enter for a new line</div>
                  </div>
                </>
              ) : (
                <WelcomePane onNewMessage={() => void openNewConversation()} />
              )}
            </main>
          </>
        ) : (
          <SecondaryPane section={section} onOpenChats={() => selectSection('chats')} />
        )}
      </div>

      {applicationMenu && (
        <button
          className="menu-dismiss"
          aria-label="Close menu"
          onClick={() => setApplicationMenu(null)}
        />
      )}

      {modal && (
        <ConversationModal
          kind={modal}
          people={people}
          currentUserId={user.id}
          groupName={groupName}
          groupMembers={groupMembers}
          members={members}
          canAdmin={canAdmin}
          onClose={() => setModal(null)}
          onOpenGroup={() => void openNewGroup()}
          onSelectPerson={(personId) => void openDirectConversation(personId)}
          onGroupNameChange={setGroupName}
          onToggleGroupMember={(personId) =>
            setGroupMembers((current) =>
              current.includes(personId)
                ? current.filter((id) => id !== personId)
                : [...current, personId],
            )
          }
          onCreateGroup={() => void createGroup()}
          onAddMembers={addMembers}
          onRemoveMember={(personId) => void removeMember(personId)}
        />
      )}
      {toast && <div className="toast-message" role="status">{toast}</div>}
    </div>
  );
}

function ConversationRow({
  chat,
  selected,
  onSelect,
}: {
  chat: Chat;
  selected: boolean;
  onSelect: () => void;
}) {
  const last = chat.last_message;
  const preview = last?.body || last?.file_name || 'Start a conversation';
  return (
    <button
      className={`conversation-row ${selected ? 'selected' : ''}`}
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
    >
      <Avatar name={chat.name} src={chat.avatar} size={44} />
      <span className="conversation-row-copy">
        <span className="conversation-row-top">
          <strong>{chat.name}</strong>
          <time>{last ? formatTime(last.created_at) : ''}</time>
        </span>
        <span className="conversation-row-bottom">
          {last?.sender_id === chat.other.id && (
            <span className="conversation-row-status" aria-label="Incoming message">
              <ArrowDown size={12} />
            </span>
          )}
          <span className="conversation-preview">{preview}</span>
          {chat.disappearing_seconds > 0 && (
            <Timer size={13} className="conversation-timer" aria-label="Disappearing messages enabled" />
          )}
          {last?.sender_id !== chat.other.id && last && (
            <span className="conversation-row-status" aria-label="Sent">
              {last.receipts.some((receipt) => receipt.status === 'read') ? (
                <CheckCheck size={14} />
              ) : last.receipts.some((receipt) => receipt.status === 'delivered') ? (
                <CheckCheck size={14} />
              ) : (
                <Check size={14} />
              )}
            </span>
          )}
          {chat.unread > 0 && <span className="unread-count">{chat.unread}</span>}
        </span>
      </span>
    </button>
  );
}

function MessageBubble({
  message,
  mine,
  isGroup,
  token,
  replyMessage,
  onReply,
  onReact,
}: {
  message: Message;
  mine: boolean;
  isGroup: boolean;
  token: string;
  replyMessage?: Message;
  onReply: () => void;
  onReact: (emoji: string) => void;
}) {
  return (
    <div className={`message-row ${mine ? 'mine' : 'theirs'}`}>
      <div className="message-actions">
        <button title="Reply to message" onClick={onReply}>
          <ArrowUpRight size={15} />
        </button>
        {['❤️', '👍', '😂'].map((emoji) => (
          <button key={emoji} title={`React ${emoji}`} onClick={() => onReact(emoji)}>
            {emoji}
          </button>
        ))}
      </div>
      <div className="message-bubble">
        {isGroup && !mine && <small className="message-sender">{message.sender.display_name}</small>}
        {replyMessage && (
          <div className="quoted-message">
            <strong>{replyMessage.sender.display_name}</strong>
            <span>{replyMessage.body || replyMessage.file_name || 'Attachment'}</span>
          </div>
        )}
        {(message.kind === 'image' || message.kind === 'file') && (
          <ProtectedAttachment message={message} token={token} />
        )}
        {message.body && <span className="message-body">{message.body}</span>}
        <span className="message-meta">
          <time>{formatTime(message.created_at)}</time>
          {message.expires_at && <Timer size={12} />}
          {mine && (
            message.receipts.some((receipt) => receipt.status === 'read') ? (
              <CheckCheck size={14} className="receipt-read" aria-label="Read" />
            ) : message.receipts.some((receipt) => receipt.status === 'delivered') ? (
              <CheckCheck size={14} aria-label="Delivered" />
            ) : (
              <Check size={14} aria-label="Sent" />
            )
          )}
        </span>
        {message.reactions.length > 0 && (
          <span className="message-reactions">
            {message.reactions.map((reaction) => reaction.emoji).join(' ')}
          </span>
        )}
      </div>
    </div>
  );
}

function ProtectedAttachment({ message, token }: { message: Message; token: string }) {
  const [objectUrl, setObjectUrl] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!message.file_url.startsWith('/uploads/')) {
      setFailed(true);
      return;
    }
    const controller = new AbortController();
    let currentObjectUrl = '';
    setFailed(false);
    setObjectUrl('');
    void fetch(apiUrl(message.file_url), {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Attachment request failed (${response.status})`);
        return response.blob();
      })
      .then((blob) => {
        currentObjectUrl = URL.createObjectURL(blob);
        setObjectUrl(currentObjectUrl);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setFailed(true);
      });
    return () => {
      controller.abort();
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    };
  }, [message.file_url, token]);

  if (failed) {
    return (
      <span className="message-attachment-file attachment-unavailable">
        <FileText size={18} />
        <span>Attachment unavailable</span>
      </span>
    );
  }
  if (!objectUrl) {
    return <span className="message-attachment-file">Loading attachment…</span>;
  }
  if (message.kind === 'image') {
    return (
      <a
        className="message-attachment-image"
        href={objectUrl}
        target="_blank"
        rel="noreferrer"
      >
        <img src={objectUrl} alt={message.file_name} />
      </a>
    );
  }
  return (
    <a className="message-attachment-file" href={objectUrl} download={message.file_name}>
      <FileText size={18} />
      <span>{message.file_name}</span>
    </a>
  );
}

function WelcomePane({ onNewMessage }: { onNewMessage: () => void }) {
  return (
    <div className="welcome-pane">
      <div className="welcome-content">
        <SignalMark />
        <h1>Welcome to Signal</h1>
        <a href="https://signal.org/blog/" target="_blank" rel="noreferrer">
          See what&apos;s new in this update
        </a>
      </div>
      <p className="welcome-footer">
        Signal is an independent nonprofit. <a href="https://signal.org/donate/" target="_blank" rel="noreferrer">Donate</a>
      </p>
      <button className="welcome-mobile-new" onClick={onNewMessage}>
        <SquarePen size={18} /> New message
      </button>
    </div>
  );
}

function SecondaryPane({
  section,
  onOpenChats,
}: {
  section: Exclude<AppSection, 'chats' | 'settings'>;
  onOpenChats: () => void;
}) {
  const isCalls = section === 'calls';
  return (
    <main className="secondary-pane">
      <header className="secondary-header">
        <h1>{isCalls ? 'Calls' : 'Stories'}</h1>
        {isCalls && (
          <IconButton title="New call (not available)" onClick={onOpenChats}>
            <Phone size={19} />
          </IconButton>
        )}
      </header>
      <div className="secondary-empty">
        <div className="secondary-empty-icon">
        {isCalls ? <Phone size={25} /> : <StoriesIcon size={25} />}
        </div>
        <h2>{isCalls ? 'Calls are coming soon' : 'Stories are coming soon'}</h2>
        <p>
          {isCalls
            ? 'Voice and video calling are not implemented in this demo.'
            : 'Stories are not implemented in this demo.'}
        </p>
        <button className="secondary-button" onClick={onOpenChats}>Back to chats</button>
      </div>
    </main>
  );
}

function ApplicationMenu({
  name,
  onClose,
  onNewMessage,
  onNewGroup,
  onNavigate,
  onLogout,
  notify,
  onZoom,
}: {
  name: Exclude<AppMenu, null>;
  onClose: () => void;
  onNewMessage: () => void;
  onNewGroup: () => void;
  onNavigate: (section: AppSection) => void;
  onLogout: () => void;
  notify: (message: string) => void;
  onZoom: (delta: number, reset?: boolean) => void;
}) {
  const runCommand = (action: string) => {
    switch (action) {
      case 'new-message':
        onNewMessage();
        break;
      case 'new-group':
        onNewGroup();
        break;
      case 'chats':
        onNavigate('chats');
        break;
      case 'calls':
        onNavigate('calls');
        break;
      case 'stories':
        onNavigate('stories');
        break;
      case 'settings':
        onNavigate('settings');
        break;
      case 'logout':
        onLogout();
        break;
      case 'zoom-in':
        onZoom(10);
        break;
      case 'zoom-out':
        onZoom(-10);
        break;
      case 'zoom-reset':
        onZoom(0, true);
        break;
      case 'fullscreen':
        if (document.fullscreenElement) {
          void document.exitFullscreen();
        } else {
          void document.documentElement.requestFullscreen();
        }
        break;
      case 'shortcuts':
        notify('Shortcuts: Ctrl/⌘+K search, Ctrl/⌘+N new conversation, Enter send, Shift+Enter newline.');
        break;
      case 'about':
        notify('Signal-inspired Messenger is an independent educational demo, not affiliated with Signal.');
        break;
      default:
        document.execCommand(action);
    }
    onClose();
  };

  const commands: Record<string, { label: string; action: string; shortcut?: string }[]> = {
    File: [
      { label: 'New message', action: 'new-message', shortcut: 'Ctrl/⌘+N' },
      { label: 'New group', action: 'new-group' },
      { label: 'Close menu', action: 'close' },
      { label: 'Log out', action: 'logout' },
    ],
    Edit: [
      { label: 'Undo', action: 'undo', shortcut: 'Ctrl/⌘+Z' },
      { label: 'Redo', action: 'redo', shortcut: 'Ctrl/⌘+Shift+Z' },
      { label: 'Cut', action: 'cut', shortcut: 'Ctrl/⌘+X' },
      { label: 'Copy', action: 'copy', shortcut: 'Ctrl/⌘+C' },
      { label: 'Paste', action: 'paste', shortcut: 'Ctrl/⌘+V' },
      { label: 'Select all', action: 'selectAll', shortcut: 'Ctrl/⌘+A' },
    ],
    View: [
      { label: 'Chats', action: 'chats' },
      { label: 'Calls', action: 'calls' },
      { label: 'Stories', action: 'stories' },
      { label: 'Zoom in', action: 'zoom-in', shortcut: 'Ctrl/⌘++' },
      { label: 'Zoom out', action: 'zoom-out', shortcut: 'Ctrl/⌘+-' },
      { label: 'Reset zoom', action: 'zoom-reset', shortcut: 'Ctrl/⌘+0' },
      { label: 'Toggle fullscreen', action: 'fullscreen' },
    ],
    Window: [
      { label: 'Chats', action: 'chats' },
      { label: 'Settings', action: 'settings' },
    ],
    Help: [
      { label: 'Keyboard shortcuts', action: 'shortcuts' },
      { label: 'About', action: 'about' },
      { label: 'Help center', action: 'help-center' },
    ],
  };

  return (
    <div className="dropdown-menu app-dropdown">
      {commands[name].map((command) => (
        <button
          key={command.label}
          onClick={() =>
            command.action === 'close'
              ? onClose()
              : command.action === 'help-center'
                ? (window.open('https://support.signal.org/', '_blank', 'noopener,noreferrer'), onClose())
                : runCommand(command.action)
          }
        >
          <span>{command.label}</span>
          {command.shortcut && <small>{command.shortcut}</small>}
        </button>
      ))}
    </div>
  );
}

function ConversationModal({
  kind,
  people,
  currentUserId,
  groupName,
  groupMembers,
  members,
  canAdmin,
  onClose,
  onOpenGroup,
  onSelectPerson,
  onGroupNameChange,
  onToggleGroupMember,
  onCreateGroup,
  onAddMembers,
  onRemoveMember,
}: {
  kind: ModalKind;
  people: User[];
  currentUserId: number;
  groupName: string;
  groupMembers: number[];
  members: (User & { is_admin: boolean })[];
  canAdmin: boolean;
  onClose: () => void;
  onOpenGroup: () => void;
  onSelectPerson: (id: number) => void;
  onGroupNameChange: (name: string) => void;
  onToggleGroupMember: (id: number) => void;
  onCreateGroup: () => void;
  onAddMembers: (ids: number[]) => Promise<void>;
  onRemoveMember: (id: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [selectedNewMembers, setSelectedNewMembers] = useState<number[]>([]);
  const [addingMembers, setAddingMembers] = useState(false);
  useEffect(() => {
    setSelectedNewMembers([]);
    setQuery('');
  }, [kind, members]);
  const existingMemberIds = members.map((member) => member.id);
  const filteredPeople = people.filter((person) =>
    `${person.display_name} ${person.username}`.toLowerCase().includes(query.toLowerCase()),
  );
  const filteredMembers = members.filter((member) =>
    `${member.display_name} ${member.username}`.toLowerCase().includes(query.toLowerCase()),
  );
  const selectablePeople = filteredPeople.filter((person) => !existingMemberIds.includes(person.id));
  const submitMemberAdds = async () => {
    if (!selectedNewMembers.length) return;
    setAddingMembers(true);
    try {
      await onAddMembers(selectedNewMembers);
      setSelectedNewMembers([]);
    } catch {
      // The parent surfaces the request error and reloads the group roster.
    } finally {
      setAddingMembers(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <header className="dialog-header">
          <div>
            <h2 id="dialog-title">
              {kind === 'new'
                ? 'New message'
                : kind === 'group'
                  ? 'New group'
                  : 'Conversation details'}
            </h2>
            {kind === 'members' && <p>Manage people in this group conversation.</p>}
          </div>
          <IconButton title="Close dialog" onClick={onClose}><X size={19} /></IconButton>
        </header>

        {kind === 'group' && (
          <label className="dialog-field">
            Group name
            <input
              value={groupName}
              onChange={(event) => onGroupNameChange(event.target.value)}
              placeholder="Name your group"
              maxLength={120}
            />
          </label>
        )}
        {(kind === 'new' || kind === 'group' || kind === 'members') && (
          <label className="dialog-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search people"
            />
          </label>
        )}

        <div className="dialog-list">
          {kind === 'members' ? (
            <>
              {filteredMembers.map((member) => (
                <div className="person-list-row" key={member.id}>
                  <Avatar name={member.display_name} src={member.avatar} size={38} />
                  <span className="person-list-copy">
                    <strong>{member.display_name}{member.id === currentUserId ? ' (you)' : ''}</strong>
                    <small>{member.is_admin ? 'Admin' : `@${member.username}`}</small>
                  </span>
                  {canAdmin && member.id !== currentUserId && (
                    <button className="text-button danger-text" onClick={() => onRemoveMember(member.id)}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
              {canAdmin && selectablePeople.length > 0 && (
                <>
                  <div className="dialog-subheading">Add people</div>
                  {selectablePeople.map((person) => {
                    const selected = selectedNewMembers.includes(person.id);
                    return (
                      <PersonRow
                        key={person.id}
                        user={person}
                        selected={selected}
                        onClick={() =>
                          setSelectedNewMembers((current) =>
                            selected
                              ? current.filter((id) => id !== person.id)
                              : [...current, person.id],
                          )
                        }
                        action={selected ? <Check size={17} /> : <Plus size={17} />}
                      />
                    );
                  })}
                </>
              )}
            </>
          ) : filteredPeople.map((person) => {
            const selected = groupMembers.includes(person.id);
            return (
              <PersonRow
                key={person.id}
                user={person}
                selected={selected}
                action={kind === 'group' ? selected ? <Check size={17} /> : <Plus size={17} /> : undefined}
                onClick={() =>
                  kind === 'group'
                    ? onToggleGroupMember(person.id)
                    : onSelectPerson(person.id)
                }
              />
            );
          })}
          {kind !== 'members' && (
            <button className="new-group-flow" onClick={onOpenGroup}>
              <span><Users size={18} /></span>
              <span><strong>Create a group</strong><small>Start a group conversation</small></span>
            </button>
          )}
        </div>

        {(kind === 'group' || (kind === 'members' && canAdmin)) && (
          <footer className="dialog-footer">
            {kind === 'group' ? (
              <>
                <span>{groupMembers.length} people selected</span>
                <button className="primary-button" onClick={onCreateGroup} disabled={!groupName.trim()}>
                  Create group
                </button>
              </>
            ) : (
              <>
                <span>{selectedNewMembers.length} selected</span>
                <button
                  className="primary-button"
                  onClick={() => void submitMemberAdds()}
                  disabled={!selectedNewMembers.length || addingMembers}
                >
                  {addingMembers ? 'Adding…' : 'Add selected'}
                </button>
              </>
            )}
          </footer>
        )}
      </section>
    </div>
  );
}

function PersonRow({
  user,
  action,
  selected = false,
  onClick,
}: {
  user: User;
  action?: React.ReactNode;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`person-list-row ${selected ? 'selected' : ''}`} onClick={onClick}>
      <Avatar name={user.display_name} src={user.avatar} size={38} />
      <span className="person-list-copy">
        <strong>{user.display_name}</strong>
        <small>@{user.username}</small>
      </span>
      {action && <span className="person-row-action">{action}</span>}
    </button>
  );
}
