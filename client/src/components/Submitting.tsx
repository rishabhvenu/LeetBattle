"use client";

import { useEffect } from "react";
import { X, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface TestCaseResult {
  input: string;
  expectedOutput: string;
  userOutput: string | null;
  status: number;
  error?: string | null;
  time?: number;
}

interface SubmittingProps {
  isVisible: boolean;
  setSubmittingPage: (visible: boolean) => void;
  isLoading: boolean;
  submitCaseResults: TestCaseResult[];
}

export default function Submitting({
  isVisible,
  setSubmittingPage,
  isLoading,
  submitCaseResults,
}: SubmittingProps) {
  const passedTests = submitCaseResults.filter(
    (test) => test.status === 3
  ).length;
  const totalTests = submitCaseResults.length;
  const failedTests = totalTests - passedTests;

  useEffect(() => {
    if (isVisible) {
      // Any setup on visibility if needed
    }
  }, [isVisible]);

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-opacity duration-300 ease-in-out z-50 ${
        isVisible ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      <div
        className={`transform transition-transform duration-300 ease-in-out w-full max-w-lg mx-4 bg-white rounded-lg shadow-xl ${
          isVisible ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-blue-200">
          <h2 className="text-2xl font-bold text-black">
            Submission Results
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-black/70 hover:text-black"
            onClick={() => setSubmittingPage(false)}
            aria-label="Close Results"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 space-y-6">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 border-4 border-t-[#2599D4] border-[#2599D4]/30 rounded-full animate-spin" />
              <span className="text-black text-xl font-medium">
                Processing submissions...
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center px-6 py-10 space-y-10">
            <div className="space-y-4 text-center">
              <div className="flex items-center justify-center gap-2">
                {passedTests === totalTests ? (
                  <Check className="h-10 w-10 text-green-600" />
                ) : (
                  <AlertCircle className="h-10 w-10 text-red-600" />
                )}
                <h3
                  className={`text-3xl font-extrabold ${
                    passedTests === totalTests
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                >
                  {passedTests === totalTests
                    ? "All Test Cases Passed!"
                    : "Tests Failed"}
                </h3>
              </div>
              <p className="text-black text-xl font-medium">
                {passedTests}/{totalTests} test cases passed.
              </p>
            </div>

            <div className="flex space-x-8">
              <div className="text-center">
                <p className="text-black/70 text-lg">Correct:</p>
                <span className="text-green-600 text-2xl font-semibold">
                  {passedTests}
                </span>
              </div>
              <div className="text-center">
                <p className="text-black/70 text-lg">Incorrect:</p>
                <span className="text-red-600 text-2xl font-semibold">
                  {failedTests}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
