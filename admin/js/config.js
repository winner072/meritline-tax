// Settings for the blog admin page. Change these only if the website moves to another repository.
export const CONFIG = Object.freeze({
  owner: "winner072", repo: "meritline-tax", siteUrl: "https://meritlinetaxservices.com",
  apiBase: "https://api.github.com", apiVersion: "2026-03-10",
  storagePrefix: "mlt-admin.v1.",
  keyHelpUrl: "https://github.com/settings/personal-access-tokens/new?name=Meritline+blog+admin&description=Lets+the+website+admin+page+publish+blog+posts.&target_name=winner072&expires_in=366&contents=write",
  rememberDays: 30,
  livePollMs: 15000, livePollLocalMs: 1000, liveTimeoutMs: 600000,
  maxImageInputBytes: 10 * 1024 * 1024, maxImageBytes: 1024 * 1024, maxImageSide: 1600
});
