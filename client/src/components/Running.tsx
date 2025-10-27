"use client";
import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Check, AlertCircle, Timer, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface TestCaseResult {
  input: string;
  expectedOutput: string;
  userOutput: string | null;
  status: number;
  error?: string | null;
}

interface RunningProps {
  isVisible: boolean;
  setRunningPage: (visible: boolean) => void;
  isLoading: boolean;
  testCaseResults: TestCaseResult[];
}

export default function Running({
  isVisible,
  setRunningPage,
  isLoading,
  testCaseResults,
}: RunningProps) {
  const [selectedCase, setSelectedCase] = useState(1);

  const checkStatus = (caseIndex: number): boolean => {
    return testCaseResults[caseIndex]?.status === 3;
  };

  useEffect(() => {
    if (isVisible) {
      setSelectedCase(1);
    }
  }, [isVisible]);

  return (
    <div
      className={`fixed inset-x-0 bottom-0 h-[45%] bg-blue-50 border-t border-blue-200 transform transition-all duration-300 ease-in-out ${
        isVisible ? "translate-y-0" : "translate-y-full"
      }`}
      style={{ zIndex: 40 }}
      onClick={() => setRunningPage(false)}
    >
      <div 
        className="flex flex-col h-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative px-6 py-4 border-b border-blue-200 bg-white/90">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-black">
              Test Cases
            </h2>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-black/70 hover:text-black"
              onClick={() => setRunningPage(false)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          
          {/* Test Summary */}
          {testCaseResults.length > 0 && (
            <div className="mt-3 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <Check className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium text-green-600">
                    {testCaseResults.filter(result => result.status === 3).length} Passed
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <span className="text-sm font-medium text-red-600">
                    {testCaseResults.filter(result => result.status !== 3).length} Failed
                  </span>
                </div>
              </div>
              <div className="text-sm text-black/70">
                {testCaseResults.filter(result => result.status === 3).length}/{testCaseResults.length} total
              </div>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 border-3 border-t-[#2599D4] border-[#2599D4]/30 rounded-full animate-spin" />
              <span className="text-black">Running test cases...</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* Test Case Selection */}
            <div className="w-72 border-r border-blue-200 p-4 space-y-4 bg-white/50">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {checkStatus(selectedCase - 1) ? (
                    <Check className="h-5 w-5 text-green-600" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-red-600" />
                  )}
                  <span
                    className={`font-medium ${
                      checkStatus(selectedCase - 1)
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    {checkStatus(selectedCase - 1) ? "Correct" : "Wrong Answer"}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm text-black/70">
                  <Timer className="h-4 w-4" />
                  Runtime: {testCaseResults[selectedCase - 1]?.time || 0} ms
                </div>
              </div>

              <ScrollArea className="space-y-2">
                {testCaseResults.map((_, index) => {
                  const isPassed = checkStatus(index);
                  const isSelected = selectedCase === index + 1;
                  
                  return (
                    <Button
                      key={index}
                      variant="ghost"
                      className={`w-full justify-between gap-2 ${
                        isSelected
                          ? isPassed
                            ? "bg-green-100 text-green-600 hover:bg-green-200"
                            : "bg-red-100 text-red-600 hover:bg-red-200"
                          : "text-black/70 hover:text-black hover:bg-white/50"
                      }`}
                      onClick={() => {
                        setSelectedCase(index + 1);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        {isPassed ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-red-600" />
                        )}
                        <span>Test Case {index + 1}</span>
                      </div>
                      <div className={`text-xs px-2 py-1 rounded ${
                        isPassed 
                          ? "bg-green-200 text-green-700" 
                          : "bg-red-200 text-red-700"
                      }`}>
                        {isPassed ? "PASS" : "FAIL"}
                      </div>
                    </Button>
                  );
                })}
              </ScrollArea>
            </div>

            {/* Test Case Details */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {testCaseResults.length > 0 &&
                selectedCase <= testCaseResults.length ? (
                  <>
                    {/* Input Card */}
                    <div className="bg-white/90 rounded-lg p-4 border border-blue-200">
                      <h3 className="font-medium text-black mb-2">Input</h3>
                      <pre className="font-mono text-sm bg-gray-100 p-3 rounded-lg text-black whitespace-pre-wrap">
                        {testCaseResults[selectedCase - 1]?.input ||
                          "No Input"}
                      </pre>
                    </div>

                    {/* User Output Card */}
                    <div className="bg-white/90 rounded-lg p-4 border border-blue-200">
                      <h3 className="font-medium text-black mb-2">
                        Your Output
                      </h3>
                      <pre className="font-mono text-sm bg-gray-100 p-3 rounded-lg text-black whitespace-pre-wrap">
                        {testCaseResults[selectedCase - 1]?.userOutput ||
                          testCaseResults[selectedCase - 1]?.error ||
                          "No Output"}
                      </pre>
                    </div>

                    {/* Expected Output Card */}
                    <div className="bg-white/90 rounded-lg p-4 border border-blue-200">
                      <h3 className="font-medium text-black mb-2">
                        Expected Output
                      </h3>
                      <pre className="font-mono text-sm bg-gray-100 p-3 rounded-lg text-black whitespace-pre-wrap">
                        {testCaseResults[selectedCase - 1]?.expectedOutput}
                      </pre>
                    </div>
                  </>
                ) : (
                  <div className="text-black text-center">
                    No test case data available.
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
}
