import React from 'react';
import Editor from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Play, Check, CheckCircle } from "lucide-react";
import { languages } from '@/lib/utils/match/constants';
import type { TestSummary } from '@/types/match';

interface CodeEditorPanelProps {
  language: string;
  code: string;
  onLanguageChange: (lang: string) => Promise<void>;
  onCodeChange: (value: string | undefined) => void;
  onRunClick: () => void;
  onSubmitClick: () => void;
  isRunning: boolean;
  isSubmitting: boolean;
  testSummary: TestSummary;
  onViewDetailsClick: () => void;
}

export function CodeEditorPanel({
  language,
  code,
  onLanguageChange,
  onCodeChange,
  onRunClick,
  onSubmitClick,
  isRunning,
  isSubmitting,
  testSummary,
  onViewDetailsClick,
}: CodeEditorPanelProps) {
  return (
    <div className="h-full flex flex-col bg-white">
      {/* Language selector and buttons */}
      <div className="flex items-center justify-between px-4 h-12 bg-white/90 flex-shrink-0">
        <Select value={language} onValueChange={onLanguageChange}>
          <SelectTrigger className="w-[150px] h-8 text-sm bg-white text-black border-blue-200 focus:ring-blue-500 focus:border-blue-500">
            <SelectValue placeholder="Select Language" />
          </SelectTrigger>
          <SelectContent>
            {languages.map((lang) => (
              <SelectItem key={lang.value} value={lang.value}>
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-4">
          {/* Test Summary Display */}
          {testSummary.total > 0 && (
            <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-white/80 border border-blue-200">
              <div className={`flex items-center gap-1 text-sm font-medium ${
                testSummary.passed === testSummary.total ? 'text-green-600' : 'text-orange-600'
              }`}>
                <CheckCircle className="h-4 w-4" />
                <span>{testSummary.passed}/{testSummary.total} passed</span>
              </div>
              <div className="w-px h-4 bg-blue-200"></div>
              <button
                onClick={onViewDetailsClick}
                className="text-xs text-blue-600 hover:text-blue-800 underline"
              >
                View Details
              </button>
            </div>
          )}
          
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-8 px-4 text-white hover:opacity-90"
              style={{ backgroundColor: '#2599D4' }}
              onClick={onRunClick}
              disabled={isRunning || isSubmitting}
            >
              {isRunning ? (
                <>
                  <div className="h-4 w-4 mr-2 border-2 border-t-white border-white/30 rounded-full animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Run Tests
                </>
              )}
            </Button>
            <Button
              size="sm"
              className="h-8 px-4 bg-green-600 text-white hover:bg-green-700"
              style={{ backgroundColor: '#10b981' }}
              onClick={onSubmitClick}
              disabled={isSubmitting || isRunning}
            >
              {isSubmitting ? (
                <>
                  <div className="h-4 w-4 mr-2 border-2 border-t-white border-white/30 rounded-full animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Submit
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Monaco Editor */}
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          language={language}
          value={code}
          theme="vs"
          onChange={onCodeChange}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            scrollBeyondLastLine: false,
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  );
}

