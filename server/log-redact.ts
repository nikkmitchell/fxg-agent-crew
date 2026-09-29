/** A URL as it may be logged: secrets in the query string replaced by "…". */
const SECRET_PARAMS = /([?&](?:ticket|token|key)=)[^&#]*/gi;

export function redactUrl(url: string): string {
  return url.replace(SECRET_PARAMS, "$1…");
}
