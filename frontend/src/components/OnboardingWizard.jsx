import React, { useState } from 'react'
import api from '../utils/api'
import clsx from 'clsx'

const STEPS = [
  {
    title: 'Welcome',
    content: 'Welcome to the HR Salary System! This platform processes payroll in 7 stages, from biometric import to salary generation. This quick tour will show you the basics.'
  },
  {
    title: 'Pipeline Overview',
    content: 'The payroll pipeline has 7 stages: Import → Miss Punches → Shift Check → Night Shift → Corrections → Day Calculation → Salary Computation. Each stage must complete before the next.',
    visual: ['1. Import', '2. Miss Punch', '3. Shift Check', '4. Night Shift', '5. Corrections', '6. Day Calc', '7. Salary']
  },
  {
    title: 'Getting Started',
    content: 'Start each month by uploading the EESL biometric .xls file from the Import page. The system parses attendance data for all employees automatically.'
  },
  {
    title: 'Processing Stages',
    content: 'Work through miss punches, shift verification, night shift pairing, and corrections. The pipeline indicator at the top tracks your progress through each stage.'
  },
  {
    title: 'Salary & Reports',
    content: 'After processing attendance, compute salaries with automatic PF/ESI/PT deductions. Generate payslips, PF ECR files, ESI returns, and bank NEFT files from the Reports page.'
  },
  {
    title: 'Quick Tips',
    content: 'Use the company filter at the top to switch between companies. The Finance Audit page helps verify computations before finalizing. Settings (admin only) controls shift timings, holidays, and policy rates.'
  },
  {
    title: "You're All Set!",
    content: "Click 'Finish' to start using the system. You can replay this tour anytime from the Settings page.",
    isFinal: true
  }
]

export default function OnboardingWizard({ onComplete }) {
  const [step, setStep] = useState(0)
  const current = STEPS[step]

  const handleFinish = async () => {
    try { await api.patch('/auth/onboarding-complete') } catch {}
    onComplete()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-scale-in">
        {/* Progress */}
        <div className="h-1 bg-slate-100">
          <div className="h-full bg-blue-600 transition-all duration-300" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>

        <div className="p-8">
          {/* Step indicator */}
          <div className="text-xs text-slate-400 mb-2">Step {step + 1} of {STEPS.length}</div>

          <h2 className="text-xl font-bold text-slate-800 mb-3">{current.title}</h2>
          <p className="text-sm text-slate-600 leading-relaxed">{current.content}</p>

          {/* Visual pipeline */}
          {current.visual && (
            <div className="mt-4 flex flex-wrap gap-2">
              {current.visual.map((s, i) => (
                <span key={i} className="text-xs bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full border border-blue-200 font-medium">{s}</span>
              ))}
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-8">
            <button
              onClick={() => setStep(s => s - 1)}
              disabled={step === 0}
              className={clsx('text-sm font-medium px-4 py-2 rounded-lg transition-colors',
                step === 0 ? 'text-slate-300 cursor-not-allowed' : 'text-slate-600 hover:bg-slate-100')}
            >
              Back
            </button>

            <div className="flex gap-1.5">
              {STEPS.map((_, i) => (
                <div key={i} className={clsx('w-2 h-2 rounded-full transition-colors', i === step ? 'bg-blue-600' : i < step ? 'bg-blue-300' : 'bg-slate-200')} />
              ))}
            </div>

            {current.isFinal ? (
              <button onClick={handleFinish} className="btn-primary text-sm px-6">
                Finish Setup
              </button>
            ) : (
              <button onClick={() => setStep(s => s + 1)} className="btn-primary text-sm px-6">
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
