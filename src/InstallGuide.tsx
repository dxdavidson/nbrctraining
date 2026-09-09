import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import './InstallGuide.css'

interface InstallGuideProps {
  page: 'index' | 'android' | 'apple'
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
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
            {markdown}
          </ReactMarkdown>
        </article>
      )}
    </main>
  )
}
