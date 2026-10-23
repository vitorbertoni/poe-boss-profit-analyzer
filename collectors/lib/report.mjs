// Surfaces a failure as a GitHub Actions error annotation (readable through the API, unlike raw logs).
// Secrets are masked by Actions, but strip anything that looks like a connection string anyway.
export function reportError(err) {
  const msg = String(err?.message || err)
    .replace(/postgres(ql)?:\/\/[^\s]+/gi, '<db-url>')
    .replace(/\r?\n/g, ' ')
    .slice(0, 900);
  console.error(err);
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=collector failed::${msg}`);
}
