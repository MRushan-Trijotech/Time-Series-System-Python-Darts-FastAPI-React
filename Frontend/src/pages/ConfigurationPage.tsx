import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Calendar,
  Play,
  AlertCircle,
  Loader2,
  ChevronDown,
  Search,
  Check,
  Target,
  Info,
  TrendingUp,
  Layers,
  Filter,
  X,
  SlidersHorizontal,
} from 'lucide-react'
import { getDimensions, getSeriesInfo, startTraining } from '../api/client'
import { useSession } from '../contexts/SessionContext'
import type { TargetOption, HierarchyTreeNode } from '../types'

// Reusable compact searchable multi-select dropdown
interface MultiSelectProps {
  label: string
  subtitle?: string
  options: { value: string; label: string; group?: string }[]
  selectedValues: string[]
  onChange: (vals: string[]) => void
  placeholder?: string
  badgeColor?: string
}

const CompactMultiSelect: React.FC<MultiSelectProps> = ({
  label,
  subtitle,
  options,
  selectedValues,
  onChange,
  placeholder = 'Search items...',
  badgeColor = 'bg-blue-50 text-blue-700 border-blue-200',
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  const { selectedList, unselectedList } = useMemo(() => {
    let list = options
    if (search.trim()) {
      const q = search.toLowerCase()
      list = options.filter(
        (o) => o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)
      )
    }
    if (selectedValues.length === 0) {
      return { selectedList: [], unselectedList: list }
    }
    const selectedSet = new Set(selectedValues)
    const sel: typeof options = []
    const unsel: typeof options = []
    for (const opt of list) {
      if (selectedSet.has(opt.value)) {
        sel.push(opt)
      } else {
        unsel.push(opt)
      }
    }
    return { selectedList: sel, unselectedList: unsel }
  }, [options, search, selectedValues])

  const isAllSelected = options.length > 0 && selectedValues.length === options.length
  const isNoneSelected = selectedValues.length === 0

  const toggleValue = (val: string) => {
    if (selectedValues.includes(val)) {
      onChange(selectedValues.filter((v) => v !== val))
    } else {
      onChange([...selectedValues, val])
    }
  }

  const selectAll = () => onChange(options.map((o) => o.value))
  const clearAll = () => onChange([])

  const renderOption = (opt: { value: string; label: string; group?: string }, checked: boolean) => (
    <div
      key={opt.value}
      onClick={() => toggleValue(opt.value)}
      className={`px-2.5 py-1.5 rounded-md text-xs cursor-pointer flex items-center justify-between transition ${
        checked
          ? 'bg-blue-50/70 text-blue-900 font-medium'
          : 'hover:bg-slate-50 text-slate-700'
      }`}
    >
      <div className="flex items-center gap-2 truncate">
        <div
          className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
            checked
              ? 'bg-blue-600 border-blue-600 text-white'
              : 'border-slate-300 bg-white'
          }`}
        >
          {checked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
        </div>
        <span className="truncate">{opt.label}</span>
      </div>
      {opt.group && (
        <span className="text-[10px] text-slate-400 shrink-0 ml-1 font-mono">
          {opt.group}
        </span>
      )}
    </div>
  )

  return (
    <div className="relative" ref={containerRef}>
      <label className="text-xs font-semibold text-slate-700 mb-1 flex items-center justify-between">
        <span className="truncate">{label}</span>
        {subtitle && <span className="text-[10px] text-slate-400 font-normal">{subtitle}</span>}
      </label>

      {/* Dropdown trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full h-10 px-3 bg-white border border-slate-200 hover:border-slate-300 rounded-lg text-xs font-medium text-slate-700 flex items-center justify-between shadow-2xs transition focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <div className="flex items-center gap-2 truncate pr-2">
          {isNoneSelected ? (
            <span className="text-slate-500 italic">All included ({options.length})</span>
          ) : isAllSelected ? (
            <span className="text-slate-800 font-semibold">All {options.length} selected</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 truncate">
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${badgeColor}`}>
                {selectedValues.length} selected
              </span>
              <span className="text-slate-600 truncate">
                {selectedValues.slice(0, 3).join(', ')}
                {selectedValues.length > 3 ? ` +${selectedValues.length - 3} more` : ''}
              </span>
            </span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Popover menu */}
      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 p-2 space-y-2 animate-in fade-in zoom-in-95 duration-100 min-w-[280px]">
          {/* Search bar inside popover */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder={placeholder || `Search ${options.length} items...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Quick Actions */}
          <div className="flex items-center justify-between text-[11px] px-1 text-slate-500 border-b border-slate-100 pb-1.5">
            <button
              type="button"
              onClick={selectAll}
              className="text-blue-600 hover:underline font-semibold"
            >
              Select All ({options.length})
            </button>
            <span className="text-slate-300">|</span>
            <button
              type="button"
              onClick={clearAll}
              className="text-slate-500 hover:text-slate-700 hover:underline"
            >
              Reset / All
            </button>
          </div>

          {/* Options List */}
          <div className="max-h-52 overflow-y-auto space-y-0.5 pr-0.5">
            {selectedList.length === 0 && unselectedList.length === 0 ? (
              <p className="text-xs text-slate-400 p-3 text-center italic">No matching items</p>
            ) : (
              <>
                {selectedList.length > 0 && (
                  <div className="pb-1 mb-1 border-b border-slate-100">
                    <div className="px-2 py-0.5 text-[10px] font-semibold text-blue-600 uppercase tracking-wider flex items-center justify-between">
                      <span>Selected ({selectedList.length})</span>
                    </div>
                    {selectedList.map((opt) => renderOption(opt, true))}
                  </div>
                )}
                {unselectedList.length > 0 && (
                  <div>
                    {selectedList.length > 0 && (
                      <div className="px-2 py-0.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                        <span>Other items</span>
                      </div>
                    )}
                    {unselectedList.map((opt) => renderOption(opt, false))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Reusable compact searchable single-select dropdown for Target Account
interface SingleSelectProps {
  label: string
  subtitle?: string
  options: TargetOption[]
  selectedValue: string | null
  onChange: (val: string) => void
}

const CompactTargetSelect: React.FC<SingleSelectProps> = ({
  label,
  subtitle,
  options,
  selectedValue,
  onChange,
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  const selectedOption = options.find((o) => o.value === selectedValue)

  const filtered = useMemo(() => {
    if (!search.trim()) return options
    const q = search.toLowerCase()
    return options.filter(
      (o) =>
        o.value.toLowerCase().includes(q) ||
        (o.description && o.description.toLowerCase().includes(q)) ||
        o.label.toLowerCase().includes(q)
    )
  }, [options, search])

  return (
    <div className="relative" ref={containerRef}>
      <label className="text-xs font-semibold text-slate-700 mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <Target className="w-3.5 h-3.5 text-emerald-600" />
          <span>{label}</span>
        </span>
        {subtitle && <span className="text-[10px] text-slate-400 font-normal">{subtitle}</span>}
      </label>

      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full h-10 px-3 bg-white border rounded-lg text-xs font-medium flex items-center justify-between shadow-2xs transition focus:outline-none focus:ring-1 focus:ring-emerald-500 ${
          selectedValue
            ? 'border-emerald-300 text-slate-800'
            : 'border-slate-200 text-slate-400'
        }`}
      >
        <div className="flex items-center gap-2 truncate pr-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
          {selectedOption ? (
            <span className="font-semibold truncate">
              {selectedOption.description || selectedOption.value}{' '}
              <span className="text-[10px] text-slate-400 font-mono font-normal">
                ({selectedOption.value})
              </span>
            </span>
          ) : (
            <span className="italic text-slate-400">Select forecasting target...</span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Popover */}
      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 p-2 space-y-2 animate-in fade-in zoom-in-95 duration-100 min-w-[280px]">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder={`Search ${options.length} target accounts...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="max-h-56 overflow-y-auto space-y-0.5 pr-0.5">
            {filtered.length === 0 ? (
              <p className="text-xs text-slate-400 p-3 text-center italic">No targets found</p>
            ) : (
              filtered.map((opt) => {
                const isSelected = opt.value === selectedValue
                return (
                  <div
                    key={opt.value}
                    onClick={() => {
                      onChange(opt.value)
                      setIsOpen(false)
                    }}
                    className={`px-2.5 py-2 rounded-md text-xs cursor-pointer flex items-center justify-between transition ${
                      isSelected
                        ? 'bg-emerald-50 text-emerald-900 font-semibold border border-emerald-200'
                        : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <span className="block truncate font-medium">
                        {opt.description || opt.value}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono block">
                        Code: {opt.value}
                      </span>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-emerald-600 shrink-0" />}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export const ConfigurationPage: React.FC = () => {
  const navigate = useNavigate()
  const { datasetId, transformData, setJobId, setForecastConfig } = useSession()

  const [hierarchyLevels, setHierarchyLevels] = useState<string[]>([])
  const [hierarchyTree, setHierarchyTree] = useState<HierarchyTreeNode[]>([])
  const [targetsList, setTargetsList] = useState<TargetOption[]>([])
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null)
  const [targetColumnName, setTargetColumnName] = useState<string>('Account')

  // Level index -> selected array of strings
  const [selectedByLevel, setSelectedByLevel] = useState<Record<number, string[]>>({})

  // Series info
  const [seriesInfo, setSeriesInfo] = useState<{
    n_observations: number
    date_range_start: string
    date_range_end: string
    recommended_horizon: number
    warnings: string[]
  } | null>(null)
  const [seriesInfoLoading, setSeriesInfoLoading] = useState(false)

  // Date range and horizon
  const [trainStart, setTrainStart] = useState<string>('')
  const [trainEnd, setTrainEnd] = useState<string>('')
  const [forecastHorizon, setForecastHorizon] = useState<number>(12)

  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!datasetId || !transformData) {
      navigate('/upload')
      return
    }

    const loadConfig = async () => {
      setIsLoading(true)
      try {
        const dimRes = await getDimensions(datasetId)
        const levels = dimRes.hierarchy_levels && dimRes.hierarchy_levels.length > 0
          ? dimRes.hierarchy_levels
          : ['Business unit', 'SAC_Legal_Entity']
        setHierarchyLevels(levels)
        setHierarchyTree(dimRes.hierarchy_tree || [])
        setTargetColumnName(dimRes.target_column || 'Account')

        // Target options
        const tOpts = dimRes.targets && dimRes.targets.length > 0
          ? dimRes.targets
          : (dimRes.accounts || []).map((a) => ({
              value: a.account,
              description: a.description,
              label: a.label,
            }))
        setTargetsList(tOpts)

        // Default target: prefer sales revenue / PL01
        const defaultTarget =
          tOpts.find(
            (t) =>
              t.value.toUpperCase() === 'PL01' ||
              (t.description && t.description.toLowerCase().includes('sales revenue'))
          )?.value || (tOpts[0]?.value ?? null)
        setSelectedTarget(defaultTarget)

        // Initialize empty selection (means 'all' at each level)
        const initialSelected: Record<number, string[]> = {}
        levels.forEach((_, idx) => {
          initialSelected[idx] = []
        })
        setSelectedByLevel(initialSelected)
      } catch (err: any) {
        setErrorMsg(err.message || 'Failed to load configuration parameters.')
      } finally {
        setIsLoading(false)
      }
    }

    loadConfig()
  }, [datasetId, transformData, navigate])

  // Compute available options at each level based on cascading parent selections
  const optionsByLevel = useMemo(() => {
    const result: Record<number, { value: string; label: string; group?: string }[]> = {}
    if (!hierarchyLevels.length) return result

    // Level 0 options: top-level nodes in hierarchyTree
    result[0] = hierarchyTree.map((n) => ({
      value: n.value,
      label: n.value,
    }))

    // Level 1+ options: cascade from parent level selections
    for (let lvl = 1; lvl < hierarchyLevels.length; lvl++) {
      const levelOpts: { value: string; label: string; group?: string }[] = []
      const seen = new Set<string>()

      const traverse = (node: HierarchyTreeNode, currentDepth: number, parentScopedVal: string) => {
        const scopedVal = currentDepth === 0 ? node.value : `${parentScopedVal}-${node.value}`
        if (currentDepth === lvl) {
          if (!seen.has(scopedVal)) {
            seen.add(scopedVal)
            levelOpts.push({
              value: scopedVal,
              label: scopedVal,
              group: parentScopedVal,
            })
          }
          return
        }
        if (node.children) {
          const selectedAtDepth = selectedByLevel[currentDepth] || []
          const shouldFollow =
            selectedAtDepth.length === 0 || selectedAtDepth.includes(scopedVal)

          if (shouldFollow) {
            node.children.forEach((child) =>
              traverse(child, currentDepth + 1, scopedVal)
            )
          }
        }
      }

      hierarchyTree.forEach((root) => traverse(root, 0, ''))
      result[lvl] = levelOpts
    }

    return result
  }, [hierarchyLevels, hierarchyTree, selectedByLevel])

  // Construct hierarchy selections list for backend
  const hierarchySelections = useMemo(() => {
    if (!hierarchyLevels.length) return undefined

    // Only compute explicit leaf filters if the user has actually filtered any level
    const hasAnySelection = Object.values(selectedByLevel).some((arr) => arr && arr.length > 0)
    if (!hasAnySelection) return undefined

    const leaves: Record<string, string>[] = []
    const traverseToLeaves = (
      node: HierarchyTreeNode,
      depth: number,
      currentBranch: Record<string, string>,
      parentScopedVal: string
    ) => {
      const colName = hierarchyLevels[depth]
      const scopedVal = depth === 0 ? node.value : `${parentScopedVal}-${node.value}`
      const selectedForThisLevel = selectedByLevel[depth] || []
      const isIncluded = selectedForThisLevel.length === 0 || selectedForThisLevel.includes(scopedVal)
      if (!isIncluded) return

      const newBranch = { ...currentBranch, [colName]: node.value }

      if (depth === hierarchyLevels.length - 1 || !node.children || node.children.length === 0) {
        leaves.push(newBranch)
      } else {
        node.children.forEach((child) => traverseToLeaves(child, depth + 1, newBranch, scopedVal))
      }
    }

    hierarchyTree.forEach((root) => traverseToLeaves(root, 0, {}, ''))
    return leaves.length > 0 ? leaves : undefined
  }, [hierarchyLevels, hierarchyTree, selectedByLevel])

  // Backward-compatible bu_entities dict
  const payloadBUEntities = useMemo(() => {
    const buLvlIdx = hierarchyLevels.findIndex((l) => l.toLowerCase().includes('business unit'))
    const entLvlIdx = hierarchyLevels.findIndex(
      (l) => l.toLowerCase().includes('legal_entity') || l.toLowerCase().includes('legal entity')
    )
    if (buLvlIdx < 0 || entLvlIdx < 0) return undefined

    const buSelected = selectedByLevel[buLvlIdx] || []
    const entSelected = selectedByLevel[entLvlIdx] || []

    // If neither BU nor Entity is filtered, don't generate payload map
    if (buSelected.length === 0 && entSelected.length === 0) return undefined

    const map: Record<string, string[]> = {}
    hierarchyTree.forEach((root) => {
      if (buSelected.length === 0 || buSelected.includes(root.value)) {
        const ents = (root.children || [])
          .filter((c) => {
            const scopedChild = `${root.value}-${c.value}`
            return entSelected.length === 0 || entSelected.includes(scopedChild)
          })
          .map((c) => c.value)
        if (ents.length > 0) {
          map[root.value] = ents
        }
      }
    })
    return Object.keys(map).length > 0 ? map : undefined
  }, [hierarchyLevels, hierarchyTree, selectedByLevel])

  // Fetch series info when target or selections change (waits for initial dimensions load to finish)
  const fetchSeriesInfo = useCallback(async () => {
    if (!datasetId || !selectedTarget || isLoading) {
      return
    }
    setSeriesInfoLoading(true)
    try {
      const info = await getSeriesInfo(datasetId, {
        hierarchy_selections: hierarchySelections,
        target_value: selectedTarget,
        bu_entities: payloadBUEntities,
        accounts: [selectedTarget],
      })
      setSeriesInfo(info)
      setTrainStart(info.date_range_start)
      setTrainEnd(info.date_range_end)
    } catch {
      setSeriesInfo(null)
    } finally {
      setSeriesInfoLoading(false)
    }
  }, [datasetId, selectedTarget, isLoading, hierarchySelections, payloadBUEntities])

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchSeriesInfo()
    }, 150)
    return () => clearTimeout(timer)
  }, [fetchSeriesInfo])

  // Count observations
  const filteredObsCount = useMemo(() => {
    if (!seriesInfo || !trainStart || !trainEnd) return seriesInfo?.n_observations || 0
    if (!seriesInfo.date_range_start || !seriesInfo.date_range_end) return 0
    const startMs = new Date(trainStart).getTime()
    const endMs = new Date(trainEnd).getTime()
    const seriesStartMs = new Date(seriesInfo.date_range_start).getTime()
    const seriesEndMs = new Date(seriesInfo.date_range_end).getTime()
    if (startMs > endMs) return 0
    const effStart = Math.max(startMs, seriesStartMs)
    const effEnd = Math.min(endMs, seriesEndMs)
    if (effStart > effEnd) return 0
    const s = new Date(effStart)
    const e = new Date(effEnd)
    return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1
  }, [seriesInfo, trainStart, trainEnd])

  const recommendedHorizon = useMemo(() => {
    if (filteredObsCount <= 0) return 0
    if (filteredObsCount === 36) return 6
    return Math.max(1, Math.min(36, Math.floor(filteredObsCount / 4)))
  }, [filteredObsCount])

  useEffect(() => {
    if (recommendedHorizon > 0) {
      setForecastHorizon(recommendedHorizon)
    }
  }, [recommendedHorizon])

  const hasEnoughData = filteredObsCount >= 12
  const horizonOptions = Array.from({ length: 100 }, (_, i) => i + 1)

  const handleStartTraining = async () => {
    if (!datasetId || !selectedTarget) {
      setErrorMsg('Please select a Forecasting Target account to proceed.')
      return
    }
    if (!hasEnoughData) {
      setErrorMsg(`At least 12 months of training data are required. Current selection: ${filteredObsCount} month(s).`)
      return
    }

    setIsSubmitting(true)
    setErrorMsg(null)
    try {
      const selTargetOpt = targetsList.find((t) => t.value === selectedTarget)

      const hierarchySummary: Record<string, string[]> = {}
      hierarchyLevels.forEach((lvl, idx) => {
        hierarchySummary[lvl] = selectedByLevel[idx] || []
      })

      setForecastConfig({
        hierarchyLevels: hierarchyLevels,
        hierarchySelections: hierarchySummary,
        targetColumn: targetColumnName,
        businessUnits: selectedByLevel[0] || [],
        buEntities: payloadBUEntities || {},
        targetAccount: selectedTarget,
        targetLabel: selTargetOpt ? `${selTargetOpt.description || selTargetOpt.value} (${selTargetOpt.value})` : selectedTarget,
        trainStart: trainStart || seriesInfo?.date_range_start || '',
        trainEnd: trainEnd || seriesInfo?.date_range_end || '',
        forecastHorizon: forecastHorizon,
        totalObservations: filteredObsCount,
      })

      const res = await startTraining({
        dataset_id: datasetId,
        hierarchy_selections: hierarchySelections,
        target_value: selectedTarget,
        bu_entities: payloadBUEntities,
        accounts: [selectedTarget],
        forecast_horizon: forecastHorizon,
        validation_split: 0.75,
        train_start: trainStart || undefined,
        train_end: trainEnd || undefined,
      })
      setJobId(res.job_id)
      navigate('/training')
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || err.message || 'Failed to submit training job.')
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-3">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
        <p className="text-sm text-slate-500">Loading dimensions and hierarchy levels...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Forecast Configuration</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Select multi-level hierarchy segments and a forecasting target via clean compact dropdowns.
          </p>
        </div>

        <button
          onClick={handleStartTraining}
          disabled={isSubmitting || !selectedTarget || !hasEnoughData}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition flex items-center gap-2 shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Launching Tournament...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              <span>Train and Forecast</span>
            </>
          )}
        </button>
      </div>

      {errorMsg && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm flex items-center gap-2">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Main Grid: Left Column Locked & Right Column Independently Scrollable */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column (2 cols): Multi-Level Hierarchy Dropdowns + Target Dropdown (Locked in view) */}
        <div className="lg:col-span-2 space-y-6 lg:sticky lg:top-4">
          {/* SECTION 1: Dynamic Hierarchy Dropdowns */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  1. Multi-Level Hierarchy Selection
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-blue-50 text-blue-700 font-semibold border border-blue-200">
                  {hierarchyLevels.length} Level{hierarchyLevels.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="text-xs text-slate-400">
                Cascading dropdown filters
              </div>
            </div>

            {/* Dropdowns for each hierarchy level */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {hierarchyLevels.map((lvlName, idx) => {
                const opts = optionsByLevel[idx] || []
                const selected = selectedByLevel[idx] || []
                const isChild = idx > 0
                return (
                  <CompactMultiSelect
                    key={lvlName}
                    label={`Level ${idx + 1}: ${lvlName}`}
                    subtitle={isChild ? `Cascades from Level ${idx}` : 'Top-level parent'}
                    options={opts}
                    selectedValues={selected}
                    onChange={(newVals) => {
                      setSelectedByLevel((prev) => {
                        const updated = { ...prev, [idx]: newVals }
                        // Reset child levels if parent changes
                        for (let c = idx + 1; c < hierarchyLevels.length; c++) {
                          updated[c] = []
                        }
                        return updated
                      })
                    }}
                    placeholder={`Select ${lvlName}...`}
                  />
                )
              })}
            </div>

            {/* Active leaf segments summary */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-blue-500" />
                <span>Active Leaf Segments to Train:</span>
                <span className="font-bold text-slate-800">
                  {hierarchySelections ? hierarchySelections.length : 'All combinations'}
                </span>
              </div>
              <span className="text-[11px] text-slate-400">
                Each leaf will be forecasted as an independent segment
              </span>
            </div>
          </div>

          {/* SECTION 2: Forecasting Target Dropdown */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  2. Forecasting Target
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                  Single Select Dropdown
                </span>
              </div>
            </div>

            <CompactTargetSelect
              label="Select Forecasting Metric / Account"
              subtitle="Metric identifier for training"
              options={targetsList}
              selectedValue={selectedTarget}
              onChange={(val) => setSelectedTarget(val)}
            />

            <div className="text-[11px] text-slate-400 italic pt-1">
              Selecting a single target isolates the historical time series without double-counting aggregation rows.
            </div>
          </div>
        </div>

        {/* Right Column: Dedicated Scrollable Parameters & Telemetry Panel */}
        <div className="lg:col-span-1">
          <div className="bg-slate-50/90 border border-slate-200 rounded-2xl p-4 shadow-2xs space-y-3.5">
            {/* Header for Right Panel */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Parameters
                </span>
              </div>
              {/* <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold border border-blue-200">
                Scrollable
              </span> */}
            </div>

            {/* Independent Scroll Container */}
            <div className="lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto space-y-4 pr-1.5 [scrollbar-width:thin] [scrollbar-color:#94a3b8_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 hover:[&::-webkit-scrollbar-thumb]:bg-slate-400 [&::-webkit-scrollbar-track]:bg-transparent">
              {/* Series Info Panel */}
              <div className="bg-white p-4.5 rounded-xl border border-slate-200/90 shadow-2xs space-y-3.5">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-slate-100">
                  <TrendingUp className="w-4 h-4 text-blue-600" />
                  Series Information
                </span>

                {seriesInfoLoading ? (
                  <div className="flex items-center gap-2 py-4 justify-center text-slate-500 text-xs">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                    <span>Checking available history...</span>
                  </div>
                ) : seriesInfo && seriesInfo.n_observations > 0 ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                        <span className="text-[10px] text-slate-400 block mb-0.5 uppercase tracking-wide">
                          Available Start
                        </span>
                        <span className="text-xs font-bold text-slate-800">
                          {new Date(seriesInfo.date_range_start).toLocaleDateString('en-US', {
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                        <span className="text-[10px] text-slate-400 block mb-0.5 uppercase tracking-wide">
                          Available End
                        </span>
                        <span className="text-xs font-bold text-slate-800">
                          {new Date(seriesInfo.date_range_end).toLocaleDateString('en-US', {
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                      </div>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-3 border border-blue-100 flex items-center justify-between">
                      <span className="text-xs text-blue-700 font-semibold">
                        Available Observations
                      </span>
                      <span className="text-lg font-bold text-blue-700">
                        {seriesInfo.n_observations}
                      </span>
                    </div>
                    {seriesInfo.warnings.length > 0 && (
                      <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 flex gap-1.5">
                        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{seriesInfo.warnings[0]}</span>
                      </div>
                    )}
                  </div>
                ) : !selectedTarget ? (
                  <div className="text-xs text-slate-400 italic text-center py-4">
                    Select a forecasting target to see series information.
                  </div>
                ) : (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1 text-center">
                    <p className="font-semibold">No Historical Data Found</p>
                    <p className="text-[11px] text-amber-700">
                      All observations for this target are empty or zero in the selected segments.
                    </p>
                  </div>
                )}
              </div>

              {/* Training Date Range */}
              <div className="bg-white p-4.5 rounded-xl border border-slate-200/90 shadow-2xs space-y-3.5">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-slate-100">
                  <Calendar className="w-4 h-4 text-blue-600" />
                  Training Date Range
                </span>

                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] text-slate-500 font-medium block mb-1">
                      Start Month:
                    </label>
                    <input
                      type="date"
                      value={trainStart}
                      min={seriesInfo?.date_range_start || ''}
                      max={trainEnd || seriesInfo?.date_range_end || ''}
                      onChange={(e) => setTrainStart(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-500 font-medium block mb-1">
                      End Month:
                    </label>
                    <input
                      type="date"
                      value={trainEnd}
                      min={trainStart || seriesInfo?.date_range_start || ''}
                      max={seriesInfo?.date_range_end || ''}
                      onChange={(e) => setTrainEnd(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div
                    className={`p-2.5 rounded-lg border flex items-center justify-between text-xs font-medium ${
                      hasEnoughData
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-rose-50 border-rose-200 text-rose-800'
                    }`}
                  >
                    <span>Selected Training Months:</span>
                    <span className="font-bold text-sm">{filteredObsCount}</span>
                  </div>
                  {!hasEnoughData && (
                    <p className="text-[11px] text-rose-600">
                      Minimum 12 months required for training.
                    </p>
                  )}
                </div>
              </div>

              {/* Forecast Horizon */}
              <div className="bg-white p-4.5 rounded-xl border border-slate-200/90 shadow-2xs space-y-3.5">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-blue-600" />
                    Forecast Horizon
                  </span>
                  {recommendedHorizon > 0 && (
                    <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-semibold border border-blue-200">
                      Rec: {recommendedHorizon} mo
                    </span>
                  )}
                </div>

                <div className="space-y-2">
                  <select
                    value={forecastHorizon}
                    onChange={(e) => setForecastHorizon(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-semibold text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {horizonOptions.map((h) => (
                      <option key={h} value={h}>
                        {h} month{h > 1 ? 's' : ''} {h === recommendedHorizon ? '(Recommended)' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-400">
                    Recommended 4:1 training ratio based on {filteredObsCount} observations.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
