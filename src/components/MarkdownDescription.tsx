import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

interface MarkdownDescriptionProps {
  value: string | null
  className?: string
}

export default function MarkdownDescription({ value, className }: MarkdownDescriptionProps) {
  if (!value?.trim()) return <>—</>

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {value.replace(/\\n/g, '\n')}
      </ReactMarkdown>
    </div>
  )
}
