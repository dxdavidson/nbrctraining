import { Fragment, useState } from 'react'
import './DataTable.css'

export interface Column<Row> {
  key: string
  header: React.ReactNode
  render: (row: Row) => React.ReactNode
  sortValue?: (row: Row) => string | number | null
  width?: string
}

interface DataTableProps<Row> {
  caption: string
  columns: Column<Row>[]
  rows: Row[]
  getRowId: (row: Row) => string
  selectedId: string | null
  onSelectRow: (row: Row) => void
  expandedRowId?: string | null
  renderExpandedRow?: (row: Row) => React.ReactNode
  onToggleRow?: (row: Row, isExpanded: boolean) => void
  canExpandRow?: (row: Row) => boolean
  getRowClassName?: (row: Row) => string | undefined
  getRowLabel?: (row: Row) => string
  loading: boolean
  emptyMessage: string
}

type SortDirection = 'asc' | 'desc'

export default function DataTable<Row>({
  caption,
  columns,
  rows,
  getRowId,
  selectedId,
  onSelectRow,
  expandedRowId = null,
  renderExpandedRow,
  onToggleRow,
  canExpandRow,
  getRowClassName,
  getRowLabel,
  loading,
  emptyMessage,
}: DataTableProps<Row>) {
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>(null)

  const toggleSort = (column: Column<Row>) => {
    if (!column.sortValue) return
    setSort((current) => {
      if (current?.key !== column.key) return { key: column.key, direction: 'asc' }
      return { key: column.key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    })
  }

  const sortedRows = (() => {
    if (!sort) return rows
    const column = columns.find((c) => c.key === sort.key)
    if (!column?.sortValue) return rows
    const factor = sort.direction === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const av = column.sortValue!(a)
      const bv = column.sortValue!(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return av < bv ? -1 * factor : av > bv ? 1 * factor : 0
    })
  })()

  const hasExpansionControls = Boolean(renderExpandedRow && onToggleRow)

  return (
    <div className="data-table-wrapper">
      <table className={`data-table data-table-${caption.toLowerCase()}`}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {hasExpansionControls && <th className="data-table-disclosure-header" scope="col" aria-label="Expand or collapse" />}
            {columns.map((column) => {
              const isSorted = sort?.key === column.key
              return (
                <th key={column.key} scope="col" style={column.width ? { width: column.width } : undefined} aria-sort={isSorted ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  {column.sortValue ? (
                    <button
                      type="button"
                      className="data-table-sort-button"
                      onClick={() => toggleSort(column)}
                    >
                      {column.header}
                      <span aria-hidden="true" className="data-table-sort-indicator">
                        {isSorted ? (sort!.direction === 'asc' ? '▲' : '▼') : ''}
                      </span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={columns.length} className="data-table-status">
                Loading…
              </td>
            </tr>
          )}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="data-table-status">
                {emptyMessage}
              </td>
            </tr>
          )}
          {!loading &&
            sortedRows.map((row) => {
              const id = getRowId(row)
              const isSelected = id === selectedId
              const canExpand = !canExpandRow || canExpandRow(row)
              const isExpanded = canExpand && id === expandedRowId && Boolean(renderExpandedRow)
              const rowLabel = getRowLabel?.(row) ?? id
              const rowClassName = [getRowClassName?.(row), isSelected && 'data-table-row-selected'].filter(Boolean).join(' ') || undefined
              return (
                <Fragment key={id}>
                  <tr
                    tabIndex={0}
                    aria-selected={isSelected}
                    aria-expanded={canExpand && renderExpandedRow ? isExpanded : undefined}
                    className={rowClassName}
                    onClick={() => onSelectRow(row)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelectRow(row)
                      }
                    }}
                  >
                    {hasExpansionControls && (
                      <td className="data-table-disclosure-cell">
                        {canExpand && (
                          <button
                            type="button"
                            className="data-table-disclosure-button"
                            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${rowLabel}`}
                            aria-expanded={isExpanded}
                            onClick={(event) => {
                              event.stopPropagation()
                              onToggleRow!(row, isExpanded)
                            }}
                          >
                            <span aria-hidden="true">{isExpanded ? '−' : '+'}</span>
                          </button>
                        )}
                      </td>
                    )}
                    {columns.map((column) => (
                      <td key={column.key}>{column.render(row)}</td>
                    ))}
                  </tr>
                  {isExpanded && (
                    <tr className="data-table-detail-row">
                      <td colSpan={columns.length + (hasExpansionControls ? 1 : 0)}>{renderExpandedRow!(row)}</td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
        </tbody>
      </table>
    </div>
  )
}
