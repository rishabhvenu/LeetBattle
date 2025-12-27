import React from 'react';
import Editor from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { motion } from "framer-motion";
import type { FormattedSubmission } from '@/types/match';

interface SubmissionModalProps {
  submission: FormattedSubmission;
  isOpen: boolean;
  onClose: () => void;
  fallbackLanguage?: string;
}

export function SubmissionModal({
  submission,
  isOpen,
  onClose,
  fallbackLanguage = 'javascript',
}: SubmissionModalProps) {
  if (!isOpen) return null;

  const getStatusColor = () => {
    if (submission.status === 'Accepted') return 'text-green-600';
    if (submission.errorType === 'wrong') return 'text-red-600';
    if (submission.errorType === 'compile') return 'text-orange-600';
    if (submission.errorType === 'runtime') return 'text-purple-600';
    if (submission.errorType === 'timeout') return 'text-yellow-600';
    if (submission.errorType === 'memory') return 'text-indigo-600';
    if (submission.errorType === 'complexity') return 'text-amber-600';
    if (submission.errorType === 'system') return 'text-gray-600';
    return 'text-black';
  };

  const hasNestedLoops = (code: string) => {
    // Simple heuristic: check for nested indentation of loops
    // or just multiple loop keywords.
    // For now, let's just use a simple regex for visual indication purposes
    const loopPattern = /(for|while|do)\s*\(/g;
    const matches = code.match(loopPattern);
    return matches && matches.length > 1;
  };

  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div 
        className="bg-white w-[900px] h-[80vh] overflow-hidden rounded-lg shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-6 border-b border-gray-200 flex items-start justify-between flex-shrink-0">
          <div>
            <h1 className={`text-2xl font-bold mb-2 ${getStatusColor()}`}>
              {submission.status}
            </h1>
            <p className="text-gray-600">
              {submission.passedTests}/{submission.totalTests} testcases passed
            </p>
            <p className="text-sm text-gray-500 mt-1">
              Submitted {submission.date}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Performance Metrics - Only for Accepted submissions */}
        {submission.status === 'Accepted' && (
          <div className="p-6 bg-gray-50 border-b border-gray-200 flex-shrink-0">
            <div className="grid grid-cols-4 gap-6">
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">Runtime</h3>
                <div className="text-2xl font-bold text-black">
                  {submission.runtime === '—' ? '0 ms' : submission.runtime}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">Memory</h3>
                <div className="text-2xl font-bold text-black">
                  {submission.memory === '—' ? '19.12 MB' : submission.memory}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">Time Complexity</h3>
                <div className="text-2xl font-bold text-black">
                  {submission.timeComplexity}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">Space Complexity</h3>
                <div className="text-2xl font-bold text-black">
                  {submission.spaceComplexity}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Compile Error Section */}
          {submission.errorType === 'compile' && submission.compileError && (
            <div className="p-6 bg-orange-50 border-b border-orange-200">
              <h3 className="text-lg font-semibold text-orange-700 mb-4">Compile Error</h3>
              <div className="bg-orange-100 rounded-lg p-4 border border-orange-300">
                <pre className="text-sm text-orange-800 font-mono whitespace-pre-wrap">{submission.compileError}</pre>
              </div>
            </div>
          )}

          {/* Runtime Error Section */}
          {submission.errorType === 'runtime' && submission.runtimeError && (
            <div className="p-6 bg-purple-50 border-b border-purple-200">
              <h3 className="text-lg font-semibold text-purple-700 mb-4">Runtime Error</h3>
              <div className="space-y-4">
                {submission.failedTestCase?.input && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Input</h4>
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <code className="text-sm text-black font-mono">{submission.failedTestCase.input}</code>
                    </div>
                  </div>
                )}
                <div>
                  <div className="bg-purple-100 rounded-lg p-4 border border-purple-300">
                    <pre className="text-sm text-purple-800 font-mono whitespace-pre-wrap">{submission.runtimeError}</pre>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Time Limit Exceeded Section */}
          {submission.errorType === 'timeout' && submission.timeoutError && (
            <div className="p-6 bg-yellow-50 border-b border-yellow-200">
              <h3 className="text-lg font-semibold text-yellow-700 mb-4">Time Limit Exceeded</h3>
              <div className="bg-yellow-100 rounded-lg p-4 border border-yellow-300">
                <p className="text-sm text-yellow-800">Your solution took too long to execute. Try optimizing your algorithm.</p>
              </div>
            </div>
          )}

          {/* Memory Limit Exceeded Section */}
          {submission.errorType === 'memory' && submission.memoryError && (
            <div className="p-6 bg-indigo-50 border-b border-indigo-200">
              <h3 className="text-lg font-semibold text-indigo-700 mb-4">Memory Limit Exceeded</h3>
              <div className="bg-indigo-100 rounded-lg p-4 border border-indigo-300">
                <p className="text-sm text-indigo-800">Your solution used too much memory. Try optimizing your space usage.</p>
              </div>
            </div>
          )}

          {/* System Error Section */}
          {submission.errorType === 'system' && submission.systemError && (
            <div className="p-6 bg-gray-50 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-700 mb-4">System Error</h3>
              <div className="bg-gray-100 rounded-lg p-4 border border-gray-300">
                <pre className="text-sm text-gray-800 font-mono whitespace-pre-wrap">{submission.systemError}</pre>
              </div>
            </div>
          )}

          {/* Time Complexity Failed Section */}
          {submission.errorType === 'complexity' && submission.complexityError && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-8 bg-amber-50/50 flex flex-col items-center justify-center text-center space-y-8 min-h-[400px]"
            >
              <div className="space-y-2">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner"
                >
                  <span className="text-4xl">⚠️</span>
                </motion.div>
                <h3 className="text-3xl font-bold text-amber-900">
                  Time Complexity Failed
                </h3>
                <p className="text-lg text-amber-800/80 max-w-md mx-auto">
                  {submission.complexityError}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-8 w-full max-w-lg">
                 <motion.div 
                    initial={{ x: -20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    className="bg-white p-6 rounded-2xl border-2 border-amber-100 shadow-sm flex flex-col items-center"
                 >
                    <span className="text-sm font-bold text-amber-500 uppercase tracking-wider mb-2">Target</span>
                    <span className="text-3xl font-mono font-bold text-gray-800">
                      {submission.expectedComplexity || 'O(N)'}
                    </span>
                 </motion.div>

                 <motion.div 
                    initial={{ x: 20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    className="bg-amber-100 p-6 rounded-2xl border-2 border-amber-200 shadow-sm flex flex-col items-center"
                 >
                    <span className="text-sm font-bold text-amber-600 uppercase tracking-wider mb-2">Your Solution</span>
                    <span className="text-3xl font-mono font-bold text-amber-900">
                      {submission.timeComplexity || 'O(N²)'}
                    </span>
                 </motion.div>
              </div>
            </motion.div>
          )}

          {/* Failed Test Case Section (Wrong Answer) */}
          {submission.errorType === 'wrong' && submission.failedTestCase && (
            <div className="p-6 bg-red-50 border-b border-red-200">
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Input</h4>
                  <div className="bg-white rounded-lg p-3 border border-gray-200">
                    <code className="text-sm text-black font-mono">{submission.failedTestCase.input}</code>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Expected Output</h4>
                  <div className="bg-green-50 rounded-lg p-3 border border-green-200">
                    <code className="text-sm text-green-700 font-mono">{submission.failedTestCase.expected}</code>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Your Output</h4>
                  <div className="bg-red-50 rounded-lg p-3 border border-red-200">
                    <code className="text-sm text-red-700 font-mono">{submission.failedTestCase.actual}</code>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Code Section */}
          {submission.errorType !== 'complexity' && (
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-black">
                  Code | {submission.language || fallbackLanguage}
                </h3>
              </div>
              
              <div className="bg-white rounded-lg overflow-hidden border border-gray-200">
                <div style={{ position: 'relative', pointerEvents: 'none' }}>
                  <Editor
                    height="300px"
                    language={(submission.language?.toLowerCase() || fallbackLanguage)}
                    value={submission.code}
                    theme="vs"
                    options={{
                      readOnly: true,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      cursorBlinking: "solid" as const,
                      cursorStyle: "line" as const,
                      cursorWidth: 0,
                      selectOnLineNumbers: false,
                      selectionHighlight: false,
                      occurrencesHighlight: "off" as const,
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

