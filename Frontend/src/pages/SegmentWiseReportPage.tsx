import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Download,
  Calendar,
  Layers,
  ChevronDown,
  ChevronRight,
  Search,
  Loader2,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  FileSpreadsheet,
} from 'lucide-react'
import { API_BASE_URL, getSegmentWiseReport } from '../api/client'
import { useSession } from '../contexts/SessionContext'
import type { SegmentWiseReportResponse } from '../types'

// Format number with standard commas and 2 decimals: -11,881,901.94
function formatNumber(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return '—'
  const isNegative = val < 0
  const absVal = Math.abs(val)
  const formatted = absVal.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${isNegative ? '-' : ''}${formatted}`
}

export const SegmentWiseReportPage: React.FC = () => {
  const navigate = useNavigate()
  const { jobId, setEntityStatus } = useSession()

  const [reportData, setReportData] = useState<SegmentWiseReportResponse | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Filters & Controls
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({})

  // Poller for segment-wise training completion
  useEffect(() => {
    if (!jobId) {
      navigate('/configure')
      return
    }

    let isMounted = true
    let pollTimer: any = null

    const fetchStatus = async () => {
      try {
        const resp = await getSegmentWiseReport(jobId)
        if (!isMounted) return
        setReportData(resp)
        if (resp.status) {
          setEntityStatus(resp.status)
        }

        if (resp.status === 'completed') {
          setIsLoading(false)
          // Default all parents to expanded
          if (resp.data) {
            const initialParents: Record<string, boolean> = {}
            if (resp.data.segment_forecasts || resp.data.entity_forecasts) {
              const items = resp.data.segment_forecasts || resp.data.entity_forecasts || []
              items.forEach((e) => {
                initialParents[e.business_unit] = true
              })
            } else if (resp.data.hierarchy?.[0]?.business_units) {
              resp.data.hierarchy[0].business_units.forEach((b) => {
                initialParents[b.business_unit] = true
              })
            }
            setExpandedParents(initialParents)
          }
        } else if (resp.status === 'failed') {
          setIsLoading(false)
          setErrorMsg(resp.error || 'Segment-wise training failed.')
        } else {
          pollTimer = setTimeout(fetchStatus, 1500)
        }
      } catch (err: any) {
        if (!isMounted) return
        setErrorMsg(err.response?.data?.detail || err.message || 'Failed to fetch segment-wise report.')
        setIsLoading(false)
      }
    }

    fetchStatus()

    return () => {
      isMounted = false
      if (pollTimer) clearTimeout(pollTimer)
    }
  }, [jobId, navigate, setEntityStatus])

  // Build matrix data
  const tableData = useMemo(() => {
    if (!reportData?.data) return null
    const { months, hierarchy, segment_forecasts, entity_forecasts } = reportData.data
    const forecasts = segment_forecasts || entity_forecasts || []

    const parentMap: Record<
      string,
      {
        parent: string
        total: number
        months: Record<string, number>
        children: Array<{
          name: string
          dims?: Record<string, string>
          total: number
          months: Record<string, number>
          best_model?: string
        }>
      }
    > = {}

    if (forecasts && forecasts.length > 0) {
      forecasts.forEach((item) => {
        const parentKey = item.business_unit || 'All'
        if (!parentMap[parentKey]) {
          parentMap[parentKey] = {
            parent: parentKey,
            total: 0,
            months: {},
            children: [],
          }
          months.forEach((m) => {
            parentMap[parentKey].months[m] = 0
          })
        }

        const childMonths: Record<string, number> = {}
        let childTotal = 0
        months.forEach((m) => {
          const val = item.forecast?.[m] ?? 0
          childMonths[m] = val
          childTotal += val
          parentMap[parentKey].months[m] += val
          parentMap[parentKey].total += val
        })

        parentMap[parentKey].children.push({
          name: item.entity || item.business_unit,
          dims: item.dims,
          total: childTotal,
          months: childMonths,
          best_model: item.best_model,
        })
      })
    } else if (hierarchy && hierarchy.length > 0) {
      hierarchy.forEach((mNode) => {
        const m = mNode.month
        mNode.business_units.forEach((bNode) => {
          const parentKey = bNode.business_unit
          if (!parentMap[parentKey]) {
            parentMap[parentKey] = {
              parent: parentKey,
              total: 0,
              months: {},
              children: [],
            }
            months.forEach((mo) => {
              parentMap[parentKey].months[mo] = 0
            })
          }
          parentMap[parentKey].months[m] = (parentMap[parentKey].months[m] || 0) + (bNode.forecast || 0)
          parentMap[parentKey].total += bNode.forecast || 0

          bNode.entities.forEach((eNode) => {
            let existingChild = parentMap[parentKey].children.find((c) => c.name === eNode.entity)
            if (!existingChild) {
              existingChild = {
                name: eNode.entity,
                total: 0,
                months: {},
                best_model: eNode.best_model,
              }
              parentMap[parentKey].children.push(existingChild)
            }
            existingChild.months[m] = eNode.forecast || 0
            existingChild.total += eNode.forecast || 0
          })
        })
      })
    }

    const grandMonths: Record<string, number> = {}
    let grandTotal = 0
    months.forEach((m) => {
      grandMonths[m] = 0
      Object.values(parentMap).forEach((b) => {
        grandMonths[m] += b.months[m] || 0
      })
      grandTotal += grandMonths[m]
    })

    const sortedParents = Object.values(parentMap).sort((a, b) =>
      a.parent.localeCompare(b.parent)
    )
    sortedParents.forEach((b) => {
      b.children.sort((e1, e2) => e1.name.localeCompare(e2.name))
    })

    return {
      months,
      hierarchyLevels: reportData.data.hierarchy_levels || ['Business unit', 'SAC_Legal_Entity'],
      targetAccount: reportData.data.target_account || 'Target',
      targetDescription: reportData.data.target_description || '',
      parents: sortedParents,
      grandTotal,
      grandMonths,
    }
  }, [reportData])

  // Filter parents & children by search query
  const filteredParents = useMemo(() => {
    if (!tableData) return []
    if (!searchQuery.trim()) return tableData.parents

    const q = searchQuery.toLowerCase()
    return tableData.parents
      .map((p) => {
        const parentMatches = p.parent.toLowerCase().includes(q)
        const matchingChildren = p.children.filter((c) =>
          c.name.toLowerCase().includes(q)
        )

        if (parentMatches) {
          return p
        } else if (matchingChildren.length > 0) {
          return {
            ...p,
            children: matchingChildren,
          }
        }
        return null
      })
      .filter(Boolean) as typeof tableData.parents
  }, [tableData, searchQuery])

  const toggleParent = (pKey: string) => {
    setExpandedParents((prev) => ({
      ...prev,
      [pKey]: !prev[pKey],
    }))
  }

  const expandAll = () => {
    if (!tableData) return
    const allExp: Record<string, boolean> = {}
    tableData.parents.forEach((b) => {
      allExp[b.parent] = true
    })
    setExpandedParents(allExp)
  }

  const collapseAll = () => {
    setExpandedParents({})
  }

  // ── Render Progress State ──────────────────────────────────────────────────
  if (isLoading || reportData?.status === 'running' || reportData?.status === 'pending') {
    const progress = reportData?.progress
    const completed = progress?.completed ?? 0
    const total = progress?.total ?? 1
    const percent = progress?.percent ?? 0
    const currentSegment = progress?.current_segment || 'Initializing segment training tournament...'

    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 space-y-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 max-w-xl w-full shadow-sm text-center space-y-6">
          <div className="relative inline-flex items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wider bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
              Stage 2/2: Segment Forecasts
            </span>
            <h2 className="text-lg font-bold text-slate-800">
              Segment-wise Forecast Generation in Progress
            </h2>
            <p className="text-xs text-slate-500 max-w-lg mx-auto">
              Forecasts are being independently calculated across each leaf segment
              in the hierarchy in the background. The full report will automatically unlock
              once all segments complete.
            </p>
          </div>

          {/* Progress Bar & Counter */}
          <div className="max-w-md mx-auto space-y-2">
            <div className="flex justify-between items-center text-xs font-semibold text-slate-600">
              <span className="truncate max-w-[240px] text-left text-slate-700">
                {currentSegment}
              </span>
              <span className="font-mono text-amber-600">
                {completed} / {total} segments ({percent.toFixed(0)}%)
              </span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-amber-500 h-2.5 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(5, percent))}%` }}
              />
            </div>
          </div>

          {/* Helpful Navigation Note */}
          <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/report/forecast')}
              className="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-bold flex items-center gap-2 transition"
            >
              <TrendingUp className="w-4 h-4" />
              <span>View Total Forecast Report</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Render Error State ─────────────────────────────────────────────────────
  if (errorMsg || reportData?.status === 'failed' || !reportData?.data || !tableData) {
    return (
      <div className="p-6 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 space-y-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-rose-600" />
          <h3 className="font-bold text-sm">Segment-wise Report Unavailable</h3>
        </div>
        <p className="text-xs text-rose-700">{errorMsg || reportData?.error || 'Unable to load segment results.'}</p>
        <button
          type="button"
          onClick={() => navigate('/configure')}
          className="px-3.5 py-1.5 bg-white border border-rose-300 text-rose-800 rounded-lg text-xs font-semibold hover:bg-rose-100"
        >
          Return to Configuration
        </button>
      </div>
    )
  }

  const { months, hierarchyLevels } = tableData
  const parentLevelName = hierarchyLevels[0] || 'Parent Segment'
  const childLevelName = hierarchyLevels.length > 1 ? hierarchyLevels[1] : 'Leaf Segment'

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">
            Hierarchical Segment Matrix
          </span>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-800">Segment-wise Forecast Table</h2>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              <span>{reportData.data.total_segments} Segments Forecasted</span>
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Full hierarchical multi-level breakdown matching exact Story layout.
          </p>
        </div>

        {/* Export Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={`${API_BASE_URL}/reports/${jobId}/export/segment-wise.xlsx`}
            download
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-2xs"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Export Story .xlsx</span>
          </a>

          <a
            href={`${API_BASE_URL}/reports/${jobId}/export/segment-wise.csv`}
            download
            className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-2xs"
          >
            <Download className="w-4 h-4 text-slate-500" />
            <span>Export .csv</span>
          </a>
        </div>
      </div>

      {/* Target & Horizon Summary Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
              Forecasting Target
            </span>
            <span className="font-bold text-slate-800 text-sm">
              {tableData.targetDescription || tableData.targetAccount}
            </span>
            <span className="text-slate-400 ml-1.5 font-mono text-[11px]">
              ({tableData.targetAccount})
            </span>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right sm:text-left">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
              Forecast Horizon
            </span>
            <span className="font-semibold text-slate-700 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-blue-500" />
              <span>
                {months.length} Months ({months[0]} → {months[months.length - 1]})
              </span>
            </span>
          </div>

          <div className="text-right sm:text-left">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
              Grand Total Forecast
            </span>
            <span className="font-bold text-blue-700 font-mono text-sm">
              {formatNumber(tableData.grandTotal)}
            </span>
          </div>
        </div>
      </div>

      {/* Matrix Controls & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder={hierarchyLevels.length > 1 ? `Filter by ${parentLevelName} or ${childLevelName}...` : `Filter by ${parentLevelName}...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-2xs"
          />
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={expandAll}
            className="px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-md font-medium transition"
          >
            Expand All
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-md font-medium transition"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Matrix Table Container */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
        <div className="overflow-x-auto max-h-[640px]">
          <table className="w-full text-xs text-left border-collapse select-text">
            <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0 z-20 border-b border-slate-200 shadow-2xs">
              <tr>
                <th className="px-3 py-2.5 border-r border-slate-200 sticky left-0 bg-slate-100 z-30 min-w-[200px]">
                  {parentLevelName}
                </th>
                {hierarchyLevels.length > 1 && (
                  <th className="px-3 py-2.5 border-r border-slate-200 sticky left-[200px] bg-slate-100 z-30 min-w-[180px]">
                    {childLevelName}
                  </th>
                )}
                <th className="px-3 py-2.5 border-r border-slate-200 text-right min-w-[120px] bg-slate-100">
                  Total
                </th>
                {months.map((m) => (
                  <th
                    key={m}
                    className="px-3 py-2.5 border-r border-slate-200 text-right min-w-[110px] whitespace-nowrap font-mono text-[11px]"
                  >
                    {m}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
              {/* Grand Total Row */}
              <tr className="bg-blue-50/80 font-bold text-blue-950 border-b-2 border-blue-200">
                <td className="px-3 py-2.5 border-r border-blue-200 sticky left-0 bg-blue-50/90 z-10 font-sans">
                  (all) Total
                </td>
                {hierarchyLevels.length > 1 && (
                  <td className="px-3 py-2.5 border-r border-blue-200 sticky left-[200px] bg-blue-50/90 z-10 font-sans text-slate-500">
                    (all)
                  </td>
                )}
                <td className="px-3 py-2.5 border-r border-blue-200 text-right text-blue-800 font-bold">
                  {formatNumber(tableData.grandTotal)}
                </td>
                {months.map((m) => (
                  <td key={m} className="px-3 py-2.5 border-r border-blue-200 text-right">
                    {formatNumber(tableData.grandMonths[m])}
                  </td>
                ))}
              </tr>

              {/* Hierarchy Parent & Child Rows */}
              {filteredParents.map((parentGroup) => {
                const isExpanded = expandedParents[parentGroup.parent] ?? true
                const isMultiLevel = hierarchyLevels.length > 1

                return (
                  <React.Fragment key={parentGroup.parent}>
                    {/* Parent Subtotal or Single Leaf Row */}
                    <tr
                      onClick={() => isMultiLevel && toggleParent(parentGroup.parent)}
                      className={`font-semibold text-slate-900 border-t border-slate-200 select-none ${
                        isMultiLevel ? 'bg-slate-50/90 hover:bg-slate-100/80 cursor-pointer' : 'bg-white hover:bg-slate-50'
                      }`}
                    >
                      <td className={`px-3 py-2 border-r border-slate-200 sticky left-0 z-10 font-sans ${isMultiLevel ? 'bg-slate-50/95' : 'bg-white'}`}>
                        <div className="flex items-center gap-1.5">
                          {isMultiLevel ? (
                            isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            )
                          ) : (
                            <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" />
                          )}
                          <span className="font-bold truncate" title={parentGroup.parent}>{parentGroup.parent}</span>
                          {isMultiLevel && (
                            <span className="text-[10px] text-slate-400 font-normal">
                              ({parentGroup.children.length})
                            </span>
                          )}
                        </div>
                      </td>
                      {isMultiLevel && (
                        <td className="px-3 py-2 border-r border-slate-200 sticky left-[200px] z-10 font-sans text-slate-400 bg-slate-50/95 text-[10px]">
                          Subtotal
                        </td>
                      )}
                      <td className="px-3 py-2 border-r border-slate-200 text-right font-bold text-slate-800">
                        {formatNumber(parentGroup.total)}
                      </td>
                      {months.map((m) => (
                        <td key={m} className="px-3 py-2 border-r border-slate-200 text-right">
                          {formatNumber(parentGroup.months[m])}
                        </td>
                      ))}
                    </tr>

                    {/* Child Rows (Leaf Segments for Multi-Level) */}
                    {isExpanded && isMultiLevel &&
                      parentGroup.children.map((child) => (
                        <tr
                          key={child.name}
                          className="hover:bg-slate-50/60 text-slate-700 bg-white"
                        >
                          <td className="px-3 py-1.5 border-r border-slate-200 sticky left-0 bg-white z-10 pl-7 text-slate-400 font-sans text-[10px]">
                            ↳
                          </td>
                          <td className="px-3 py-1.5 border-r border-slate-200 sticky left-[200px] bg-white z-10 font-sans font-medium text-slate-800">
                            <span>{child.name}</span>
                          </td>
                          <td className="px-3 py-1.5 border-r border-slate-200 text-right font-semibold text-slate-700">
                            {formatNumber(child.total)}
                          </td>
                          {months.map((m) => (
                            <td key={m} className="px-3 py-1.5 border-r border-slate-200 text-right">
                              {formatNumber(child.months[m])}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
export default SegmentWiseReportPage
