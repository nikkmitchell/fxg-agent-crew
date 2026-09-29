/**
 * SIGNING UP ON SAHA.ING (Nikk, 6130: "we already have the login and the chat
 * on saha.ing, can we do the sign up and agent creation there too?").
 *
 * The account is still WebHarness's: saha.ing passes the form straight through
 * to WebHarness's own registration (POST /api/users) and then signs you in the
 * way /bff/login does. It keeps neither the password nor the code.
 *
 * These rules are WebHarness's, copied from its own registration form, so a
 * mistake is caught here in words rather than coming back as an upstream 400.
 * WebHarness stays the judge: anything that passes here can still be refused
 * there, and that refusal is shown as it came.
 */

export type SignupChannel = "email" | "phone";

export type SignupForm = {
  username: string;
  password: string;
  channel: SignupChannel;
  /** The email address or phone number the code was sent to. */
  target: string;
  code: string;
};

/** Letters and digits in any script, underscore, dot, hyphen; 2 to 32 of them. */
const USERNAME = /^[\p{L}\p{N}_.-]{2,32}$/u;

export function signupProblem(form: SignupForm): string | null {
  if (!USERNAME.test(form.username.trim())) return "A name is 2 to 32 letters or digits; _ . - are allowed, spaces are not.";
  if (form.password.length < 4) return "The password needs at least 4 characters.";
  const target = form.target.trim();
  if (form.channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) return "That does not look like an email address.";
  if (form.channel === "phone" && !/^\+?[0-9 ()-]{6,20}$/.test(target)) return "That does not look like a phone number.";
  if (!form.code.trim()) return "Enter the code that was sent to you.";
  return null;
}

/** WebHarness's registration body: the contact and its code go under their own names. */
export function registrationBody(form: SignupForm): Record<string, string> {
  const target = form.target.trim();
  const code = form.code.trim();
  return form.channel === "email"
    ? { username: form.username.trim(), password: form.password, email: target, emailCode: code }
    : { username: form.username.trim(), password: form.password, phone: target, phoneCode: code };
}

export function isSignupChannel(value: unknown): value is SignupChannel {
  return value === "email" || value === "phone";
}

/**
 * HOW OFTEN SAHA.ING WILL ASK FOR A CODE. Every "Send code" costs a real email
 * or text message, and a form open to strangers would otherwise let anybody
 * use saha.ing to spam somebody else's phone. One code per address per minute,
 * and a handful per visitor per hour, is plenty for a person signing up.
 */
export const CODE_LIMITS = { perTargetMs: 60_000, perClientPerHour: 5 } as const;

export class CodeLimiter {
  private readonly lastByTarget = new Map<string, number>();
  private readonly byClient = new Map<string, number[]>();

  /** Null when a code may be sent now (and counts it); otherwise why not. */
  take(client: string, target: string, now: number): string | null {
    const key = target.trim().toLowerCase();
    const last = this.lastByTarget.get(key);
    if (last !== undefined && now - last < CODE_LIMITS.perTargetMs) {
      return `A code was just sent there. Try again in ${Math.ceil((CODE_LIMITS.perTargetMs - (now - last)) / 1000)} s.`;
    }
    const recent = (this.byClient.get(client) ?? []).filter((at) => now - at < 3_600_000);
    if (recent.length >= CODE_LIMITS.perClientPerHour) return "Too many codes from here in the last hour. Try again later.";
    recent.push(now);
    this.byClient.set(client, recent);
    this.lastByTarget.set(key, now);
    // Bounded: forget addresses once their minute is long past.
    if (this.lastByTarget.size > 5000) {
      for (const [k, at] of this.lastByTarget) if (now - at > CODE_LIMITS.perTargetMs) this.lastByTarget.delete(k);
    }
    return null;
  }
}
