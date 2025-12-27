import React from 'react';
import Editor from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Play, Check, CheckCircle, Clock, Gamepad2 } from "lucide-react";
import { languages } from '@/lib/utils/match/constants';
import type { TestSummary, Problem } from '@/types/match';
import { Separator } from '@/components/ui/separator';
import CountdownTimer from '@/components/CountdownTimer';

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
  matchStartTime: number | null;
  matchId: string | null;
  problem: Problem | null;
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
  matchStartTime,
  matchId,
  problem,
}: CodeEditorPanelProps) {
  return (
    <div className="h-full flex flex-col bg-white">
      {/* Language selector and buttons */}
      <div className="flex items-center justify-between px-3 h-11 bg-white border-b border-gray-200 flex-shrink-0">
        <Select value={language} onValueChange={onLanguageChange}>
          <SelectTrigger className="w-[140px] h-7 text-xs bg-gray-50 text-black border-gray-200 focus:ring-blue-500 focus:border-blue-500">
            <SelectValue placeholder="Select Language" />
          </SelectTrigger>
          <SelectContent>
            {languages.map((lang) => (
              <SelectItem key={lang.value} value={lang.value} className="text-xs">
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-3">
          {/* Test Summary Display */}
          {testSummary.total > 0 && (
            <div className="flex items-center gap-2 px-2 py-0.5 rounded-md bg-gray-50 border border-gray-200">
              <div className={`flex items-center gap-1 text-xs font-medium ${
                testSummary.passed === testSummary.total ? 'text-green-600' : 'text-orange-600'
              }`}>
                <CheckCircle className="h-3 w-3" />
                <span>{testSummary.passed}/{testSummary.total}</span>
              </div>
              <div className="w-px h-3 bg-gray-300"></div>
              <button
                onClick={onViewDetailsClick}
                className="text-[10px] text-blue-600 hover:text-blue-800 underline uppercase font-bold tracking-wide"
              >
                Details
              </button>
            </div>
          )}
          
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 px-3 text-xs font-medium text-white hover:opacity-90 shadow-sm"
              style={{ backgroundColor: '#2599D4' }}
              onClick={onRunClick}
              disabled={isRunning || isSubmitting}
            >
              {isRunning ? (
                <>
                  <div className="h-3 w-3 mr-1.5 border-2 border-t-white border-white/30 rounded-full animate-spin" />
                  Running
                </>
              ) : (
                <>
                  <Play className="h-3 w-3 mr-1.5" />
                  Run
                </>
              )}
            </Button>
            <Button
              size="sm"
              className="h-7 px-3 text-xs font-medium bg-green-600 text-white hover:bg-green-700 shadow-sm"
              style={{ backgroundColor: '#10b981' }}
              onClick={onSubmitClick}
              disabled={isSubmitting || isRunning}
            >
              {isSubmitting ? (
                <>
                  <div className="h-3 w-3 mr-1.5 border-2 border-t-white border-white/30 rounded-full animate-spin" />
                  Submitting
                </>
              ) : (
                <>
                  <Check className="h-3 w-3 mr-1.5" />
                  Submit
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Monaco Editor */}
      <div className="flex-1 overflow-hidden relative group">
        <Editor
          height="100%"
          language={language}
          value={code}
          theme="vs"
          onChange={onCodeChange}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            lineHeight: 24,
            padding: { top: 16, bottom: 16 },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            renderLineHighlight: "line",
            fontFamily: "'Courier New', Courier, monospace",
            fontLigatures: false,
          }}
        />
        {/* Subtle typing indicator / status (placeholder for future "alive" features) */}
        <div className="absolute bottom-2 right-4 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300">
           <span className="text-[10px] text-gray-400 font-mono">Ln {(code.match(/\n/g)?.length || 0) + 1}</span>
        </div>
      </div>

      {/* Footer Info Bar */}
      <div className="h-8 flex items-center justify-between px-3 bg-white border-t border-gray-200 flex-shrink-0 text-black/60">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-black/40" />
            <span className="text-[10px] font-medium font-mono text-black/80">
              <CountdownTimer matchStartTime={matchStartTime} />
            </span>
          </div>
          <Separator orientation="vertical" className="h-3 bg-gray-200" />
          <div className="flex items-center gap-1.5">
            <Gamepad2 className="w-3 h-3 text-black/40" />
            <span className="text-[10px] font-medium text-black/80">{problem?.difficulty || 'Medium'}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-black/40">ID:</span>
          <span className="text-[10px] font-mono text-black/60">{matchId?.slice(0, 8)}</span>
        </div>
      </div>
    </div>
  );
}

