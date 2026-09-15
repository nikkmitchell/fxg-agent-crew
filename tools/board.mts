/**
 * The board, from a terminal: what is open, and how an agent moves it.
 *
 * WHY THIS IS IN THE REPO. Every agent has to put its work on the board — Nikk
 * asks for it in those words — and the only way to do that was to write the
 * sign-in dance and the endpoint shapes again from scratch. I had this as a
 * scratch file for a day and used it a hundred times; Vint and Lumenfold
 * joining made it obvious that a tool three agents need is not a scratch file.
 *
 * WALKING TO THE BOARD IS NOT A SEPARATE STEP. Every write here is an audit
 * row, and the room walks the agent who wrote it to the board, turns it to
 * face the panel, and holds the card's change until it arrives. So `status`
 * and `comment` are also how an agent is seen working.
 *
 *   export WEBHARNESS_HOME="$HOME/.webharness/agents/<you>"
 *   pnpm exec tsx tools/board.mts open                     # what is not done
 *   pnpm exec tsx tools/board.mts card <id>                # one card in full
 *   pnpm exec tsx tools/board.mts new "<title>"            # a card of your own
 *   pnpm exec tsx tools/board.mts move <id> in_progress    # backlog → assigned
 *                                                          # → in_progress →
 *                                                          # review → done
 *   pnpm exec tsx tools/board.mts claim <id>
 *   pnpm exec tsx tools/board.mts say <id> "what I found"   # a comment
 *   pnpm exec tsx tools/board.mts projects
 *   pnpm exec tsx tools/board.mts get /bff/space/presence   # any read, raw
 *
 * `--project <id>` chooses the board; it defaults to SAHA_PROJECT or saha-ing.
 */
import { execFileSync } from "node:child_process";

const SITE = process.env.SAHA_URL ?? "https://saha.ing";

if (!process.env.WEBHARNESS_HOME) {
  // The same refusal as room-say and screen-share-link: without it the login
  // falls back to whichever account owns the shared ~/.webharness, and this
  // tool WRITES — a card claimed or moved under somebody else's name.
  console.error("WEBHARNESS_HOME is not set. Set it to your own agent directory first.");
  process.exit(2);
}

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
};
const words = process.argv.slice(2).filter((word, index, all) => {
  if (word.startsWith("--")) return false;
  return !(index > 0 && all[index - 1]?.startsWith("--"));
});
const [command, ...rest] = words;
const project = flag("--project") ?? process.env.SAHA_PROJECT ?? "saha-ing";

const token = execFileSync("python3", ["-c", `
import os, sys
sys.path.insert(0, os.path.expanduser("~/.webharness"))
import inbox
_, t = inbox.login()
print(t)
`], {
  env: { ...process.env, WEBHARNESS_URL: process.env.WEBHARNESS_URL ?? "https://webharness.chat" },
  encoding: "utf8",
}).trim();

const auth = await fetch(`${SITE}/bff/agent-session`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ token }),
});
if (!auth.ok) {
  console.error(`sign-in refused: ${auth.status} ${await auth.text()}`);
  process.exit(1);
}
const cookie = (auth.headers.getSetCookie?.() ?? []).map((part) => part.split(";")[0]).join("; ");

type Answer = { status: number; body: unknown };
const call = async (method: string, path: string, body?: unknown): Promise<Answer> => {
  const response = await fetch(`${SITE}${path}`, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A non-JSON body is worth printing as it came.
  }
  return { status: response.status, body: parsed };
};

/** Print what happened, and exit non-zero when it did not. */
const report = ({ status, body }: Answer, said = "done"): never => {
  const ok = status >= 200 && status < 300;
  console.log(ok ? said : `${status} ${JSON.stringify(body)}`);
  process.exit(ok ? 0 : 1);
};

type Task = {
  id: string;
  title: string;
  status: string;
  owners?: string[];
  description?: string;
  priority?: number;
  comments?: { author_id: string; body: string }[];
};

const tasksOf = async (): Promise<Task[]> => {
  const { status, body } = await call("GET", `/bff/board/projects/${project}`);
  const tasks = (body as { tasks?: Task[] } | undefined)?.tasks;
  if (!tasks) {
    console.error(`could not read ${project}: ${status} ${JSON.stringify(body)}`);
    process.exit(1);
  }
  return tasks;
};

switch (command) {
  case "open": {
    for (const task of (await tasksOf()).filter((task) => task.status !== "done")) {
      console.log(`${task.status.padEnd(11)} ${task.id} [${(task.owners ?? []).join(", ")}] ${task.title}`);
    }
    break;
  }
  case "card": {
    const task = (await tasksOf()).find((one) => one.id === rest[0]);
    if (!task) {
      console.error(`no card ${rest[0]} on ${project}`);
      process.exit(1);
    }
    console.log(`${task.status}  ${task.id}  [${(task.owners ?? []).join(", ")}]`);
    console.log(task.title);
    if (task.description) console.log(`\n${task.description}`);
    for (const comment of task.comments ?? []) console.log(`\n— ${comment.author_id}: ${comment.body}`);
    break;
  }
  case "new":
    report(
      await call("POST", "/bff/board/tasks", { projectId: project, title: rest.join(" "), owners: [] }),
      "card created",
    );
  // falls through — `report` exits
  case "move":
    report(await call("POST", `/bff/board/tasks/${rest[0]}/status`, { to: rest[1] }), `moved to ${rest[1]}`);
  case "claim":
    report(await call("POST", `/bff/board/tasks/${rest[0]}/ownership`, { action: "claim" }), "claimed");
  case "say":
    report(await call("POST", `/bff/board/tasks/${rest[0]}/comments`, { body: rest.slice(1).join(" ") }), "said");
  case "projects": {
    const { body } = await call("GET", "/bff/board/projects");
    for (const one of (body as { projects?: { id: string; name: string }[] }).projects ?? []) {
      console.log(`${one.id.padEnd(24)} ${one.name}`);
    }
    break;
  }
  case "get": {
    const { status, body } = await call("GET", rest[0]);
    console.log(status, JSON.stringify(body, null, 1));
    break;
  }
  default:
    console.error(
      "usage: board.mts open | card <id> | new <title> | move <id> <status> | claim <id> |\n" +
        "       say <id> <comment> | projects | get <path>   [--project <id>]\n\n" +
        "Statuses run backlog → assigned → in_progress → review → done, one step at a time.",
    );
    process.exit(2);
}
