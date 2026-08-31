import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { fetchPlans, type Plan } from './api'
import './PlanDescription.css'

interface PlanDescriptionProps {
  planId: string
}

function getReturnUrl() {
  const from = new URLSearchParams(window.location.search).get('from')
  return from?.startsWith('/') ? from : import.meta.env.BASE_URL
}

export default function PlanDescription({ planId }: PlanDescriptionProps) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchPlans()
      .then((plans) => {
        const matchingPlan = plans.find((candidate) => candidate.id === planId) ?? null
        if (!matchingPlan) setError('Training plan not found.')
        setPlan(matchingPlan)
      })
      .catch((caughtError) => setError(caughtError instanceof Error ? caughtError.message : String(caughtError)))
      .finally(() => setLoading(false))
  }, [planId])

  return (
    <main className="plan-description-page" aria-labelledby="plan-description-title">
      <a className="plan-description-back" href={getReturnUrl()}>
        Back to plans
      </a>
      {loading && <p>Loading plan description...</p>}
      {error && <p className="plan-description-error" role="alert">{error}</p>}
      {plan && !error && (
        <article className="plan-description">
          <p className="plan-description-kicker">{plan.plan_code}</p>
          <h1 id="plan-description-title">{plan.title}</h1>
          {plan.description?.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
              {plan.description}
            </ReactMarkdown>
          ) : (
            <p>This plan does not have a description.</p>
          )}
        </article>
      )}
    </main>
  )
}
