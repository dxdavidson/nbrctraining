function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { year: '2-digit', month: 'short', day: '2-digit' })
}

export default formatDate
