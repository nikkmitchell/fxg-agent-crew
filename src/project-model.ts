import type { CrewTask, TaskStatus } from "./event-core";

/**
 * The project shape behind the tabs, per the spec in room message 624.
 *
 * Types and pure logic only — no persistence, no fetching. This is the seam:
 * the UI renders these, and MG-02 fills them from real events. Keeping it pure
 * means the assignment rules below are testable without a server, which is
 * where the rules actually need to be right.
 */

export type StepStatus = "not_started" | "in_progress" | "done";

/** One of the 5-10 headline steps for a project, not a task. */
export type ProjectStep = {
  id: string;
  title: string;
  status: StepStatus;
};

export type Project = {
  id: string;
  name: string;
  summary: string;
  goals: string[];
  steps: ProjectStep[];
};

export type TaskComment = {
  id: string;
  author: string;
  body: string;
  createdAt: string;
};

export type TaskLink = { label: string; href: string };

/**
 * A board task with everything the spec asked a card to carry.
 *
 * `owners` is a list, not a single assignee: the spec says "owner or owners".
 *
 * `acceptedBy` is the important one. Being assigned work is not the same as
 * having taken it on — a task assigned in a batch and never acknowledged looks
 * identical to one someone is actively doing, and that difference is the whole
 * reason to track it. Unowned tasks are claimable; owned-but-unaccepted tasks
 * are visibly waiting on a person.
 */
export type BoardTask = CrewTask & {
  projectId: string;
  owners: string[];
  acceptedBy: string[];
  comments: TaskComment[];
  links: TaskLink[];
  images: TaskLink[];
};

export type Acceptance = "unassigned" | "awaiting_acceptance" | "accepted";

/**
 * Three states, deliberately not two.
 *
 * "unassigned" invites a claim. "awaiting_acceptance" says a named person has
 * not yet agreed. "accepted" means someone has actually taken it. Collapsing
 * the middle state into either neighbour is what lets a batch-created task sit
 * for a day looking like active work.
 */
export function acceptanceOf(task: BoardTask): Acceptance {
  if (task.owners.length === 0) return "unassigned";
  return task.owners.some((owner) => task.acceptedBy.includes(owner))
    ? "accepted"
    : "awaiting_acceptance";
}

export function canClaim(task: BoardTask, username: string): boolean {
  return acceptanceOf(task) === "unassigned" && username.length > 0;
}

/** Only a named owner may accept, and only once. */
export function canAccept(task: BoardTask, username: string): boolean {
  return task.owners.includes(username) && !task.acceptedBy.includes(username);
}

export function claim(task: BoardTask, username: string): BoardTask {
  if (!canClaim(task, username)) return task;
  // Claiming is taking it on, so it accepts in the same motion — otherwise a
  // claim would land in "awaiting_acceptance" from the person who just claimed
  // it, which is a state with no meaning.
  return { ...task, owners: [username], acceptedBy: [username] };
}

export function accept(task: BoardTask, username: string): BoardTask {
  if (!canAccept(task, username)) return task;
  return { ...task, acceptedBy: [...task.acceptedBy, username] };
}

/** Tasks a person is on — for the "My work" tab. */
export function tasksFor(tasks: BoardTask[], username: string): BoardTask[] {
  return tasks.filter((task) => task.owners.includes(username));
}

/**
 * Headline progress across the project's steps, not its tasks.
 *
 * Deliberately separate from task counts: the spec asks for "where we are" in
 * 5-10 steps, which is a different question from how many cards are done. A
 * project can be 90% of the way through its cards and still on step two.
 */
export function stepProgress(steps: ProjectStep[]): { done: number; total: number; percent: number } {
  const done = steps.filter((step) => step.status === "done").length;
  return { done, total: steps.length, percent: steps.length === 0 ? 0 : Math.round((done / steps.length) * 100) };
}

export const BOARD_COLUMNS: Array<{ status: TaskStatus; label: string }> = [
  { status: "backlog", label: "Backlog" },
  { status: "assigned", label: "Assigned" },
  { status: "in_progress", label: "In progress" },
  { status: "blocked", label: "Blocked" },
  { status: "review", label: "Review" },
  { status: "done", label: "Done" },
];
