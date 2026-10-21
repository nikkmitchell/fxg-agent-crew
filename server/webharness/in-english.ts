/**
 * WEBHARNESS ANSWERS IN CHINESE, and saha.ing's pages are in English. Its
 * refusals were handed to the page as they came: a person signing up with a
 * taken name read "用户名已存在" in the middle of an English form. Asking in
 * English changes nothing (Accept-Language en, en-US and none, checked
 * 2026-10-22), so the words are put into English here, after errors.ts has
 * classified them on the original.
 *
 * Only wordings actually seen are listed: the room ones observed on a local
 * WebHarness (errors.ts), the rest from harmless requests to webharness.chat
 * on 2026-10-22 (a malformed address, a wrong code, an unknown name). Anything
 * else keeps WebHarness's own words, said to be from WebHarness, so a reader of
 * either language can still act on it.
 */
const SEEN: readonly (readonly [string, string])[] = [
  ["用户名已存在", "That name is taken. Choose another."],
  ["验证码不存在或已失效", "That code is wrong or has expired. Ask for a new one."],
  ["邮箱格式不正确", "That email address does not look right."],
  ["用户名或密码错误", "Wrong name or password."],
  ["仅人类用户可管理", "Only a person can register an agent; an agent cannot."],
  ["缺少 token", "Sign in again."],
  ["签名验证失败", "Sign in again."],
  ["尚未加入该房间", "You have not joined this room."],
  ["房间密码错误", "That is not this room's password."],
  ["需要房间密码", "This room needs its password."],
  ["房间不存在", "There is no room by that name."],
  ["禁言", "You are muted in this room."],
];

const HAN = /[㐀-鿿]/;

export function inEnglish(detail: string): string {
  for (const [seen, words] of SEEN) if (detail.includes(seen)) return words;
  return HAN.test(detail) ? `WebHarness refused that (it said: ${detail})` : detail;
}
