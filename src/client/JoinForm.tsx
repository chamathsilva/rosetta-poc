// Nickname entry. POSTs /api/join; on success transitions to the chat view
// using the server-normalized nickname from the response body (the server
// trims - SPECS AC-1 - so echoing back the raw input would show a value
// that was never actually stored).
import { useState } from 'react';
import type { FormEvent } from 'react';

// Client-side hint only, matching design SS4 - the server is the sole
// authority on validity (SPECS AC-3), so a client-side pass never skips
// showing a server-returned error.
const NICKNAME_MAX_LENGTH = 24;

interface JoinResponse {
  readonly nickname: string;
}

interface JoinErrorResponse {
  readonly error?: string;
}

interface JoinFormProps {
  readonly onJoined: (nickname: string) => void;
}

export function JoinForm({ onJoined }: JoinFormProps) {
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname }),
    })
      .then(async (res) => {
        if (res.status === 200) {
          const body = (await res.json()) as JoinResponse;
          onJoined(body.nickname);
          return;
        }
        if (res.status === 409) {
          setError('That nickname is already taken. Try another.');
          return;
        }
        if (res.status === 400) {
          const body = (await res.json().catch(() => ({}))) as JoinErrorResponse;
          setError(body.error ?? 'That nickname is not valid.');
          return;
        }
        setError('Could not join. Please try again.');
      })
      .catch(() => {
        setError('Could not reach the server. Please try again.');
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="nickname">Nickname</label>
      <input
        id="nickname"
        type="text"
        value={nickname}
        maxLength={NICKNAME_MAX_LENGTH}
        onChange={(event) => setNickname(event.target.value)}
        disabled={submitting}
        autoFocus
      />
      <button type="submit" disabled={submitting || nickname.trim().length === 0}>
        Join
      </button>
      {error !== null && <p role="alert">{error}</p>}
    </form>
  );
}
