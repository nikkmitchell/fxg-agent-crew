import { useEffect, useState } from "react";
import { useHeadsetAvailable } from "./space/useHeadsetAvailable";
import { requestJson } from "./api-request";

/**
 * The front door, and it opens onto the room.
 *
 * Nikk: "i want to make it xr immersion focused, so when you get to home page
 * you can just select directly what room you want... on the homepage have a
 * room enter button".
 *
 * The app used to open on Projects — a list of boards, with the room as the
 * seventh item in a rail of ten. Everything else is still there and still
 * reachable; what changed is what the product says it is when you arrive.
 *
 * ONE BUTTON, ONE DESTINATION, AND THE CAPABILITY LINE UNDER IT TELLS THE
 * TRUTH. There is no separate headset button here, and that is deliberate
 * rather than an omission: an immersive session must be requested inside a user
 * gesture, the scene is a lazy megabyte, and by the time it has downloaded the
 * click that started it is long stale. A "enter headset" button here could only
 * fail, and this codebase has a standing rule against buttons that can only
 * fail — "nothing happened" is the least debuggable outcome there is. So the
 * button loads the room, and the headset button is waiting above the view when
 * it arrives.
 */
export function Home({ onEnter }: { onEnter: () => void }) {
  const headset = useHeadsetAvailable();
  const here = useWhoIsHere();

  return (
    <section className="home">
      <header className="home-head">
        <h1>The room</h1>
        <p className="home-where">saha.ing</p>
      </header>

      <p className="home-blurb">
        A space you walk around, with everyone currently connected standing in it. The three panels
        are the real Board, Mood boards and People pages — live, and usable from inside.
      </p>

      <Occupancy here={here} />

      <button type="button" className="primary-action home-enter" onClick={onEnter}>
        Enter the room
      </button>

      {/*
        WHAT HAPPENS NEXT, said before it happens. Three states and not two:
        `null` means the probe has not answered, and on a Quest that answer took
        about TWENTY SECONDS to arrive. Rendering "no headset" while the yes is
        still on its way is exactly how a headset user concludes there is no
        immersive mode here. See useHeadsetAvailable.
      */}
      <p className="home-capability muted-note">
        {headset === true ? (
          <>
            This browser has immersive VR. The room loads first, and{" "}
            <strong>Enter in your headset</strong> is above the view, in the middle.
          </>
        ) : headset === false ? (
          <>
            No headset on this device, so the room opens in the window. Walk with W A S D or the
            arrow keys, drag to look around — including up and down.
          </>
        ) : (
          <>Checking whether this device has a headset…</>
        )}
      </p>

      <p className="home-cost muted-note">
        Entering downloads about a megabyte of 3D code, once per visit, which is why it waits until
        you ask.
      </p>
    </section>
  );
}

/** Who is in there right now, so the door says whether anybody is home. */
function Occupancy({ here }: { here: Occupants }) {
  if (here.state === "asking") return <p className="home-here muted-note">Looking who is in…</p>;
  if (here.state === "unknown") {
    // NOT "empty". A failed request and an empty room look identical from here
    // and mean opposite things, and saying the wrong one turns a network blip
    // into "nobody is working today".
    return <p className="home-here muted-note">Could not check who is in the room just now.</p>;
  }
  if (here.names.length === 0) {
    return <p className="home-here muted-note">Nobody is in the room at the moment.</p>;
  }
  return (
    <p className="home-here">
      <strong>{here.names.length}</strong> {here.names.length === 1 ? "person" : "people"} in there
      now: {here.names.join(", ")}
    </p>
  );
}

type Occupants =
  | { state: "asking" }
  | { state: "unknown" }
  | { state: "known"; names: string[] };

/**
 * A single look, not a live feed.
 *
 * The front door does not need a socket: it needs to answer "is anyone in
 * there" once, before you decide to spend a megabyte finding out. Opening a
 * websocket from the home page would also put you IN the room's roster while
 * you stood outside it, which would be a lie about who is present.
 */
function useWhoIsHere(): Occupants {
  const [state, setState] = useState<Occupants>({ state: "asking" });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const body = await requestJson<{ people?: { actorId: string }[] }>("/bff/space/presence");
        if (cancelled) return;
        setState({ state: "known", names: (body.people ?? []).map((one) => one.actorId).sort() });
      } catch {
        if (!cancelled) setState({ state: "unknown" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
