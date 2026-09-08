import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import './TechniquePage.css'

interface TechniquePageProps {
  title: string
  content: string
}

// Supports youtu.be/<id> and youtube.com/watch?v=<id> / embed/<id> links.
function getYouTubeVideoId(href: string): string | null {
  try {
    const url = new URL(href)
    if (url.hostname === 'youtu.be') return url.pathname.slice(1) || null
    if (url.hostname === 'www.youtube.com' || url.hostname === 'youtube.com') {
      if (url.pathname === '/watch') return url.searchParams.get('v')
      if (url.pathname.startsWith('/embed/')) return url.pathname.slice('/embed/'.length) || null
    }
    return null
  } catch {
    return null
  }
}

const components: Components = {
  a({ href, children }) {
    const videoId = href ? getYouTubeVideoId(href) : null
    if (!videoId) {
      return (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      )
    }
    return (
      <a className="youtube-thumbnail-link" href={href} target="_blank" rel="noreferrer">
        <img
          className="youtube-thumbnail"
          src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
          alt="YouTube video thumbnail"
          loading="lazy"
        />
        <span className="youtube-thumbnail-caption">Watch on YouTube</span>
      </a>
    )
  },
}

export default function TechniquePage({ title, content }: TechniquePageProps) {
  return (
    <main className="technique-page" aria-labelledby="technique-page-title">
      <p className="technique-page-kicker">NBRC Training</p>
      <h1 id="technique-page-title">{title}</h1>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>
        {content}
      </ReactMarkdown>
    </main>
  )
}
