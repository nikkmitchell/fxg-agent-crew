import type { CrewTask } from "./event-core";

export type ActivityEntry = {
  taskId: string;
  taskTitle: string;
  author: string;
  at: string;
  excerpt: string;
};

const MAX_EXCERPT = 140;

/**
 * Recent activity for a project, derived from what the board already knows.
 *
 * Deliberately DERIVED rather than fetched. Every comment carries an author and
 * a timestamp, so the change log is already present in the state the Overview
 * renders — adding an endpoint to re-tell us what we hold would be a second
 * source for the same fact, and second sources drift.
 *
 * The honest limitation, stated because the tab is called live updates: this
 * shows COMMENTS, not every change. A status transition carries no author or
 * time in the projected state, so it cannot appear here without inventing one
 * of them. A feed that guessed who moved a card would be worse than a feed that
 * only reports what it can attribute.
 */
export function recentActivity(tasks: CrewTask[], limit = 8): ActivityEntry[] {
  const entries: ActivityEntry[] = [];

  for (const task of tasks) {
    for (const comment of task.comments ?? []) {
      const body = comment.body.trim();
      entries.push({
        taskId: task.id,
        taskTitle: task.title,
        author: comment.author,
        at: comment.createdAt,
        excerpt: body.length > MAX_EXCERPT ? `${body.slice(0, MAX_EXCERPT).trimEnd()}…` : body,
      });
    }
  }

  // Newest first. Ties broken by task id so the order is stable between
  // renders rather than depending on object iteration.
  entries.sort((a, b) => (a.at === b.at ? a.taskId.localeCompare(b.taskId) : a.at < b.at ? 1 : -1));
  return entries.slice(0, limit);
}
