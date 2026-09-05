import './FeaturePlaceholder.css'

interface FeaturePlaceholderProps {
  title: string
  description: string
}

export default function FeaturePlaceholder({ title, description }: FeaturePlaceholderProps) {
  return (
    <main className="feature-placeholder">
      <p className="feature-placeholder-kicker">NBRC Training</p>
      <h1>{title}</h1>
      <p>{description}</p>
    </main>
  )
}
