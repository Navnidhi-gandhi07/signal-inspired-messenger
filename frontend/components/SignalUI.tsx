import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { MessageCircle } from 'lucide-react';
import { apiUrl } from '../lib/api';

export function Avatar({
  name,
  src,
  size = 44,
}: {
  name: string;
  src?: string;
  size?: number;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
  const imageSource =
    src && failedSource !== src ? (src.startsWith('/') ? apiUrl(src) : src) : null;

  return (
    <div
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.32 }}
      role="img"
      aria-label={name}
    >
      {imageSource ? (
        <img src={imageSource} alt="" onError={() => setFailedSource(src ?? null)} />
      ) : (
        initials
      )}
    </div>
  );
}

export function IconButton({
  children,
  title,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      title={title}
      aria-label={title}
      {...props}
    >
      {children}
    </button>
  );
}

export function SignalMark({ size = 74 }: { size?: number }) {
  return (
    <div className="signal-mark" style={{ width: size, height: size }}>
      <svg viewBox="0 0 72 72" role="img" aria-label="Signal-inspired logo">
        <path
          d="M36 7C20.2 7 7.5 18.1 7.5 32c0 7.1 3.2 13.5 8.4 18L11 64l15-7.1c3.1 1.2 6.5 1.8 10 1.8C51.8 58.7 64.5 47.6 64.5 33.7S51.8 7 36 7Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeDasharray="11 4"
        />
      </svg>
    </div>
  );
}

export function StoriesIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="7.5" y="3.5" width="12" height="17" rx="3" />
      <path d="M5.2 18.4A2.7 2.7 0 0 1 3.5 16V6.5a3 3 0 0 1 3-3h8.2" />
    </svg>
  );
}

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? 'brand-small' : ''}`}>
      <MessageCircle size={small ? 19 : 26} strokeWidth={2.1} />
      <span>Signal</span>
    </span>
  );
}

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  trailing,
}: {
  label: string;
  description?: string;
  checked?: boolean;
  onChange?: (value: boolean) => void;
  disabled?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <div className={`setting-row ${disabled ? 'setting-row-disabled' : ''}`}>
      <span className="setting-copy">
        <span>{label}</span>
        {description && <small>{description}</small>}
      </span>
      {trailing ??
        (onChange && (
          <button
            className={`toggle ${checked ? 'on' : ''}`}
            type="button"
            onClick={() => onChange(!checked)}
            aria-label={label}
            aria-pressed={checked}
            disabled={disabled}
          >
            <span />
          </button>
        ))}
    </div>
  );
}

export function SettingSection({
  title,
  children,
  description,
}: {
  title: string;
  children: ReactNode;
  description?: string;
}) {
  return (
    <section className="settings-section">
      <div className="settings-section-heading">
        <h4>{title}</h4>
        {description && <p>{description}</p>}
      </div>
      <div className="settings-card">{children}</div>
    </section>
  );
}

export function SettingSelect({
  label,
  description,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`setting-row ${disabled ? 'setting-row-disabled' : ''}`}>
      <span className="setting-copy">
        <span>{label}</span>
        {description && <small>{description}</small>}
      </span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
