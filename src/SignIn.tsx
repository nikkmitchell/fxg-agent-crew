import { useState } from "react";
import { bff } from "./bff-client";
import { signInRefusal } from "./viewer";
import { signupProblem, type SignupChannel } from "../shared/signup";

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
 * SIGNING UP HAPPENS HERE TOO NOW (Nikk, 6130). It used to be deliberately
 * absent, because accounts are WebHarness's and this app could not make one.
 * It can: the form below goes straight through to WebHarness's own
 * registration (server/routes/signup.ts), and the account is still theirs.
 */
export default function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  if (mode === "signup") return <SignUp onSignedIn={onSignedIn} onBack={() => setMode("signin")} />;
  return <PasswordSignIn onSignedIn={onSignedIn} onSignUp={() => setMode("signup")} />;
}

function PasswordSignIn({ onSignedIn, onSignUp }: { onSignedIn: () => void; onSignUp: () => void }) {
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

        {/*
          THE ONLY WAY ANYBODY FINDS /join.
          This form is what a stranger sees — no account, no session, no idea
          what this is. The joining page renders above the gate precisely so it
          can be read from here, and a page nobody can reach is no better than
          one that was never written.
        */}
        <p className="signin-aside">
          New here?{" "}
          <button type="button" className="signin-link" onClick={onSignUp}>Create an account</button>
          {" · "}Setting up an agent? <a href="/join">How to join</a>.
        </p>
      </form>
    </main>
  );
}

/**
 * CREATE AN ACCOUNT: name, password, an email or phone to verify, the code
 * WebHarness sends there, and done. Signed in straight afterwards. Like the
 * sign-in, the password lives in component state for one submit and nowhere
 * else, and is cleared on the way out.
 */
function SignUp({ onSignedIn, onBack }: { onSignedIn: () => void; onBack: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [channel, setChannel] = useState<SignupChannel>("email");
  const [target, setTarget] = useState("");
  const [code, setCode] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const sendCode = async () => {
    setRefusal(null);
    setNote(null);
    if (!target.trim()) {
      setRefusal(channel === "email" ? "Fill in your email address first." : "Fill in your phone number first.");
      return;
    }
    try {
      await bff.signupCode(channel, target.trim());
      setNote(`A code is on its way to ${target.trim()}.`);
    } catch (error) {
      setRefusal(signInRefusal(error));
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending) return;
    const form = { username: username.trim(), password, channel, target: target.trim(), code: code.trim() };
    const problem = signupProblem(form);
    if (problem) {
      setRefusal(problem);
      return;
    }
    setSending(true);
    setRefusal(null);
    try {
      await bff.signup(form);
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
          <h1>Create an account</h1>
          <p className="eyebrow">saha / mission control</p>
        </header>
        <p className="signin-lede">
          This makes a <strong>WebHarness</strong> account, the same one the chat uses, and signs you in here.
        </p>

        <label htmlFor="signup-username">Name</label>
        <input id="signup-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required
          value={username} onChange={(event) => setUsername(event.target.value)} />

        <label htmlFor="signup-password">Password</label>
        <input id="signup-password" name="new-password" type="password" autoComplete="new-password" required
          value={password} onChange={(event) => setPassword(event.target.value)} />

        <fieldset className="signup-channel">
          <legend>Verify with</legend>
          {(["email", "phone"] as const).map((one) => (
            <label key={one}>
              <input type="radio" name="channel" value={one} checked={channel === one} onChange={() => setChannel(one)} />
              {one === "email" ? "Email" : "Phone"}
            </label>
          ))}
        </fieldset>

        <label htmlFor="signup-target">{channel === "email" ? "Email address" : "Phone number"}</label>
        <div className="signup-row">
          <input id="signup-target" name={channel === "email" ? "email" : "tel"} type={channel === "email" ? "email" : "tel"}
            autoComplete={channel === "email" ? "email" : "tel"} required value={target} onChange={(event) => setTarget(event.target.value)} />
          <button type="button" className="signup-send" onClick={() => void sendCode()}>Send code</button>
        </div>

        <label htmlFor="signup-code">Code</label>
        <input id="signup-code" name="one-time-code" autoComplete="one-time-code" inputMode="numeric" required
          value={code} onChange={(event) => setCode(event.target.value)} />

        {note ? <p className="signin-note" role="status">{note}</p> : null}
        {refusal ? <p className="signin-refusal" role="alert">{refusal}</p> : null}

        <button type="submit" disabled={sending}>{sending ? "Creating…" : "Create account"}</button>

        <p className="signin-aside">
          Already have one? <button type="button" className="signin-link" onClick={onBack}>Sign in</button>
        </p>
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
