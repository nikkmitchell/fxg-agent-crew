import { useState } from "react";
import { bff } from "./bff-client";
import { signInRefusal } from "./viewer";

/**
 * The sign-in page, shown instead of the app when nobody is signed in.
 *
 * WHY THIS DID NOT EXIST. saha.ing/chat used to serve the classic chat app,
 * which had its own sign-in. Mission Control moved to `/` on 2026-09-10 and
 * chat moved to its own domain, so `location /` now answers /chat with this
 * app's index.html and the router resolves the unknown path to the `chat` tab —
 * a different application at the same URL. The sign-in did not break; it left
 * with the app it belonged to. `/bff/login` and `bff.login()` were both still
 * here the whole time, tested and unused: the endpoint kept working and nothing
 * called it.
 *
 * THE PASSWORD GOES TO WEBHARNESS, NOT TO US. `/bff/login` forwards it to
 * WebHarness and keeps only the returned token in the server-side session; the
 * browser gets an httpOnly cookie and the reply carries nothing but the
 * username. This form deliberately holds the password in component state for
 * the length of one submit and never puts it anywhere else — no localStorage,
 * no URL, no retry buffer.
 *
 * It is deliberately not a registration form. Accounts are WebHarness's, and
 * offering to create one here would be a claim this app cannot honour.
 */
export default function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setRefusal(null);
    try {
      await bff.login({ username: username.trim(), password });
      // CLEARED ON THE WAY OUT, so a password is not sitting in a React tree
      // behind whatever renders next.
      setPassword("");
      onSignedIn();
    } catch (error) {
      setRefusal(signInRefusal(error));
      setSending(false);
    }
  };

  return (
    <main className="signin" id="workroom">
      <form className="signin-card" onSubmit={submit}>
        <header>
          <h1>Sign in</h1>
          <p className="eyebrow">saha / mission control</p>
        </header>

        <p className="signin-lede">
          saha.ing uses your <strong>WebHarness</strong> account — the same one the chat uses.
          There is no separate account here.
        </p>

        <label htmlFor="signin-username">Username</label>
        <input
          id="signin-username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />

        <label htmlFor="signin-password">Password</label>
        <input
          id="signin-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        {/*
          * ROLE=ALERT, so the refusal is announced rather than only drawn.
          * Somebody using a screen reader otherwise submits, hears nothing, and
          * has no way to know the form answered.
          */}
        {refusal ? (
          <p className="signin-refusal" role="alert">
            {refusal}
          </p>
        ) : null}

        <button type="submit" disabled={sending}>
          {sending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

/**
 * Shown when we could not establish who the viewer is.
 *
 * SEPARATE FROM THE SIGN-IN PAGE ON PURPOSE. Showing a password field here
 * would tell somebody they are signed out when the truth is that we could not
 * ask — and they would go and change their WebHarness password over our
 * outage. It offers the one useful action instead, which is to try again.
 */
export function CannotTell({ why, onRetry }: { why: string; onRetry: () => void }) {
  return (
    <main className="signin" id="workroom">
      <div className="signin-card">
        <header>
          <h1>Cannot reach saha.ing</h1>
          <p className="eyebrow">saha / mission control</p>
        </header>
        <p className="signin-lede">
          You may well still be signed in — we could not ask. Nothing is wrong with your account
          as far as we know.
        </p>
        <p className="signin-refusal" role="alert">
          {why}
        </p>
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      </div>
    </main>
  );
}
