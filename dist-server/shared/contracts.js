/**
 * Wire contracts shared by the BFF and the UI.
 *
 * Nothing in here carries a WebHarness bearer token. That is deliberate and is
 * enforced by server/__tests__/session.test.ts: the upstream token lives only in
 * the server-side session, and the browser holds an opaque httpOnly cookie.
 */
export {};
//# sourceMappingURL=contracts.js.map