import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Calendar,
  Play,
  Cpu,
  CheckSquare,
  Square,
  AlertCircle,
  Loader2,
  Building2,
  Briefcase,
  ChevronDown,
  ChevronUp,
  Search,
  Check,
  Target,
  Circle,
  CircleDot,
} from 'lucide-react'
import { getAvailableModels, getDimensions, startTraining } from '../api/client'
import { useSession } from '../contexts/SessionContext'
import type { AccountItem, CandidateModelInfo, DimensionValue } from '../types'

export const ConfigurationPage: React.FC = () => {
  const navigate = useNavigate()
  const { datasetId, transformData, setJobId } = useSession()

  const [dimensions, setDimensions] = useState<DimensionValue[]>([])
  const [buHierarchy, setBuHierarchy] = useState<Record<string, string[]>>({})
  const [accountsList, setAccountsList] = useState<AccountItem[]>([])
  const [relationsList, setRelationsList] = useState<Record<string, string>[]>([])

  // Selected filters
  const [selectedBUs, setSelectedBUs] = useState<string[]>([])
  const [buEntities, setBuEntities] = useState<Record<string, string[]>>({})
  const [selectedTargetAccount, setSelectedTargetAccount] = useState<string | null>(null)
  const [otherFilters, setOtherFilters] = useState<Record<string, string[]>>({})

  // UI state
  const [buSearch, setBuSearch] = useState('')
  const [accountSearch, setAccountSearch] = useState('')
  const [accountFilterType, setAccountFilterType] = useState<'all' | 'pl' | 'gl'>('all')
  const [expandedBUs, setExpandedBUs] = useState<Record<string, boolean>>({})

  // Models & Validation
  const [availableModels, setAvailableModels] = useState<CandidateModelInfo[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [forecastHorizon, setForecastHorizon] = useState<number>(12)
  const [validationSplit, setValidationSplit] = useState<number>(0.75)

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
        const [dimRes, modelsRes] = await Promise.all([
          getDimensions(datasetId),
          getAvailableModels(),
        ])
        setDimensions(dimRes.dimensions)
        setBuHierarchy(dimRes.bu_entity_hierarchy || {})
        const accs = dimRes.accounts || []
        setAccountsList(accs)
        setRelationsList(dimRes.relations || [])

        // Default to PL01 (Sales Revenue) if present, or first account
        const defaultTarget =
          accs.find((a) => a.account.toUpperCase() === 'PL01')?.account ||
          (accs[0]?.account ?? null)
        setSelectedTargetAccount(defaultTarget)

        // Initialize other dimensions
        const initialOther: Record<string, string[]> = {}
        dimRes.dimensions.forEach((d) => {
          const lName = d.name.toLowerCase()
          if (!lName.includes('business unit') && !lName.includes('legal_entity') && !lName.includes('legal entity') && lName !== 'account' && lName !== 'description') {
            initialOther[d.name] = []
          }
        })
        setOtherFilters(initialOther)

        // Filter out Theta/AutoTheta
        const activeModels = modelsRes.models.filter(
          (m) => m.name !== 'Theta' && m.name !== 'AutoTheta'
        )
        setAvailableModels(activeModels)
        setSelectedModels(activeModels.filter((m) => m.is_available).map((m) => m.name))
      } catch (err: any) {
        setErrorMsg(err.message || 'Failed to load configuration parameters.')
      } finally {
        setIsLoading(false)
      }
    }

    loadConfig()
  }, [datasetId, transformData, navigate])

  // All Business Units from hierarchy or fallback
  const allBUs = useMemo(() => {
    if (Object.keys(buHierarchy).length > 0) {
      return Object.keys(buHierarchy).sort()
    }
    const buDim = dimensions.find((d) => d.name.toLowerCase().includes('business unit'))
    return buDim ? buDim.values : []
  }, [buHierarchy, dimensions])

  // Filtered BUs by search term
  const visibleBUs = useMemo(() => {
    if (!buSearch) return allBUs
    return allBUs.filter((bu) => bu.toLowerCase().includes(buSearch.toLowerCase()))
  }, [allBUs, buSearch])

  // Toggle a Business Unit
  const toggleBU = (bu: string) => {
    setSelectedBUs((prev) => {
      if (prev.includes(bu)) {
        const next = prev.filter((b) => b !== bu)
        const nextEntities = { ...buEntities }
        delete nextEntities[bu]
        setBuEntities(nextEntities)
        return next
      } else {
        // Expand and initialize with all entities for this BU
        setExpandedBUs((exp) => ({ ...exp, [bu]: true }))
        return [...prev, bu]
      }
    })
  }

  const selectAllBUs = () => {
    setSelectedBUs([...allBUs])
  }

  const clearAllBUs = () => {
    setSelectedBUs([])
    setBuEntities({})
  }

  // Toggle an SAC Legal Entity for a specific Business Unit
  const toggleEntityForBU = (bu: string, entity: string) => {
    setBuEntities((prev) => {
      const current = prev[bu] || []
      let updated: string[]

      if (current.includes(entity)) {
        updated = current.filter((e) => e !== entity)
      } else {
        updated = [...current, entity]
      }

      // If user selected all entities of this BU, keep as full list
      return { ...prev, [bu]: updated }
    })
  }

  const selectAllEntitiesForBU = (bu: string) => {
    const allForBU = buHierarchy[bu] || []
    setBuEntities((prev) => ({ ...prev, [bu]: [...allForBU] }))
  }

  const clearEntitiesForBU = (bu: string) => {
    setBuEntities((prev) => ({ ...prev, [bu]: [] }))
  }

  // Filter accounts dynamically based on selected BU and Legal Entities
  const availableAccounts = useMemo(() => {
    if (accountsList.length === 0) return []

    // If no BU selected, or no relations, show all accounts
    if (selectedBUs.length === 0 || relationsList.length === 0) {
      return accountsList
    }

    // Find accounts matching selected (BU, Entity) pairs
    const validAccSet = new Set<string>()
    relationsList.forEach((rel) => {
      const bu = rel.bu
      const ent = rel.entity
      const acc = rel.account
      if (!acc) return

      if (selectedBUs.includes(bu)) {
        const selectedEntsForThisBU = buEntities[bu] || []
        if (selectedEntsForThisBU.length === 0 || selectedEntsForThisBU.includes(ent)) {
          validAccSet.add(acc)
        }
      }
    })

    return accountsList.filter((a) => validAccSet.has(a.account))
  }, [accountsList, relationsList, selectedBUs, buEntities])

  // Filter accounts by search and category
  const visibleAccounts = useMemo(() => {
    let list = availableAccounts

    if (accountFilterType === 'pl') {
      list = list.filter((a) => a.account.toUpperCase().startsWith('PL'))
    } else if (accountFilterType === 'gl') {
      list = list.filter((a) => !a.account.toUpperCase().startsWith('PL'))
    }

    if (accountSearch.trim()) {
      const q = accountSearch.toLowerCase()
      list = list.filter(
        (a) =>
          a.account.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          a.label.toLowerCase().includes(q)
      )
    }

    return list
  }, [availableAccounts, accountFilterType, accountSearch])

  // Select single forecasting target account
  const selectTargetAccount = (accCode: string) => {
    setSelectedTargetAccount((prev) => (prev === accCode ? null : accCode))
  }

  // Toggle candidate models
  const toggleModel = (modelName: string) => {
    setSelectedModels((prev) =>
      prev.includes(modelName) ? prev.filter((m) => m !== modelName) : [...prev, modelName]
    )
  }

  const selectAllModels = () => {
    setSelectedModels(availableModels.filter((m) => m.is_available).map((m) => m.name))
  }

  const deselectAllModels = () => {
    setSelectedModels([])
  }

  const handleStartTraining = async () => {
    if (!datasetId) return
    if (!selectedTargetAccount) {
      setErrorMsg('Please select a Forecasting Target account to proceed.')
      return
    }
    if (selectedModels.length === 0) {
      setErrorMsg('Please select at least one candidate forecasting model.')
      return
    }

    setIsSubmitting(true)
    setErrorMsg(null)
    try {
      // Build clean bu_entities payload
      const payloadBUEntities: Record<string, string[]> = {}
      selectedBUs.forEach((bu) => {
        payloadBUEntities[bu] = buEntities[bu] || []
      })

      const res = await startTraining({
        dataset_id: datasetId,
        bu_entities: selectedBUs.length > 0 ? payloadBUEntities : undefined,
        accounts: [selectedTargetAccount],
        filters: otherFilters,
        forecast_horizon: forecastHorizon,
        validation_split: validationSplit,
        candidate_models: selectedModels,
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
        <p className="text-sm text-slate-500">Loading hierarchy and candidate models...</p>
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
            Hierarchical Business Unit & SAC Legal Entity filtering with 1-to-1 Account & Description mapping.
          </p>
        </div>

        <button
          onClick={handleStartTraining}
          disabled={isSubmitting || selectedModels.length === 0}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition flex items-center gap-2 shadow-xs disabled:opacity-50"
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

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 cols): Hierarchical Filters */}
        <div className="lg:col-span-2 space-y-6">
          {/* SECTION 1: Business Unit & Hierarchical SAC Legal Entity */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  1. Business Unit & Hierarchical Legal Entity
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={selectAllBUs}
                  className="text-blue-600 hover:underline font-medium"
                >
                  Select All
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={clearAllBUs}
                  className="text-slate-500 hover:underline"
                >
                  Clear All
                </button>
              </div>
            </div>

            {/* Business Unit Selection Chips */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700">
                  Select Business Unit(s):
                </label>
                <span className="text-[11px] text-slate-400">
                  {selectedBUs.length > 0 ? `${selectedBUs.length} selected` : 'All Included by default'}
                </span>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter business units (e.g. 7B, 7A01)..."
                  value={buSearch}
                  onChange={(e) => setBuSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pt-1 pr-1">
                {visibleBUs.map((bu) => {
                  const isChecked = selectedBUs.includes(bu)
                  return (
                    <button
                      key={bu}
                      type="button"
                      onClick={() => toggleBU(bu)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 border ${
                        isChecked
                          ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {isChecked && <Check className="w-3 h-3" />}
                      <span>{bu}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Hierarchical SAC Legal Entity Section */}
            <div className="pt-3 border-t border-slate-100 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Briefcase className="w-3.5 h-3.5 text-blue-500" />
                  <span>Available SAC Legal Entities for Selected Business Units:</span>
                </label>
                <span className="text-[11px] text-slate-400">
                  Option to choose separate SAC entity per Business Unit
                </span>
              </div>

              {selectedBUs.length === 0 ? (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500 text-center">
                  All Business Units and their respective Legal Entities are currently included. Select any Business Unit above to customize individual legal entities.
                </div>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {selectedBUs.map((bu) => {
                    const availableEntities = buHierarchy[bu] || []
                    const selectedForThisBU = buEntities[bu] || []
                    const isExpanded = expandedBUs[bu] ?? true

                    return (
                      <div
                        key={bu}
                        className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-2xs"
                      >
                        {/* BU Header Bar */}
                        <div
                          className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between cursor-pointer select-none"
                          onClick={() =>
                            setExpandedBUs((exp) => ({ ...exp, [bu]: !isExpanded }))
                          }
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-blue-600" />
                            <span className="text-xs font-bold text-slate-800">
                              Business Unit: {bu}
                            </span>
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-semibold">
                              {selectedForThisBU.length > 0
                                ? `${selectedForThisBU.length} / ${availableEntities.length} entities`
                                : `All ${availableEntities.length} entities`}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                selectAllEntitiesForBU(bu)
                              }}
                              className="text-[11px] text-blue-600 hover:underline font-medium"
                            >
                              All
                            </button>
                            <span className="text-slate-300">|</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                clearEntitiesForBU(bu)
                              }}
                              className="text-[11px] text-slate-500 hover:underline"
                            >
                              Reset
                            </button>
                            <button
                              type="button"
                              className="text-slate-400 hover:text-slate-600 ml-1"
                            >
                              {isExpanded ? (
                                <ChevronUp className="w-4 h-4" />
                              ) : (
                                <ChevronDown className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Legal Entities for this BU */}
                        {isExpanded && (
                          <div className="p-3 bg-white">
                            {availableEntities.length === 0 ? (
                              <span className="text-xs text-slate-400 italic">
                                No distinct legal entities found for {bu}.
                              </span>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {availableEntities.map((ent) => {
                                  // If none explicitly selected, all are active by default
                                  const isSelected =
                                    selectedForThisBU.length === 0 ||
                                    selectedForThisBU.includes(ent)
                                  return (
                                    <button
                                      key={ent}
                                      type="button"
                                      onClick={() => toggleEntityForBU(bu, ent)}
                                      className={`px-2.5 py-1 rounded text-xs font-medium transition flex items-center gap-1 border ${
                                        selectedForThisBU.includes(ent)
                                          ? 'bg-blue-600 text-white border-blue-600'
                                          : isSelected && selectedForThisBU.length === 0
                                          ? 'bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100'
                                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                                      }`}
                                    >
                                      <span>Entity {ent}</span>
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* SECTION 2: Forecasting Target (Single Selection) */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  2. Forecasting Target
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                  Single Select
                </span>
              </div>

              <div className="flex items-center gap-2 text-xs">
                {selectedTargetAccount ? (
                  <button
                    type="button"
                    onClick={() => setSelectedTargetAccount(null)}
                    className="text-slate-500 hover:text-slate-800 hover:underline text-[11px]"
                  >
                    Clear Target
                  </button>
                ) : (
                  <span className="text-amber-600 font-medium text-[11px]">
                    Select 1 Target
                  </span>
                )}
              </div>
            </div>

            {/* Filter controls */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search account code or description (e.g. Sales, PL01, Domestic)..."
                  value={accountSearch}
                  onChange={(e) => setAccountSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setAccountFilterType('all')}
                  className={`px-2.5 py-1 rounded-md transition ${
                    accountFilterType === 'all'
                      ? 'bg-white text-slate-800 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  All ({availableAccounts.length})
                </button>
                <button
                  type="button"
                  onClick={() => setAccountFilterType('pl')}
                  className={`px-2.5 py-1 rounded-md transition ${
                    accountFilterType === 'pl'
                      ? 'bg-white text-emerald-700 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  P&L Only ({availableAccounts.filter((a) => a.account.toUpperCase().startsWith('PL')).length})
                </button>
                <button
                  type="button"
                  onClick={() => setAccountFilterType('gl')}
                  className={`px-2.5 py-1 rounded-md transition ${
                    accountFilterType === 'gl'
                      ? 'bg-white text-slate-800 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  G/L Accounts
                </button>
              </div>
            </div>

            {/* Account Selection Grid (Single Radio Selection) */}
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {visibleAccounts.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-400 italic">
                  No accounts found matching your search and entity selection.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                  {visibleAccounts.map((acc) => {
                    const isSelected = selectedTargetAccount === acc.account
                    const isPL = acc.account.toUpperCase().startsWith('PL')
                    return (
                      <div
                        key={acc.account}
                        onClick={() => selectTargetAccount(acc.account)}
                        className={`p-2.5 rounded-lg text-xs cursor-pointer transition flex items-center justify-between border ${
                          isSelected
                            ? 'bg-emerald-50 border-emerald-500 ring-1 ring-emerald-500 text-slate-900 font-semibold shadow-xs'
                            : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {isSelected ? (
                            <CircleDot className="w-4 h-4 text-emerald-600 shrink-0" />
                          ) : (
                            <Circle className="w-4 h-4 text-slate-300 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <span className="block truncate font-medium">
                              {acc.description || acc.account}
                            </span>
                            <span className="text-[10px] text-slate-400 block font-mono">
                              Code: {acc.account}
                            </span>
                          </div>
                        </div>

                        {isPL && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ml-1 ${
                              isSelected
                                ? 'bg-emerald-200 text-emerald-900'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            P&L
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Footer with active target and double-counting warning */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] text-slate-500 pt-1.5 border-t border-slate-100">
              <span className="flex items-center gap-1.5 font-medium text-slate-700">
                <Target className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                {selectedTargetAccount ? (
                  <span>
                    Selected Target:{' '}
                    <span className="font-bold text-emerald-700">
                      {accountsList.find((a) => a.account === selectedTargetAccount)?.label || selectedTargetAccount}
                    </span>
                  </span>
                ) : (
                  <span className="text-amber-600 font-medium">
                    Please select one forecasting target
                  </span>
                )}
              </span>
              <span className="text-slate-400 text-[10px] italic">
                Only one target is selected at a time to prevent double-counting summary hierarchies.
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Parameters & Models */}
        <div className="space-y-6">
          {/* Horizon & Validation Settings */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-4">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-slate-100">
              <Calendar className="w-4 h-4 text-blue-600" />
              Horizon & Validation
            </span>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Forecast Horizon (Future Months)
              </label>
              <div className="grid grid-cols-4 gap-2">
                {[3, 6, 12, 24].map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setForecastHorizon(h)}
                    className={`py-1.5 rounded-lg text-xs font-medium border transition ${
                      forecastHorizon === h
                        ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {h} mo
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                <span>Validation Split</span>
                <span className="text-blue-600">
                  {Math.round(validationSplit * 100)}% Train / {Math.round((1 - validationSplit) * 100)}% Val
                </span>
              </div>
              <input
                type="range"
                min="0.5"
                max="0.85"
                step="0.05"
                value={validationSplit}
                onChange={(e) => setValidationSplit(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <span className="text-[10px] text-slate-400 block mt-1">
                Chronological evaluation without data leakage.
              </span>
            </div>
          </div>

          {/* Candidate Models */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Cpu className="w-4 h-4 text-blue-600" />
                Candidate Models ({selectedModels.length})
              </span>
              <div className="flex gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={selectAllModels}
                  className="text-blue-600 hover:underline"
                >
                  All
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={deselectAllModels}
                  className="text-slate-500 hover:underline"
                >
                  None
                </button>
              </div>
            </div>

            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {availableModels.map((m) => {
                const isSelected = selectedModels.includes(m.name)
                return (
                  <div
                    key={m.name}
                    onClick={() => m.is_available && toggleModel(m.name)}
                    className={`flex items-center justify-between p-2 rounded-lg text-xs cursor-pointer transition border ${
                      !m.is_available
                        ? 'opacity-40 bg-slate-50 border-slate-100 cursor-not-allowed'
                        : isSelected
                        ? 'bg-blue-50/60 border-blue-200 text-slate-900 font-medium'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-blue-600" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-300" />
                      )}
                      <span>{m.name}</span>
                    </div>

                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                      {m.family}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
