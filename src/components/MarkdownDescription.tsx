import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { resolveAssetUrl } from '../resolveAssetUrl'

const components: Components = {
  a({ href, children }) {
    return (
      <a href={resolveAssetUrl(href)} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
        {children}
      </a>
    )
  },
  img({ src, alt }) {
    return <img src={resolveAssetUrl(src)} alt={alt ?? ''} loading="lazy" />
  },
}

interface MarkdownDescriptionProps {
  value: string | null
  className?: string
}

export default function MarkdownDescription({ value, className }: MarkdownDescriptionProps) {
  if (!value?.trim()) return <>—</>

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>
        {value.replace(/\\n/g, '\n')}
      </ReactMarkdown>
    </div>
  )
}
