# Untrusted Content Rendering

## Description

Every chat message, nickname, and room name originates from a client and is rendered to other users' browsers (`POC-BRIEF.md`: "security-flow (guest sessions, auth, XSS in user content, rate limiting, moderation)"). Treat all such fields as attacker-controlled at every point they reach another user's DOM.

Use when: writing any client-side code that inserts a nickname, message body, or room name into the page; writing any server code that stores or re-broadcasts such a field.

## Rule

- Never insert user-originated strings via `dangerouslySetInnerHTML` (React), `innerHTML`, template literals injected into HTML, or unescaped string concatenation into markup.
- Never place a user-originated string in a URL attribute (`href`, `src`, `formAction`). React escapes text children but does **not** block `javascript:` URLs.
- Escape/encode at the render boundary (client), not just at intake (server). Do not rely on server-side sanitization alone — a client bug or a future API consumer can bypass it.
- The server stores and relays messages verbatim; it does not attempt to "clean" HTML out of them. Sanitization for storage is not planned — escaping happens at the point of render.
- **`server/http` MUST send a Content-Security-Policy header.** React's escaping is currently the only defence; a CSP is the second layer, and it is the one that still holds if a `dangerouslySetInnerHTML` or a `javascript:` URL slips through review. Not yet implemented — `server/http` does not exist. Treat it as part of building it, not as a later hardening pass.

## Template

```tsx
// Client: rendering a chat message. React escapes text children by default,
// so the safe form is also the plain form.
export interface IncomingMessage {
  readonly nickname: string;
  readonly body: string;
}

export function Message({ nickname, body }: IncomingMessage) {
  return (
    <div>
      <strong>{nickname}</strong>
      <span>{body}</span>
    </div>
  );
}
```

**With React the danger moved.** It is no longer `innerHTML`. Three rules, in order of how likely they are to be got wrong:

1. **Never `dangerouslySetInnerHTML` with user-originated content.** Not for "just markdown", not for "just emoji", not for link previews. If rich text is ever wanted, sanitise on a strict allow-list first and treat that as its own reviewed decision — not a patch inside a component.
2. **Never interpolate user content into a URL attribute** — `href`, `src`, `formAction`. React does not block `javascript:` URLs in `href`. A nickname or a message body reaching an `href` is an XSS vector even though the surrounding JSX is escaped.
3. **Typing the value proves nothing about trusting it.** `nickname` and `body` arrive over the WebSocket from another user. The type describes shape, never provenance.

Server-side, the same rule holds for anything rendered outside React: use `textContent`, never `innerHTML`.

**Defence in depth: Content-Security-Policy.** Escaping is a control that a single bad line defeats. A CSP is a control that survives one. For this app the relevant directives are a `script-src` that excludes `'unsafe-inline'`, and a `default-src` that does not fall back to `*`. Vite emits hashed asset files, so a strict `script-src 'self'` is compatible with the build — it is not a policy that has to be loosened to make the app work.

## Extension points

- Applies identically to nickname, room name, and message body — anywhere user input crosses into another user's rendered page.
- Does not apply to trusted, developer-authored UI strings.
