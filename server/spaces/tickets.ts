import { randomBytes } from "node:crypto";
import { KIT_LIMITS } from "../../shared/space-kit.js";

/**
 * TICKETS INTO A SPACE (shared/space-kit.ts has the why). saha.ing, which
 * knows who you are from your cookie, hands a space page a ticket naming you
 * and that one space. The page shows it to the live socket; that is the only
 * thing it can do with it. It cannot sign in to saha.ing, act in another space,
 * or outlive half an hour.
 *
 * Kept in memory: a restart only means entering the space again from saha.ing.
 */
export type TicketHolder = { username: string; body: string | null; space: string };

export class SpaceTickets {
  private readonly tickets = new Map<string, TicketHolder & { until: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  issue(holder: TicketHolder): string {
    this.sweep();
    const ticket = randomBytes(24).toString("base64url");
    this.tickets.set(ticket, { ...holder, until: this.now() + KIT_LIMITS.ticketMs });
    return ticket;
  }

  /** Who a ticket is, for this space only; null for anything else. */
  read(ticket: string | null | undefined, space: string): TicketHolder | null {
    if (!ticket) return null;
    const held = this.tickets.get(ticket);
    if (!held || held.until < this.now() || held.space !== space) return null;
    return { username: held.username, body: held.body, space: held.space };
  }

  private sweep(): void {
    if (this.tickets.size < 1000) return;
    for (const [ticket, held] of this.tickets) if (held.until < this.now()) this.tickets.delete(ticket);
  }
}
