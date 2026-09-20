import { describe, expect, it } from "vitest";
import {
  bodiesFromCatalogue,
  bodyOfActor,
  holderOfVoice,
  slugOf,
  standingOf,
  voiceOfActor,
  voiceWasChosen,
} from "./profile-view";

/**
 * Every test here is a bug that shipped, written down so it cannot ship twice.
 * Nikk found the first one by looking at the live page.
 */

const taken = [
  { actorId: "Lumenfold", voice: "bf_isabella" },
  { actorId: "Moraine", voice: "bf_emma" },
  { actorId: "Nightjar", voice: "bm_george" },
  { actorId: "Sill", voice: "af_sarah" },
];

describe("whose voice a profile shows", () => {
  it("shows each actor THEIR OWN chosen voice", () => {
    expect(voiceOfActor("Moraine", taken)).toBe("bf_emma");
    expect(voiceOfActor("Nightjar", taken)).toBe("bm_george");
    expect(voiceOfActor("Sill", taken)).toBe("af_sarah");
  });

  it("NEVER shows the viewer's voice on somebody else's profile", () => {
    // The bug Nikk reported: `taken` is an array of pairs and I indexed it by
    // actorId as though it were a map. Every lookup was undefined, so every
    // profile fell back to the voice of whoever was looking — "in profile all
    // voices are the same". The distinctness below is the whole assertion.
    const shown = ["Lumenfold", "Moraine", "Nightjar", "Sill"].map((who) => voiceOfActor(who, taken));
    expect(new Set(shown).size).toBe(4);
  });

  it("falls back to the name-derived voice, not to nothing and not to a default", () => {
    // Somebody who has never chosen still speaks, and the room derives the same
    // one from their name. The page has to agree with the room or it is lying.
    const derived = voiceOfActor("Waffle", taken);
    expect(derived).toBeTruthy();
    expect(derived).toBe(voiceOfActor("Waffle", []));
    expect(derived).not.toBe(voiceOfActor("Vint", taken));
  });

  it("says whether a voice was chosen or merely derived", () => {
    expect(voiceWasChosen("Sill", taken)).toBe(true);
    expect(voiceWasChosen("Waffle", taken)).toBe(false);
  });

  it("survives a missing `taken` entirely", () => {
    expect(voiceOfActor("Sill", undefined)).toBeTruthy();
    expect(voiceWasChosen("Sill", undefined)).toBe(false);
  });
});

describe("who holds a voice", () => {
  it("names the holder, so a refusal can say who to ask", () => {
    // The picker compared an object to a string and never matched, so no voice
    // ever showed as held and you learned of a clash only from the 409.
    expect(holderOfVoice("bf_isabella", taken)).toBe("Lumenfold");
    expect(holderOfVoice("bm_george", taken)).toBe("Nightjar");
  });

  it("returns null for a free voice rather than a misleading name", () => {
    expect(holderOfVoice("am_michael", taken)).toBeNull();
  });
});

describe("which body an actor wears", () => {
  const chosen = [
    { actorId: "Sill", body: "shiro" },
    { actorId: "Moraine", body: "chillpenguin" },
  ];

  it("gives each actor their own", () => {
    expect(bodyOfActor("Sill", chosen)).toBe("shiro");
    expect(bodyOfActor("Moraine", chosen)).toBe("chillpenguin");
  });

  it("says null when nobody chose, because that is a real state", () => {
    // Drawn as the room's default, which is different from "has no body".
    expect(bodyOfActor("Lumenfold", chosen)).toBeNull();
  });
});

describe("matching a stored slug to a catalogue name", () => {
  it("ignores case and punctuation, so neither spelling has to win", () => {
    expect(slugOf("ChillPenguin")).toBe(slugOf("chillpenguin"));
    expect(slugOf("Cool-Candle")).toBe(slugOf("coolcandle"));
    expect(slugOf("AlienTeen")).toBe("alienteen");
  });

  it("keeps different bodies different", () => {
    expect(slugOf("CuteMoth")).not.toBe(slugOf("CatMoth"));
  });
});

describe("reading the wardrobe out of the catalogue file", () => {
  it("finds the list under `avatars`, which is where it actually lives", () => {
    // I read `bodies`, got nothing, and silently fell back to the 15 bundled
    // ones while the page still said 301 — a shortlist presented as a wardrobe,
    // which is the precise thing that change existed to prevent.
    const payload = { what: "a note", avatars: [{ name: "AbissalDude" }, { name: "AjoMajo" }] };
    expect(bodiesFromCatalogue(payload).map((b) => b.name)).toEqual(["AbissalDude", "AjoMajo"]);
  });

  it("still accepts a bare array or a `bodies` key", () => {
    expect(bodiesFromCatalogue([{ name: "Shiro" }])).toHaveLength(1);
    expect(bodiesFromCatalogue({ bodies: [{ name: "Shiro" }] })).toHaveLength(1);
  });

  it("returns empty rather than throwing on something unexpected", () => {
    // The page falls back to the on-hand list; it must not go blank.
    expect(bodiesFromCatalogue(null)).toEqual([]);
    expect(bodiesFromCatalogue("nonsense")).toEqual([]);
  });
});

describe("ownership and membership stay apart", () => {
  const ownerships = [
    { agentActorId: "Sill", ownerActorId: "Nikk2", state: "verified" },
    { agentActorId: "Moraine", ownerActorId: "Nikk2", state: "pending" },
    { agentActorId: "Ghost", ownerActorId: "Nikk2", state: "revoked" },
  ];
  const memberships = [
    { projectId: "saha", actorId: "Sill", active: true },
    { projectId: "old", actorId: "Sill", active: false },
  ];

  it("shows who operates an agent", () => {
    expect(standingOf("Sill", ownerships, memberships).operatedBy).toHaveLength(1);
  });

  it("shows what a human operates, including claims not yet confirmed", () => {
    // A claim is a REQUEST; only the agent confirming makes it true. It is
    // still worth showing, labelled, rather than hidden until settled.
    expect(standingOf("Nikk2", ownerships, memberships).operates.map((o) => o.agentActorId))
      .toEqual(["Sill", "Moraine"]);
  });

  it("drops revoked links, which are history rather than standing", () => {
    expect(standingOf("Nikk2", ownerships, memberships).operates.map((o) => o.agentActorId))
      .not.toContain("Ghost");
  });

  it("KEEPS MEMBERSHIP SEPARATE FROM OWNERSHIP", () => {
    // Operating an agent grants no project authority. The schema keeps these in
    // two tables that nothing joins; if this ever returns one merged list, the
    // page has started asserting what the database refuses to.
    const standing = standingOf("Sill", ownerships, memberships);
    expect(standing.projects).toEqual(["saha"]);
    expect(standing.operatedBy[0]?.ownerActorId).toBe("Nikk2");
    expect(Object.keys(standing).sort()).toEqual(["operatedBy", "operates", "projects"]);
  });

  it("counts only active memberships", () => {
    expect(standingOf("Sill", ownerships, memberships).projects).not.toContain("old");
  });
});
