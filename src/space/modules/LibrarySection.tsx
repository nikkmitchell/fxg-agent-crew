import { useState } from "react";
import { ALL_BRANCHES, type SpaceModule } from "../../bff-client";
import { deploySize, describeInRoom, type Library } from "./use-library";
import type { ModuleRoomItem } from "../../../shared/room-items";

/**
 * THE LIBRARY IN THE WINDOW'S SIDEBAR (the headset has it as a Library tab;
 * settings-menu-model.ts). The same hook drives both: use-library.ts.
 */
const KIND_TITLE: Record<SpaceModule["kind"], string> = { item: "Items", environment: "Environments", space: "Spaces" };

export function LibrarySection({ library }: { library: Library }) {
  const listing = library.open?.listing ?? null;
  return (
    <section className="space-voice space-library" aria-label="Library">
      <h2>Library</h2>
      <p className="muted-note">
        Things made in the spaces' own git, brought into this room live: items you can move and use,
        environments around the room, and whole spaces at full size or as a model. A push updates
        them here for everyone.
      </p>
      {library.inRoom.length ? (
        <>
          <h3>In this room</h3>
          <ul className="space-library-list">
            {library.inRoom.map((item) => (
              <li key={item.id}>
                <span>{describeInRoom(item)}</span>
                {item.role === "space" ? (
                  <button type="button" onClick={() => library.setView(item, item.view === "full" ? "placed" : "full")}>
                    {item.view === "full" ? "Show as a model" : "Full size"}
                  </button>
                ) : null}
                <button type="button" onClick={() => library.remove(item)}>Take away</button>
                <Feedback item={item} library={library} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {library.open ? (
        <>
          <h3>
            <button type="button" className="text-button" onClick={() => library.openSpace(null)}>‹ All spaces</button> {library.open.name}
          </h3>
          {listing ? (
            <>
              {listing.branches.length > 1 ? (
                <label className="space-setting">
                  <span>Branch</span>
                  <select value={listing.branch} onChange={(event) => library.openSpace(listing.space, event.currentTarget.value)}>
                    <option value={ALL_BRANCHES}>All branches</option>
                    {listing.branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
                  </select>
                </label>
              ) : null}
              {listing.branch === ALL_BRANCHES ? (
                <p className="muted-note">Everything every live branch offers; a branch with nothing in it is left out.</p>
              ) : listing.deploy ? (
                <>
                  <p className="muted-note">{listing.deploy.commit.slice(0, 7)} by {listing.deploy.pushedBy}: {listing.deploy.message}{deploySize(listing.deploy.bytes) ? ` · ${deploySize(listing.deploy.bytes)!.text}` : ""}</p>
                  {deploySize(listing.deploy.bytes)?.heavy ? (
                    <p role="status">Heavy: everyone near one of these things downloads up to {deploySize(listing.deploy.bytes)!.text}. Fine to try; shrink it before it stays in a busy room.</p>
                  ) : null}
                </>
              ) : (
                <p className="muted-note">Nothing is live on this branch yet.</p>
              )}
              {listing.modules.length === 0 ? (
                <p className="muted-note">
                  This branch offers nothing to bring in yet. List items, environments and spaces in its
                  saha-pieces.json (see docs/SPACES.md).
                </p>
              ) : null}
              {(["item", "environment", "space"] as const).map((kind) => {
                const modules = listing.modules.filter((module) => module.kind === kind);
                if (!modules.length) return null;
                return (
                  <div key={kind}>
                    <h4>{KIND_TITLE[kind]}</h4>
                    <ul className="space-library-list">
                      {modules.map((module) => (
                        <li key={`${module.branch ?? listing.branch}/${module.id}`}>
                          <span>{module.name}{module.branch ? ` · ${module.branch}` : ""}</span>
                          {module.branch ? (
                            <button type="button" className="text-button" onClick={() => library.openSpace(listing.space, module.branch)}>Go to branch</button>
                          ) : null}
                          {kind === "space" ? (
                            <>
                              <Switch on={Boolean(library.present(module, "placed"))} disabled={library.busy} onTap={() => library.toggle(module, "placed")}>Model</Switch>
                              <Switch on={Boolean(library.present(module, "full"))} disabled={library.busy} onTap={() => library.toggle(module, "full")}>Full size</Switch>
                              <Publish module={module} library={library} />
                            </>
                          ) : kind === "environment" ? (
                            <>
                              <Switch on={Boolean(library.present(module, "full"))} disabled={library.busy} onTap={() => library.toggle(module, "full")}>Around the room</Switch>
                              <Publish module={module} library={library} />
                            </>
                          ) : (
                            <>
                              <button type="button" disabled={library.busy} onClick={() => library.bring(module)}>Bring in</button>
                              {library.present(module) ? (
                                <button type="button" onClick={() => library.remove(library.present(module)!)}>Take one away</button>
                              ) : null}
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              {listing.problems.length ? <p className="muted-note">saha-pieces.json: {listing.problems.join(" ")}</p> : null}
            </>
          ) : (
            <p className="muted-note">Looking…</p>
          )}
        </>
      ) : (
        <ul className="space-library-list">
          {library.spaces === null ? <li>Looking…</li> : null}
          {library.spaces?.length === 0 ? <li>No spaces yet. Make one on the Spaces page.</li> : null}
          {library.spaces?.map((shelf) => (
            <li key={shelf.name}>
              <span>{shelf.title}{shelf.mine ? "" : " · public"}</span>
              <button type="button" onClick={() => library.openSpace(shelf.name)}>Open</button>
            </li>
          ))}
        </ul>
      )}
      {library.notice ? <p role="status">{library.notice}</p> : null}
    </section>
  );
}

/** An on/off button: says which it is, and pressing it switches. */
function Switch({ on, disabled, onTap, children }: { on: boolean; disabled: boolean; onTap: () => void; children: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={onTap}>
      {children}: {on ? "on" : "off"}
    </button>
  );
}

/** Feedback on one thing in the room: written here, kept with its space for the agents building it (Nikk, 6938). */
function Feedback({ item, library }: { item: ModuleRoomItem; library: Library }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)}>Feedback</button>;
  return (
    <span className="space-library-feedback">
      <textarea aria-label={`Feedback on ${item.name}`} value={text} rows={2} maxLength={2000} onChange={(event) => setText(event.currentTarget.value)} />
      <button
        type="button"
        disabled={sending || !text.trim()}
        onClick={() => {
          setSending(true);
          void library.feedback(item, text).then((kept) => {
            setSending(false);
            if (kept) {
              setText("");
              setOpen(false);
            }
          });
        }}
      >
        Send
      </button>
      <button type="button" onClick={() => setOpen(false)}>Cancel</button>
    </span>
  );
}

/** Publish a space or an environment as a finished space: its own room, pinned to this version (Nikk, 6940). */
function Publish({ module, library }: { module: SpaceModule; library: Library }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(module.name);
  const [sending, setSending] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)}>Publish as finished space</button>;
  return (
    <span className="space-library-feedback">
      <input aria-label="Its title, which is its room's name" value={title} maxLength={48} onChange={(event) => setTitle(event.currentTarget.value)} />
      <button
        type="button"
        disabled={sending || title.trim().length < 2}
        onClick={() => {
          setSending(true);
          void library.publish(module, title).then((done) => {
            setSending(false);
            if (done) setOpen(false);
          });
        }}
      >
        Publish
      </button>
      <button type="button" onClick={() => setOpen(false)}>Cancel</button>
    </span>
  );
}
