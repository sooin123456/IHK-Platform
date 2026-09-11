function setCookies(headers: Headers) {
  return typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : headers.get("Set-Cookie")
      ? [headers.get("Set-Cookie")!]
      : [];
}

export function mergeResponseHeaders(response: Response, headers: Headers) {
  const merged = new Headers(response.headers);
  for (const [name, value] of headers) {
    if (name.toLowerCase() !== "set-cookie" && !merged.has(name))
      merged.set(name, value);
  }
  const existingCookies = new Set(setCookies(merged));
  for (const value of setCookies(headers))
    if (!existingCookies.has(value)) {
      merged.append("Set-Cookie", value);
      existingCookies.add(value);
    }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}
