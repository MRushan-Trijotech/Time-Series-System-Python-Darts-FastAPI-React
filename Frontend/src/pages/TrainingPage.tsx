import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PlayCircle,
  CheckCircle2,
  AlertOctagon,
  Clock,
  Cpu,
  Terminal,
  ArrowRight,
  RotateCcw,
  BarChart2,
} from 'lucide-react'
import { getJobStatus } from '../api/client'
import { useSession } from '../contexts/SessionContext'
import type { JobStatus } from '../types'

export const TrainingPage: React.FC = () => {
  const navigate = useNavigate()
  const { jobId, setJobCompleted } = useSession()

  const [jobState, setJobState] = useState<JobStatus | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const logContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!jobId) {
      navigate('/configure')
      return
    }

    const pollStatus = async () => {
      try {
        const data = await getJobStatus(jobId)
        setJobState(data)

        if (data.status === 'completed') {
          if (intervalRef.current) clearInterval(intervalRef.current)
          setJobCompleted(true)
        } else if (data.status === 'failed') {
          if (intervalRef.current) clearInterval(intervalRef.current)
          setErrorMsg(data.error || 'Training job failed.')
        }
      } catch (err: any) {
        setErrorMsg(err.message || 'Error checking training status.')
        if (intervalRef.current) clearInterval(intervalRef.current)
      }
    }

    pollStatus()
    intervalRef.current = setInterval(pollStatus, 1500)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [jobId, navigate, setJobCompleted])

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [jobState?.log_tail])

  const progressPercent = jobState
    ? Math.round((jobState.progress.completed / Math.max(jobState.progress.total, 1)) * 100)
    : 0

  const isCompleted = jobState?.status === 'completed'
  const isRunning = jobState?.status === 'running'

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Model Tournament & Training Execution</h2>
        <p className="text-xs text-slate-500 mt-1">
          Evaluating candidate models chronologically, calculating finite MAPE scores, and retraining the winning model on all history.
        </p>
      </div>

      {errorMsg ? (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-rose-800 space-y-4">
          <div className="flex items-center gap-3">
            <AlertOctagon className="w-6 h-6 text-rose-600" />
            <h3 className="font-bold text-base">Tournament Execution Failed</h3>
          </div>
          <p className="text-xs bg-white p-3 rounded border border-rose-200 font-mono text-rose-700">
            {errorMsg}
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => navigate('/configure')}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold flex items-center gap-2 transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Modify Configuration</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-6">
          {/* Status Header */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  isCompleted
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-blue-50 text-blue-600 animate-pulse'
                }`}
              >
                {isCompleted ? (
                  <CheckCircle2 className="w-5 h-5" />
                ) : (
                  <PlayCircle className="w-5 h-5" />
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-800">
                  {isCompleted
                    ? '✅ Tournament Completed!'
                    : isRunning
                    ? 'Evaluating Candidates...'
                    : 'Initializing...'}
                </h3>
                <p className="text-xs text-slate-500 capitalize">
                  Stage: {jobState?.stage.replace(/_/g, ' ') || 'initializing'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs text-slate-500">
              <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>Elapsed: {jobState?.elapsed_seconds ?? 0}s</span>
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-semibold">
              <span className="text-slate-700">Tournament Progress</span>
              <span className={isCompleted ? 'text-emerald-600' : 'text-blue-600'}>
                {isCompleted ? '100%' : `${progressPercent}%`}
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  isCompleted ? 'bg-emerald-500' : 'bg-blue-600'
                }`}
                style={{ width: isCompleted ? '100%' : `${Math.min(progressPercent, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>
                Completed: {jobState?.progress.completed ?? 0} / {jobState?.progress.total ?? 1} evaluations
              </span>
              {jobState?.progress.current_model && !isCompleted && (
                <span className="flex items-center gap-1 font-medium text-slate-600">
                  <Cpu className="w-3 h-3 text-blue-500" />
                  Active Model: {jobState.progress.current_model}
                </span>
              )}
            </div>
          </div>

          {/* Completion Action Buttons — only shown when training is done */}
          {isCompleted && (
            <div className="pt-2 border-t border-slate-100">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <p className="text-sm font-semibold text-emerald-800">
                    Model tournament complete! Your forecast is ready.
                  </p>
                </div>
                <p className="text-xs text-emerald-700">
                  The best model was selected by lowest validation MAPE. View the reports below.
                </p>
                <div className="flex items-center gap-3 pt-1">
                  <button
                    onClick={() => navigate('/report/forecast')}
                    className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition shadow-xs"
                  >
                    <BarChart2 className="w-4 h-4" />
                    <span>View Forecast Report</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => navigate('/report/explanation')}
                    className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-medium transition"
                  >
                    <span>View Explanation Report</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => navigate('/configure')}
                    className="ml-auto flex items-center gap-1.5 px-3 py-2 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reconfigure</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Real-time Log Stream */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-700 uppercase tracking-wider">
              <Terminal className="w-3.5 h-3.5 text-slate-500" />
              <span>Real-Time Evaluation Log</span>
            </div>

            <div
              ref={logContainerRef}
              className="bg-slate-900 rounded-lg p-4 font-mono text-[11px] text-emerald-400 max-h-64 overflow-y-auto space-y-1"
            >
              {(jobState?.log_tail || []).map((line, idx) => (
                <div key={idx} className="flex gap-2">
                  <span className="text-slate-600 select-none">&gt;</span>
                  <span className="text-slate-200">{line}</span>
                </div>
              ))}
              {isRunning && (
                <div className="flex items-center gap-2 text-blue-400 animate-pulse pt-1">
                  <span className="text-slate-600 select-none">&gt;</span>
                  <span>Processing...</span>
                </div>
              )}
              {isCompleted && (
                <div className="flex items-center gap-2 text-emerald-400 pt-1 font-semibold">
                  <span className="text-slate-600 select-none">&gt;</span>
                  <span>✓ Training completed successfully. Click "View Reports" to proceed.</span>
                </div>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  )
}
