import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  Layers,
  Calendar,
  Eye,
  Loader2,
} from 'lucide-react'
import { inspectDataset, transformDataset, uploadFile } from '../api/client'
import { useSession } from '../contexts/SessionContext'
import type { HeaderDetectionResult } from '../types'

export const UploadPage: React.FC = () => {
  const navigate = useNavigate()
  const {
    datasetId,
    setDatasetId,
    filename,
    setFilename,
    activeSheet,
    setActiveSheet,
    sheetNames,
    setSheetNames,
    transformData,
    setTransformData,
  } = useSession()

  const [isUploading, setIsUploading] = useState(false)
  const [isInspecting, setIsInspecting] = useState(false)
  const [isTransforming, setIsTransforming] = useState(false)
  const [detection, setDetection] = useState<HeaderDetectionResult | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [previewTab, setPreviewTab] = useState<'raw' | 'transformed'>('raw')

  // Handle file drop or selection
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setErrorMsg(null)
    setIsUploading(true)
    try {
      const res = await uploadFile(file)
      setDatasetId(res.dataset_id)
      setFilename(res.filename)
      setSheetNames(res.sheet_names)
      const defaultSheet = res.sheet_names[0]
      setActiveSheet(defaultSheet)

      // Automatically inspect the default sheet
      await runInspect(res.dataset_id, defaultSheet)
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || err.message || 'File upload failed.')
    } finally {
      setIsUploading(false)
    }
  }

  const runInspect = async (id: string, sheet: string) => {
    setIsInspecting(true)
    setErrorMsg(null)
    try {
      const det = await inspectDataset(id, sheet)
      setDetection(det)
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || err.message || 'Failed to inspect worksheet.')
    } finally {
      setIsInspecting(false)
    }
  }

  const handleSheetChange = async (sheet: string) => {
    setActiveSheet(sheet)
    if (datasetId) {
      await runInspect(datasetId, sheet)
    }
  }

  const handleTransform = async () => {
    if (!datasetId || !activeSheet) return
    setIsTransforming(true)
    setErrorMsg(null)
    try {
      const res = await transformDataset(datasetId, activeSheet)
      setTransformData(res)
      setPreviewTab('transformed')
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || err.message || 'Transformation failed.')
    } finally {
      setIsTransforming(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Data Upload & Layout Inspection</h2>
        <p className="text-xs text-slate-500 mt-1">
          Upload your Excel workbook. The intelligent header detection engine handles multi-row and split-header architectures.
        </p>
      </div>

      {errorMsg && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Error</p>
            <p className="text-xs mt-0.5">{errorMsg}</p>
          </div>
        </div>
      )}

      {/* Upload Dropzone */}
      <div className="bg-white border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:border-blue-500 transition relative">
        <input
          type="file"
          accept=".xlsx, .xls, .xlsm"
          onChange={handleFileUpload}
          disabled={isUploading}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
        <div className="flex flex-col items-center justify-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
            {isUploading ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <UploadCloud className="w-6 h-6" />
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-700">
              {isUploading ? 'Uploading and parsing workbook...' : 'Click or drag & drop Excel workbook'}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Supports .xlsx, .xls (e.g. SAP Analytics Cloud Story workbooks)
            </p>
          </div>
          {filename && (
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md text-xs font-medium">
              <FileSpreadsheet className="w-4 h-4" />
              <span>Loaded: {filename}</span>
            </div>
          )}
        </div>
      </div>

      {/* Sheet selection & detection summary */}
      {sheetNames.length > 0 && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Worksheet:
              </label>
              <select
                value={activeSheet || ''}
                onChange={(e) => handleSheetChange(e.target.value)}
                disabled={isInspecting}
                className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {sheetNames.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleTransform}
                disabled={isTransforming || isInspecting}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition flex items-center gap-2 shadow-xs disabled:opacity-50"
              >
                {isTransforming ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Transforming...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    <span>Confirm & Transform</span>
                  </>
                )}
              </button>

              {transformData && (
                <button
                  onClick={() => navigate('/configure')}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition flex items-center gap-2 shadow-xs"
                >
                  <span>Configure Forecast</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Header Detection Diagnostic Card */}
          {detection && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-blue-600" />
                  Header Detection Diagnosis
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800">
                  Confidence: {Math.round(detection.confidence * 100)}%
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                <div className="bg-white p-3 rounded border border-slate-200">
                  <span className="text-slate-400 block">Header Depth</span>
                  <span className="font-semibold text-slate-800 text-sm">
                    {detection.header_depth} row{detection.header_depth > 1 ? 's' : ''}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    (Data starts row {detection.header_depth + 1})
                  </span>
                </div>

                <div className="bg-white p-3 rounded border border-slate-200">
                  <span className="text-slate-400 block">Dimensions Found</span>
                  <span className="font-semibold text-slate-800 text-sm">
                    {detection.dimension_columns.length} columns
                  </span>
                  <span className="text-[10px] text-slate-500 truncate block mt-0.5">
                    {detection.dimension_columns.map((c) => c.name).join(', ')}
                  </span>
                </div>

                <div className="bg-white p-3 rounded border border-slate-200">
                  <span className="text-slate-400 block">Time Periods</span>
                  <span className="font-semibold text-slate-800 text-sm">
                    {detection.period_columns.length} months
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    Frequency: {detection.frequency}
                  </span>
                </div>

                <div className="bg-white p-3 rounded border border-slate-200">
                  <span className="text-slate-400 block">Date Range</span>
                  <span className="font-semibold text-slate-800 text-xs flex items-center gap-1 mt-1">
                    <Calendar className="w-3 h-3 text-slate-400" />
                    {detection.date_range_start ? detection.date_range_start.slice(0, 7) : 'N/A'} →{' '}
                    {detection.date_range_end ? detection.date_range_end.slice(0, 7) : 'N/A'}
                  </span>
                </div>
              </div>

              {detection.warnings.length > 0 && (
                <div className="space-y-1 pt-1">
                  {detection.warnings.map((w, idx) => (
                    <p key={idx} className="text-[11px] text-amber-700 flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      <span>{w}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Preview Section */}
      {(detection || transformData) && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
          <div className="px-6 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-slate-500" />
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Data Preview
              </span>
            </div>

            <div className="flex items-center bg-slate-200/70 p-0.5 rounded-lg text-xs font-medium">
              <button
                onClick={() => setPreviewTab('raw')}
                className={`px-3 py-1 rounded-md transition ${
                  previewTab === 'raw' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Raw Sheet (First 8 Rows)
              </button>
              {transformData && (
                <button
                  onClick={() => setPreviewTab('transformed')}
                  className={`px-3 py-1 rounded-md transition ${
                    previewTab === 'transformed' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Transformed Long Format ({transformData.row_count} rows)
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto max-h-96">
            {previewTab === 'raw' && detection && (
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-slate-100 text-slate-600 font-semibold sticky top-0 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 border-r border-slate-200 w-12 text-center text-slate-400">#</th>
                    {Object.keys(detection.raw_preview[0] || {}).map((colKey) => (
                      <th key={colKey} className="px-3 py-2 border-r border-slate-200 whitespace-nowrap">
                        Col {colKey}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {detection.raw_preview.map((row, idx) => (
                    <tr
                      key={idx}
                      className={
                        idx < detection.header_depth
                          ? 'bg-amber-50/60 font-semibold text-slate-800'
                          : 'hover:bg-slate-50'
                      }
                    >
                      <td className="px-3 py-1.5 border-r border-slate-200 text-center text-slate-400">
                        {idx}
                      </td>
                      {Object.values(row).map((val: any, cIdx) => (
                        <td key={cIdx} className="px-3 py-1.5 border-r border-slate-200 whitespace-nowrap">
                          {val === null || val === undefined ? (
                            <span className="text-slate-300 italic">null</span>
                          ) : (
                            String(val)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {previewTab === 'transformed' && transformData && (
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-slate-100 text-slate-600 font-semibold sticky top-0 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 border-r border-slate-200">Date</th>
                    {transformData.dimension_columns.map((d) => (
                      <th key={d} className="px-3 py-2 border-r border-slate-200">
                        {d}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right">Value (Target)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {transformData.preview.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="px-3 py-1.5 border-r border-slate-200 font-sans font-medium text-slate-700">
                        {row.date ? String(row.date).slice(0, 10) : ''}
                      </td>
                      {transformData.dimension_columns.map((d) => (
                        <td key={d} className="px-3 py-1.5 border-r border-slate-200">
                          {row[d] !== null && row[d] !== undefined ? String(row[d]) : '-'}
                        </td>
                      ))}
                      <td className="px-3 py-1.5 text-right font-semibold text-blue-600">
                        {row.value !== null && row.value !== undefined
                          ? Number(row.value).toLocaleString()
                          : <span className="text-slate-300 italic">null</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

