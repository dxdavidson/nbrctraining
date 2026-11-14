export function showEnvBanner() {
  if (!__ENV_LABEL__) return

  document.title = `[${__ENV_LABEL__}] ${document.title}`
  const banner = document.createElement('div')
  banner.textContent = `${__ENV_LABEL__} - not production`
  banner.style.cssText =
    'position:sticky;top:0;z-index:1000;padding:2px 8px;background:#c2410c;color:#fff;' +
    'font:700 12px sans-serif;text-align:center;letter-spacing:.05em;text-transform:uppercase'
  document.body.prepend(banner)
}
