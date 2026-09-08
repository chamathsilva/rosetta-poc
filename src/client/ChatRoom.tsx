// Chat view: message list + input + send. Message rendering follows the
// `Message` template in docs/PATTERNS/untrusted-content-rendering.md - JSX
// text children only, never `dangerouslySetInnerHTML`, never a user string
// in a URL attribute. Nicknames and bodies here are attacker-controlled
// (design + SPECS AC-14).
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { OutgoingMessage } from '../shared/protocol';
import { useChatSocket } from './useChatSocket';

// Client-side hint only; the server is the authority (design SS4) and a
// server `error` frame for an oversized body is handled below regardless of
// whether this limit was bypassed or is simply inconsistent with the
// server's.
const BODY_MAX_LENGTH = 2000;

interface MessageProps {
  readonly nickname: string;
  readonly body: string;
}

function Message({ nickname, body }: MessageProps) {
  return (
    <div>
      <strong>{nickname}</strong>
      <span>{body}</span>
    </div>
  );
}

function messageKey(message: OutgoingMessage): string {
  return message.id;
}

interface ChatRoomProps {
  readonly nickname: string;
}

export function ChatRoom({ nickname }: ChatRoomProps) {
  const { status, messages, errors, send } = useChatSocket();
  const [draft, setDraft] = useState('');

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      return;
    }
    send(trimmed);
    setDraft('');
  };

  return (
    <div>
      <p>
        Joined as <strong>{nickname}</strong>
      </p>

      {status === 'disconnected' && (
        <p role="alert">Disconnected. Reload the page to continue.</p>
      )}

      <ul>
        {messages.map((message) => (
          <li key={messageKey(message)}>
            <Message nickname={message.nickname} body={message.body} />
          </li>
        ))}
      </ul>

      {errors.map((code, index) => (
        // Server error frames carry no id (design "BATCH" - they cannot be
        // deduped or sorted like a message), so the array index is the only
        // stable-enough key for this render-only list.
        <p role="alert" key={`${index}-${code}`}>
          Error: {code}
        </p>
      ))}

      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={draft}
          maxLength={BODY_MAX_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          disabled={status !== 'open'}
        />
        <button type="submit" disabled={status !== 'open' || draft.trim().length === 0}>
          Send
        </button>
      </form>
    </div>
  );
}
