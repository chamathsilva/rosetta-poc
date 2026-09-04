# Untrusted Content Rendering

## Description

Every chat message, nickname, and room name originates from a client and is rendered to other users' browsers (`POC-BRIEF.md`: "security-flow (guest sessions, auth, XSS in user content, rate limiting, moderation)"). Treat all such fields as attacker-controlled at every point they reach another user's DOM.

Use when: writing any client-side code that inserts a nickname, message body, or room name into the page; writing any server code that stores or re-broadcasts such a field.

## Rule

- Never insert user-originated strings via `innerHTML`, template literals injected into HTML, or unescaped string concatenation into markup.
- Escape/encode at the render boundary (client), not just at intake (server). Do not rely on server-side sanitization alone — a client bug or a future API consumer can bypass it.
- The server stores and relays messages verbatim; it does not attempt to "clean" HTML out of them. Sanitization for storage is not planned — escaping happens at the point of render.

## Template

```js
// Client: rendering a chat message — MUST use textContent, never innerHTML, for user content
function renderMessage({ nickname, body }) {
  const el = document.createElement('div');
  const nameEl = document.createElement('strong');
  nameEl.textContent = nickname; // escaped by the DOM API, not by hand
  const bodyEl = document.createElement('span');
  bodyEl.textContent = body;
  el.append(nameEl, bodyEl);
  return el;
}
```

```js
// If a templating helper is ever introduced instead of raw DOM calls,
// it MUST auto-escape by default (e.g. a tagged template that escapes interpolations).
// Do not adopt a templating approach whose default is unescaped interpolation.
```

## Extension points

- Applies identically to nickname, room name, and message body — anywhere user input crosses into another user's rendered page.
- Does not apply to trusted, developer-authored UI strings.
