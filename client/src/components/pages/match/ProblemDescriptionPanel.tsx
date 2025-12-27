import React, { useState } from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, ListChecks, ChevronDown, ChevronUp } from "lucide-react";
import { difficultyConfig } from '@/lib/utils/match/constants';
import type { Problem, FormattedSubmission } from '@/types/match';

interface ProblemDescriptionPanelProps {
  problem: Problem;
  activeTab: string;
  onTabChange: (tab: string) => void;
  submissions: FormattedSubmission[];
  onSubmissionClick: (submission: FormattedSubmission) => void;
}

export function ProblemDescriptionPanel({
  problem,
  activeTab,
  onTabChange,
  submissions,
  onSubmissionClick,
}: ProblemDescriptionPanelProps) {
  const diffStyle = difficultyConfig[problem.difficulty?.toLowerCase() || 'medium'];
  const [isDescriptionCollapsed, setIsDescriptionCollapsed] = useState(true);

  return (
    <div className="relative w-full h-full bg-blue-50 z-10">
      <div className="h-full flex flex-col">
        <Tabs value={activeTab} onValueChange={onTabChange} className="flex-1 flex flex-col h-full">
          <TabsList className="w-full justify-start rounded-none border-b border-blue-200 bg-white/90 p-0 h-12 flex-shrink-0 [&_[data-state=active]]:bg-[#2599D4] [&_[data-state=active]]:text-white [&_[data-state=active]]:border-b-2 [&_[data-state=active]]:border-[#2599D4]">
            <TabsTrigger
              value="description"
              className="rounded-none px-6 h-full text-sm font-medium data-[state=inactive]:text-black/70 data-[state=inactive]:hover:text-black transition-all duration-200 flex items-center gap-2 border-b-2 border-transparent"
            >
              <FileText className="h-4 w-4" />
              Description
            </TabsTrigger>
            <TabsTrigger
              value="submissions"
              className="rounded-none px-6 h-full text-sm font-medium data-[state=inactive]:text-black/70 data-[state=inactive]:hover:text-black transition-all duration-200 flex items-center gap-2 border-b-2 border-transparent"
            >
              <ListChecks className="h-4 w-4" />
              Submissions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="description" className="flex-1 overflow-hidden m-0 min-h-0">
            <ScrollArea className="h-full w-full">
              <div className="p-4 space-y-6 bg-white/95 rounded-lg shadow-lg border border-gray-100">
                {/* Problem Header */}
                <div className="space-y-3">
                  <div className="flex justify-between items-start gap-4">
                    <h1 className="text-xl font-bold text-gray-900 leading-tight">{problem.title}</h1>
                    <div className="flex gap-2 items-center flex-shrink-0">
                      <Badge className={`${diffStyle.bg} ${diffStyle.text} text-xs font-medium px-2 py-0.5 rounded-full border shadow-sm`}>
                        {problem.difficulty}
                      </Badge>
                      {problem.topics?.map((topic: string, index: number) => (
                        <Badge key={index} className="bg-gray-100 text-gray-600 text-[10px] font-medium px-2 py-0.5 rounded-full border border-gray-200">
                          {topic}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Problem Description with Collapse */}
                <div className="relative">
                  <div className={`text-gray-700 leading-relaxed whitespace-pre-line text-sm text-left ${isDescriptionCollapsed ? 'line-clamp-4' : ''}`}>
                    {problem.description}
                  </div>
                  <button 
                    onClick={() => setIsDescriptionCollapsed(!isDescriptionCollapsed)}
                    className="flex items-center gap-1 text-[10px] uppercase font-bold text-blue-600 hover:text-blue-800 mt-1 focus:outline-none"
                  >
                    {isDescriptionCollapsed ? (
                      <>Read More <ChevronDown className="h-3 w-3" /></>
                    ) : (
                      <>Show Less <ChevronUp className="h-3 w-3" /></>
                    )}
                  </button>
                </div>

                {/* Examples Section */}
                {problem.examples && problem.examples.length > 0 && (
                  <div className="space-y-4">
                    <div className="border-t border-gray-200 pt-4">
                      <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">Examples</h2>
                    </div>
                    {problem.examples.map((example, index) => (
                      <div key={index} className="bg-gray-50 rounded-lg p-3 border border-gray-200 shadow-sm">
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <span className="text-xs font-bold text-gray-500 uppercase w-12 flex-shrink-0 pt-1">Input:</span>
                            <code className="text-xs flex-1 font-mono text-gray-800 break-all">
                              {typeof example.input === 'object' ? JSON.stringify(example.input, null, 2) : example.input}
                            </code>
                          </div>
                          <div className="flex gap-2">
                            <span className="text-xs font-bold text-gray-500 uppercase w-12 flex-shrink-0 pt-1">Output:</span>
                            <code className="text-xs flex-1 font-mono text-gray-800 break-all">
                              {typeof example.output === 'object' ? JSON.stringify(example.output, null, 2) : example.output}
                            </code>
                          </div>
                          {example.explanation && (
                            <div className="mt-2 pt-2 border-t border-gray-200/50">
                              <p className="text-xs text-gray-600 leading-relaxed"><span className="font-semibold">Explanation:</span> {example.explanation}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Constraints Section */}
                {problem.constraints && problem.constraints.length > 0 && (
                  <div className="pt-2">
                    <h2 className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-2">Constraints</h2>
                    <ul className="space-y-1">
                      {problem.constraints.map((constraint, index) => (
                        <li key={index} className="flex items-start gap-2 text-xs text-gray-600 font-mono">
                          <div className="w-1 h-1 bg-gray-400 rounded-full mt-1.5 flex-shrink-0"></div>
                          <span>{constraint}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="submissions" className="flex-1 overflow-hidden m-0 min-h-0">
            <ScrollArea className="h-full w-full">
              <div className="p-6 space-y-4">
                <h2 className="text-xl font-semibold text-black mb-4">Submissions</h2>
                
                {submissions.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-gray-500">No submissions yet. Submit your code to see results here.</p>
                  </div>
                ) : (
                  submissions.map(submission => (
                    <div 
                      key={submission.id || ''} 
                      className="bg-white/90 cursor-pointer hover:bg-white transition-colors rounded-lg p-4"
                      onClick={() => onSubmissionClick(submission)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-20 flex-shrink-0">
                            <span className={`inline-flex px-2 py-1 rounded text-xs font-semibold ${
                              submission.status === 'Accepted' 
                                ? 'bg-green-100 text-green-600' 
                                : submission.errorType === 'compile'
                                ? 'bg-orange-100 text-orange-600'
                                : submission.errorType === 'runtime'
                                ? 'bg-purple-100 text-purple-600'
                                : submission.errorType === 'timeout'
                                ? 'bg-yellow-100 text-yellow-600'
                                : submission.errorType === 'memory'
                                ? 'bg-indigo-100 text-indigo-600'
                                : submission.errorType === 'system'
                                ? 'bg-gray-100 text-gray-600'
                                : submission.errorType === 'complexity'
                                ? 'bg-rose-100 text-rose-600'
                                : 'bg-red-100 text-red-600'
                            }`}>
                              {submission.errorType === 'wrong' ? 'WA' : 
                               submission.errorType === 'compile' ? 'CE' :
                               submission.errorType === 'runtime' ? 'RE' :
                               submission.errorType === 'timeout' ? 'TLE' :
                               submission.errorType === 'memory' ? 'MLE' :
                               submission.errorType === 'system' ? 'SE' :
                               submission.errorType === 'complexity' ? 'TCF' :
                               submission.status}
                            </span>
                          </div>
                          <div className="w-20 flex-shrink-0">
                            <span className="text-sm text-black/70">{submission.language}</span>
                          </div>
                          <div className="flex-1">
                            <span className="text-sm text-black/70">{submission.time}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

