// Prefixes root-relative URLs with the app's deployed base path (e.g. /training/).
export function resolveAssetUrl(url: string | undefined) {
  if (!url || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) return url
  if (!url.startsWith('/')) return url

  const baseUrl = import.meta.env.BASE_URL
  const path = url.replace(/^\/+/, '')
  return `${baseUrl}${path}`
}
