import type { SpaceModule } from "../../bff-client";
import { describeInRoom, type Library } from "./use-library";

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
                    {listing.branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
                  </select>
                </label>
              ) : null}
              {listing.deploy ? (
                <p className="muted-note">{listing.deploy.commit.slice(0, 7)} by {listing.deploy.pushedBy}: {listing.deploy.message}</p>
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
                        <li key={module.id}>
                          <span>{module.name}</span>
                          {kind === "space" ? (
                            <>
                              <button type="button" disabled={library.busy} onClick={() => library.bring(module, "placed")}>As a model</button>
                              <button type="button" disabled={library.busy} onClick={() => library.bring(module, "full")}>Full size</button>
                            </>
                          ) : (
                            <button type="button" disabled={library.busy} onClick={() => library.bring(module)}>
                              {kind === "environment" ? "Surround the room" : "Bring in"}
                            </button>
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
