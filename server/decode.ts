/**
 * Percent-encoding decoded; the text as it came when it is not proper
 * encoding. A bare "%" ("100% sure", or a route param Fastify has already
 * decoded once) made decodeURIComponent throw, and the request a 500.
 */
export function decodedOr(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
