import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, Trash2 } from 'lucide-react';
import type { AdminProblem } from '@/types/admin';

interface ProblemListProps {
  title: string;
  description: string;
  problems: AdminProblem[];
  loading: boolean;
  isVerifying: boolean;
  deletingProblemId: string | null;
  variant: 'unverified' | 'verified';
  onVerify?: (problemId: string) => void;
  onEdit: (problemId: string) => void;
  onDelete: (problemId: string) => void;
}

export function ProblemList({
  title,
  description,
  problems,
  loading,
  isVerifying,
  deletingProblemId,
  variant,
  onVerify,
  onEdit,
  onDelete,
}: ProblemListProps) {
  const isUnverified = variant === 'unverified';
  const borderColor = isUnverified ? 'border-blue-200' : 'border-green-200';
  const bgColor = isUnverified ? 'bg-blue-50' : 'bg-green-50';
  const iconColor = isUnverified ? '#2599D4' : '#22c55e';
  const spinnerColor = isUnverified ? '#2599D4' : '#22c55e';

  return (
    <Card className={`bg-white/90 ${borderColor} shadow-lg hover:shadow-xl transition-shadow duration-300`}>
      <CardHeader>
        <CardTitle className="text-black flex items-center gap-2">
          <CheckCircle className="h-5 w-5" style={{ color: iconColor }} />
          {title}
        </CardTitle>
        <CardDescription className="text-black/70">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto" style={{ borderColor: spinnerColor }}></div>
            <p className="text-black/70 mt-2">Loading {title.toLowerCase()}...</p>
          </div>
        ) : problems.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-black/70">No {title.toLowerCase()} found</p>
          </div>
        ) : (
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {problems.map((problem) => (
              <div key={problem._id} className={`border ${borderColor} rounded-lg p-4 ${bgColor}`}>
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-semibold text-black">{problem.title}</h3>
                  <Badge variant="outline" className="text-xs">
                    {problem.difficulty}
                  </Badge>
                </div>
                <p className="text-black/70 text-sm mb-3 line-clamp-2">{problem.description}</p>
                
                <div className="flex flex-wrap gap-2 mb-3">
                  {problem.topics.map((topic, index) => (
                    <Badge key={index} variant="secondary" className="text-xs">
                      {topic}
                    </Badge>
                  ))}
                </div>

                <div className="text-xs text-black/70 mb-3">
                  Created: {new Date(problem.createdAt).toLocaleDateString()}
                  {!isUnverified && problem.verifiedAt && (
                    <div>Verified: {new Date(problem.verifiedAt).toLocaleDateString()}</div>
                  )}
                  {!isUnverified && problem.timeComplexity && (
                    <div>Target Complexity: {problem.timeComplexity}</div>
                  )}
                </div>

                {/* Show failed test cases for unverified problems */}
                {isUnverified && problem.failedTestCases && Object.keys(problem.failedTestCases).length > 0 && (
                  <div className="mt-3">
                    <h4 className="text-sm font-medium text-red-600 mb-3 flex items-center gap-2">
                      <XCircle className="h-4 w-4" />
                      Failed Test Cases by Language
                    </h4>
                    <div className="space-y-3">
                      {Object.entries(problem.failedTestCases).map(([lang, tests]) => (
                        <div key={lang} className="bg-red-50 border border-red-300 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-medium capitalize text-red-600 text-sm">{lang}</span>
                            <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">
                              {tests.length} failed
                            </span>
                          </div>
                          <div className="space-y-2">
                            {tests.slice(0, 2).map((test, idx) => (
                              <div key={idx} className="bg-white border border-blue-200 rounded p-2 text-xs">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-medium text-black/70">Test #{test.testNumber}</span>
                                  <span className="text-red-600">✗</span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                                  <div>
                                    <span className="text-black/70">Input:</span>
                                    <div className="font-mono bg-gray-100 p-1 rounded mt-1 text-black">
                                      {JSON.stringify(test.input)}
                                    </div>
                                  </div>
                                  <div>
                                    <span className="text-black/70">Expected:</span>
                                    <div className="font-mono bg-green-100 p-1 rounded mt-1 text-green-800">
                                      {JSON.stringify(test.expected)}
                                    </div>
                                  </div>
                                  <div>
                                    <span className="text-black/70">Actual:</span>
                                    <div className="font-mono bg-red-100 p-1 rounded mt-1 text-red-800">
                                      {test.actual !== undefined ? JSON.stringify(test.actual) : 'undefined'}
                                    </div>
                                  </div>
                                </div>
                                {test.error && (
                                  <div className="mt-2">
                                    <span className="text-black/70">Error:</span>
                                    <div className="font-mono bg-red-100 p-1 rounded mt-1 text-red-800 text-xs">
                                      {test.error}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                            {tests.length > 2 && (
                              <div className="text-xs text-black/70 text-center">
                                ... and {tests.length - 2} more failed tests
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 mt-4">
                  {isUnverified && onVerify && (
                    <Button
                      onClick={() => onVerify(problem._id)}
                      disabled={isVerifying}
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      {isVerifying ? 'Verifying...' : 'Verify'}
                    </Button>
                  )}
                  <Button
                    onClick={() => onEdit(problem._id)}
                    size="sm"
                    variant="outline"
                    className="border-blue-200 text-black hover:bg-blue-50"
                  >
                    Edit
                  </Button>
                  <Button
                    onClick={() => onDelete(problem._id)}
                    size="sm"
                    variant="outline"
                    className="border-red-500 text-red-600 hover:bg-red-50"
                    disabled={deletingProblemId === problem._id}
                  >
                    {deletingProblemId === problem._id ? (
                      'Deleting...'
                    ) : (
                      <span className="flex items-center gap-1">
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </span>
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

