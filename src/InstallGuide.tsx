import { useEffect, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { resolveAssetUrl } from './resolveAssetUrl'
import './InstallGuide.css'

interface InstallGuideProps {
  page: 'index' | 'android' | 'apple'
}

const components: Components = {
  a({ href, children }) {
    return <a href={resolveAssetUrl(href)}>{children}</a>
  },
  img({ src, alt }) {
    return <img src={resolveAssetUrl(src)} alt={alt ?? ''} loading="lazy" />
  },
}

export default function InstallGuide({ page }: InstallGuideProps) {
  const [markdown, setMarkdown] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)

    fetch(`${base}/install/${page}.md`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Unable to load install guide: ${response.status}`)
        }
        const text = await response.text()
        if (active) setMarkdown(text)
      })
      .catch((caughtError) => {
        if (!active) return
        setError(caughtError instanceof Error ? caughtError.message : String(caughtError))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [page])

  return (
    <main className="install-guide-page">
      {loading && <p>Loading install guide...</p>}
      {error && <p className="install-guide-error" role="alert">{error}</p>}
      {!loading && !error && (
        <article className="install-guide-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>
            {markdown}
          </ReactMarkdown>
        </article>
      )}
    </main>
  )
}
