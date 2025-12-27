import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Loader2, FileCode, Play, Sparkles, AlertCircle } from 'lucide-react';
import type { SubmissionStepType } from '@/types/match';

interface SubmissionProgressModalProps {
  isOpen: boolean;
  currentStep: SubmissionStepType | null;
}

interface StepInfo {
  id: SubmissionStepType;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

const steps: StepInfo[] = [
  {
    id: 'compiling',
    label: 'Compiling Code',
    description: 'Sending your solution to the judge...',
    icon: FileCode,
  },
  {
    id: 'running_tests',
    label: 'Running Tests',
    description: 'Executing test cases against your code...',
    icon: Play,
  },
  {
    id: 'analyzing_complexity',
    label: 'Analyzing Complexity',
    description: 'Calculating time & space complexity...',
    icon: Sparkles,
  },
];

export function SubmissionProgressModal({ isOpen, currentStep }: SubmissionProgressModalProps) {
  if (!isOpen) return null;

  // Default to first step if no step received yet
  const effectiveStep = currentStep || 'compiling';
  const currentStepIndex = steps.findIndex(s => s.id === effectiveStep);

  const getStepState = (stepIndex: number): 'completed' | 'active' | 'pending' => {
    if (stepIndex < currentStepIndex) return 'completed';
    if (stepIndex === currentStepIndex) return 'active';
    return 'pending';
  };

  return (
    <div 
      className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center"
      style={{ zIndex: 9999, pointerEvents: 'all' }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ type: "spring", duration: 0.5, bounce: 0.3 }}
        className="bg-white rounded-2xl shadow-2xl w-[500px] overflow-hidden border border-white/20"
        style={{ position: 'relative', zIndex: 10000 }}
      >
        {/* Header with decorative background */}
        <div className="relative px-8 py-6 bg-slate-50 border-b border-slate-100 overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl -mr-32 -mt-32 pointer-events-none"></div>
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-cyan-500/5 rounded-full blur-3xl -ml-32 -mb-32 pointer-events-none"></div>
          
          <div className="relative z-10">
            <h2 className="text-2xl font-bold text-slate-800">Processing Submission</h2>
            <p className="text-slate-500 mt-1">Please wait while we evaluate your solution.</p>
          </div>
        </div>

        {/* Steps Container */}
        <div className="p-8 space-y-6 bg-white">
          {steps.map((step, index) => {
            const state = getStepState(index);
            const Icon = step.icon;
            const isLast = index === steps.length - 1;

            return (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.15 }}
                className="flex items-start gap-5 relative"
              >
                {/* Connector Line */}
                {!isLast && (
                  <div className="absolute left-6 top-12 bottom-0 -mb-6 w-0.5 bg-slate-100">
                    <motion.div
                      className="w-full bg-blue-500 origin-top"
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: state === 'completed' ? 1 : 0 }}
                      transition={{ duration: 0.4, ease: "easeInOut" }}
                    />
                  </div>
                )}

                {/* Step Icon Bubble */}
                <div className="relative z-10 flex-shrink-0">
                  <motion.div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors duration-500 ${
                      state === 'completed'
                        ? 'bg-green-100 text-green-600'
                        : state === 'active'
                        ? 'bg-blue-100 text-blue-600 shadow-lg shadow-blue-500/20'
                        : 'bg-slate-50 text-slate-300'
                    }`}
                    animate={{
                      scale: state === 'active' ? 1.1 : 1,
                    }}
                  >
                    <AnimatePresence mode="wait">
                      {state === 'completed' ? (
                        <motion.div
                          key="check"
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: "spring", stiffness: 300, damping: 20 }}
                        >
                          <Check className="w-6 h-6" strokeWidth={3} />
                        </motion.div>
                      ) : state === 'active' ? (
                        <motion.div
                          key="loader"
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          exit={{ scale: 0 }}
                        >
                          <Loader2 className="w-6 h-6 animate-spin" />
                        </motion.div>
                      ) : (
                        <motion.div
                          key="icon"
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                        >
                          <Icon className="w-5 h-5" />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                </div>

                {/* Step Text Content */}
                <div className="flex-1 pt-2">
                  <div className="flex items-center justify-between">
                    <h3
                      className={`font-semibold text-lg transition-colors duration-300 ${
                        state === 'completed'
                          ? 'text-green-700'
                          : state === 'active'
                          ? 'text-blue-600'
                          : 'text-slate-400'
                      }`}
                    >
                      {step.label}
                    </h3>
                    {state === 'active' && (
                      <span className="text-xs font-bold text-blue-500 bg-blue-50 px-2 py-1 rounded-full animate-pulse">
                        IN PROGRESS
                      </span>
                    )}
                  </div>
                  
                  <p
                    className={`text-sm mt-1 transition-colors duration-300 ${
                      state === 'active' ? 'text-slate-600' : 'text-slate-400'
                    }`}
                  >
                    {step.description}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-8 py-4 border-t border-slate-100 flex items-center justify-center gap-2">
          <AlertCircle className="w-4 h-4 text-slate-400" />
          <p className="text-xs font-medium text-slate-500">
            Keep this window open until submission completes
          </p>
        </div>
      </motion.div>
    </div>
  );
}
