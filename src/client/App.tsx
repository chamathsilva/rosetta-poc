// Client bootstrap. The session cookie is httpOnly (design, "Client
// bootstrap"), so on load the app has no way to know whether it is already
// joined. It must ask the server via GET /api/session before deciding
// whether to show the join form or the chat view - this is what makes join
// idempotent from the client's side (SPECS AC-15).
//
// Deliberately NOT inferred from a failed /ws handshake: browsers do not
// expose a failed upgrade's HTTP status to JavaScript, so a 401 (no
// session) cannot be told apart from a 403 (bad origin) or the server being
// down (design, "Client bootstrap").
import { useCallback, useEffect, useState } from 'react';
import { ChatRoom } from './ChatRoom';
import { JoinForm } from './JoinForm';

interface SessionResponse {
  readonly nickname: string;
}

type BootstrapState =
  | { readonly status: 'loading' }
  // GET /api/session answered 401: no valid session, show the join form.
  | { readonly status: 'anonymous' }
  // GET /api/session answered 200: session already exists, skip the join
  // form entirely per AC-15 / the design's bootstrap section.
  | { readonly status: 'joined'; readonly nickname: string }
  // Neither of the above: a network failure, or a non-200/401 response
  // (e.g. a 500, or the dev proxy target being down). This is NOT specified
  // by the design or SPECS - see the batch report's "ambiguity resolved"
  // note. Treating it as "anonymous" would silently show the join form to a
  // user who may already have a session, and a fresh join against a server
  // that is actually reachable but erroring would be confusing. Surface it
  // distinctly instead, with a manual retry - this is a one-shot bootstrap
  // check, not the out-of-scope WS auto-reconnect.
  | { readonly status: 'error' };

export function App() {
  const [state, setState] = useState<BootstrapState>({ status: 'loading' });

  const checkSession = useCallback(() => {
    setState({ status: 'loading' });
    fetch('/api/session', { method: 'GET' })
      .then((res) => {
        if (res.status === 200) {
          return res.json().then((body: SessionResponse) => {
            setState({ status: 'joined', nickname: body.nickname });
          });
        }
        if (res.status === 401) {
          setState({ status: 'anonymous' });
          return;
        }
        setState({ status: 'error' });
      })
      .catch(() => {
        setState({ status: 'error' });
      });
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  if (state.status === 'loading') {
    return <p>Loading...</p>;
  }

  if (state.status === 'error') {
    return (
      <div>
        <p>Could not reach the server.</p>
        <button type="button" onClick={checkSession}>
          Retry
        </button>
      </div>
    );
  }

  if (state.status === 'anonymous') {
    return (
      <JoinForm
        onJoined={(nickname) => setState({ status: 'joined', nickname })}
      />
    );
  }

  return <ChatRoom nickname={state.nickname} />;
}
