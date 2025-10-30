'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MonacoEditor } from '@/components/ui/monaco-editor';
import { toast } from 'react-toastify';
import { generateProblem, verifyProblemSolutions, getUnverifiedProblems, getProblemById, updateProblem } from '@/lib/actions';
import { FileText, Plus, CheckCircle, XCircle } from 'lucide-react';

type ProblemExample = {
  input: string;
  output: string;
  explanation: string;
};

type UnverifiedProblem = {
  _id: string;
  title: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  topics: string[];
  description: string;
  examples: Array<{
    input: string;
    output: string;
    explanation: string | null;
  }>;
  constraints: string[];
  timeComplexity?: string;
  signature?: {
    functionName: string;
    parameters: Array<{ name: string; type: string }>;
    returnType: string;
    comparisonMode?: 'strict' | 'unordered' | 'set' | 'custom';
    customComparator?: string;
  };
  solutions?: {
    python?: string;
    cpp?: string;
    java?: string;
    js?: string;
  };
  testCases?: Array<{
    input: Record<string, unknown>;
    output: unknown;
  }>;
  createdAt: string;
  updatedAt: string;
  verified?: boolean;
  verifiedAt?: string | null;
  verificationResults?: Record<string, unknown>;
  verificationError?: string[];
  allTestCases?: Record<string, Array<{
    testNumber: number;
    input: unknown;
    expected: unknown;
    actual: unknown;
    error?: string;
    passed: boolean;
  }>>;
  failedTestCases?: Record<string, Array<{
    testNumber: number;
    input: unknown;
    expected: unknown;
    actual: unknown;
    error?: string;
  }>>;
};

export default function ProblemManagement() {
  const [title, setTitle] = useState('');
  const [difficulty, setDifficulty] = useState<'Easy' | 'Medium' | 'Hard'>('Easy');
  const [description, setDescription] = useState('');
  const [examples, setExamples] = useState<ProblemExample[]>([
    { input: '', output: '', explanation: '' },
  ]);
  const [constraints, setConstraints] = useState<string[]>(['']);
  const [timeComplexity, setTimeComplexity] = useState('O(n)');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStep, setGenerationStep] = useState<string>('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [unverifiedProblems, setUnverifiedProblems] = useState<UnverifiedProblem[]>([]);
  const [loadingProblems, setLoadingProblems] = useState(true);
  const [editingProblem, setEditingProblem] = useState<UnverifiedProblem | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingSolutions, setEditingSolutions] = useState<Record<string, string>>({});
  const [mounted, setMounted] = useState(false);

  // Handle mounting to prevent hydration issues
  useEffect(() => {
    setMounted(true);
  }, []);

  // Load unverified problems on component mount
  useEffect(() => {
    if (mounted) {
      loadUnverifiedProblems();
    }
  }, [mounted]);

  const loadUnverifiedProblems = async () => {
    try {
      setLoadingProblems(true);
      const problems = await getUnverifiedProblems();
      setUnverifiedProblems(Array.isArray(problems) ? (problems as UnverifiedProblem[]) : []);
    } catch (error) {
      console.error('Error loading unverified problems:', error);
      toast.error('Failed to load unverified problems');
    } finally {
      setLoadingProblems(false);
    }
  };

  // Prevent hydration issues by not rendering until mounted
  if (!mounted) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-white/60 rounded w-1/4 mb-6"></div>
          <div className="h-4 bg-white/60 rounded w-1/2 mb-4"></div>
          <div className="h-4 bg-white/60 rounded w-3/4"></div>
        </div>
      </div>
    );
  }

  const addExample = () => {
    setExamples([...examples, { input: '', output: '', explanation: '' }]);
  };

  const removeExample = (index: number) => {
    setExamples(examples.filter((_, i) => i !== index));
  };

  const updateExample = (index: number, field: keyof ProblemExample, value: string) => {
    const updated = [...examples];
    updated[index] = { ...updated[index], [field]: value };
    setExamples(updated);
  };

  const addConstraint = () => {
    setConstraints([...constraints, '']);
  };

  const removeConstraint = (index: number) => {
    setConstraints(constraints.filter((_, i) => i !== index));
  };

  const updateConstraint = (index: number, value: string) => {
    const updated = [...constraints];
    updated[index] = value;
    setConstraints(updated);
  };

  const handleGenerate = async () => {
    if (!title.trim() || !description.trim()) {
      toast.error('Please fill in title and description');
      return;
    }

    setIsGenerating(true);
    setGenerationStep('Generating problem...');

    try {
      const result = await generateProblem({
        title,
        difficulty,
        description,
        examples: examples.filter(ex => ex.input.trim() && ex.output.trim()),
        constraints: constraints.filter(c => c.trim()),
        timeComplexity,
      });

      if (result.success) {
        toast.success('Problem generated successfully!');
        setTitle('');
        setDescription('');
        setExamples([{ input: '', output: '', explanation: '' }]);
        setConstraints(['']);
        setTimeComplexity('O(n)');
        loadUnverifiedProblems();
      } else {
        toast.error(result.error || 'Failed to generate problem');
      }
    } catch (error) {
      console.error('Error generating problem:', error);
      toast.error('Failed to generate problem');
    } finally {
      setIsGenerating(false);
      setGenerationStep('');
    }
  };

  const handleVerify = async (problemId: string) => {
    setIsVerifying(true);
    try {
      const result = await verifyProblemSolutions(problemId);
      if (result.success) {
        toast.success('Problem verified successfully!');
        loadUnverifiedProblems();
      } else {
        toast.error(result.error || 'Verification failed');
        if (result.details) {
          console.error('Verification details:', result.details);
        }
      }
    } catch (error) {
      console.error('Error verifying problem:', error);
      toast.error('Failed to verify problem');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleEditProblem = async (problemId: string) => {
    const problem = await getProblemById(problemId);
    if (problem) {
      const fullProblem = problem as UnverifiedProblem;
      setEditingProblem(fullProblem);
      setEditingSolutions(fullProblem.solutions || {});
      setEditDialogOpen(true);
    } else {
      toast.error('Failed to load problem for editing');
    }
  };

  const handleSaveEdits = async () => {
    if (!editingProblem) return;
    setIsSaving(true);
    try {
      const result = await updateProblem(editingProblem._id, {
        testCases: editingProblem.testCases,
        solutions: editingSolutions,
        signature: editingProblem.signature,
      });
      if (result.success) {
        toast.success('Problem updated successfully!');
        setEditDialogOpen(false);
        setEditingProblem(null);
        setEditingSolutions({});
        loadUnverifiedProblems();
      } else {
        toast.error(result.error || 'Failed to update problem');
      }
    } catch (error) {
      console.error('Error updating problem:', error);
      toast.error('Failed to update problem');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-black mb-2 flex items-center gap-2">
          <FileText className="h-6 w-6" style={{ color: '#2599D4' }} />
          Problem Management
        </h2>
        <p className="text-black/70">Create, verify, and manage coding problems</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Problem Generation Form */}
        <Card className="bg-white/90 border-blue-200 shadow-lg hover:shadow-xl transition-shadow duration-300">
          <CardHeader>
            <CardTitle className="text-black flex items-center gap-2">
              <Plus className="h-5 w-5" style={{ color: '#2599D4' }} />
              Generate New Problem
            </CardTitle>
            <CardDescription className="text-black/70">
              Create a new coding problem with test cases and solutions
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <Label htmlFor="title" className="text-black">Problem Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter problem title"
                className="bg-white border-blue-200 text-black"
              />
            </div>

            <div>
              <Label htmlFor="difficulty" className="text-black">Difficulty</Label>
              <Select value={difficulty} onValueChange={(value: 'Easy' | 'Medium' | 'Hard') => setDifficulty(value)}>
                <SelectTrigger className="bg-white border-blue-200 text-black">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Easy">Easy</SelectItem>
                  <SelectItem value="Medium">Medium</SelectItem>
                  <SelectItem value="Hard">Hard</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="description" className="text-black">Problem Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the problem..."
                className="bg-white border-blue-200 text-black min-h-[120px]"
              />
            </div>

            <div>
              <Label className="text-black">Examples</Label>
              <div className="space-y-4">
                {examples.map((example, index) => (
                  <div key={index} className="border border-blue-200 rounded-lg p-4 space-y-3 bg-blue-50">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-black/70">Example {index + 1}</span>
                      {examples.length > 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => removeExample(index)}
                          className="text-red-600 border-red-500 hover:bg-red-50"
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <Label className="text-black/70 text-sm">Input</Label>
                        <Textarea
                          value={example.input}
                          onChange={(e) => updateExample(index, 'input', e.target.value)}
                          placeholder="Input example"
                          className="bg-white border-blue-200 text-black text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-black/70 text-sm">Output</Label>
                        <Textarea
                          value={example.output}
                          onChange={(e) => updateExample(index, 'output', e.target.value)}
                          placeholder="Expected output"
                          className="bg-white border-blue-200 text-black text-sm"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-black/70 text-sm">Explanation (Optional)</Label>
                      <Textarea
                        value={example.explanation}
                        onChange={(e) => updateExample(index, 'explanation', e.target.value)}
                        placeholder="Explain the example..."
                        className="bg-white border-blue-200 text-black text-sm"
                      />
                    </div>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={addExample}
                  className="w-full border-blue-200 text-black hover:bg-blue-50"
                >
                  Add Example
                </Button>
              </div>
            </div>

            <div>
              <Label className="text-black">Constraints</Label>
              <div className="space-y-2">
                {constraints.map((constraint, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      value={constraint}
                      onChange={(e) => updateConstraint(index, e.target.value)}
                      placeholder="Enter constraint"
                      className="bg-white border-blue-200 text-black"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => removeConstraint(index)}
                      className="text-red-600 border-red-500 hover:bg-red-50"
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={addConstraint}
                  className="w-full border-blue-200 text-black hover:bg-blue-50"
                >
                  Add Constraint
                </Button>
              </div>
            </div>

            <div>
              <Label htmlFor="timeComplexity" className="text-black">Target Time Complexity</Label>
              <Input
                id="timeComplexity"
                value={timeComplexity}
                onChange={(e) => setTimeComplexity(e.target.value)}
                placeholder="e.g., O(n), O(n log n), O(n²), O(2ⁿ)"
                className="bg-white border-blue-200 text-black"
              />
            </div>

            <Button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="w-full text-white"
              style={{ backgroundColor: '#2599D4' }}
            >
              {isGenerating ? generationStep : 'Generate Problem'}
            </Button>
          </CardContent>
        </Card>

        {/* Unverified Problems List */}
        <Card className="bg-white/90 border-blue-200 shadow-lg hover:shadow-xl transition-shadow duration-300">
          <CardHeader>
            <CardTitle className="text-black flex items-center gap-2">
              <CheckCircle className="h-5 w-5" style={{ color: '#2599D4' }} />
              Unverified Problems
            </CardTitle>
            <CardDescription className="text-black/70">
              Problems that need verification before being used in matches
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingProblems ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto" style={{ borderColor: '#2599D4' }}></div>
                <p className="text-black/70 mt-2">Loading problems...</p>
              </div>
            ) : unverifiedProblems.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-black/70">No unverified problems found</p>
              </div>
            ) : (
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {unverifiedProblems.map((problem) => (
                  <div key={problem._id} className="border border-blue-200 rounded-lg p-4 bg-blue-50">
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
                    </div>

                    {/* Show failed test cases with detailed visual display */}
                    {problem.failedTestCases && Object.keys(problem.failedTestCases).length > 0 && (
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
                      <Button
                        onClick={() => handleVerify(problem._id)}
                        disabled={isVerifying}
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        {isVerifying ? 'Verifying...' : 'Verify'}
                      </Button>
                      <Button
                        onClick={() => handleEditProblem(problem._id)}
                        size="sm"
                        variant="outline"
                        className="border-blue-200 text-black hover:bg-blue-50"
                      >
                        Edit
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit Problem Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto bg-white border-blue-200">
          <DialogHeader>
            <DialogTitle className="text-black">Edit Problem</DialogTitle>
            <DialogDescription className="text-black/70">
              Modify test cases and solutions for this problem
            </DialogDescription>
          </DialogHeader>
          
          {editingProblem && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-black mb-2">Problem: {editingProblem.title}</h3>
                <p className="text-black/70">{editingProblem.description}</p>
              </div>

              {/* Comparison Configuration */}
              {editingProblem.signature && (
                <div className="space-y-4 border border-blue-200 rounded-lg p-4 bg-blue-50">
                  <h3 className="text-lg font-semibold text-black">Output Comparison Settings</h3>
                  
                  <div className="space-y-2">
                    <Label className="text-black/70">Comparison Mode</Label>
                    <Select
                      value={editingProblem.signature.comparisonMode || 'strict'}
                      onValueChange={(value) => {
                        setEditingProblem({
                          ...editingProblem,
                          signature: {
                            ...editingProblem.signature,
                            comparisonMode: value as 'strict' | 'unordered' | 'set' | 'custom',
                            ...(value !== 'custom' ? { customComparator: undefined } : {})
                          }
                        });
                      }}
                    >
                      <SelectTrigger className="bg-white border-blue-200 text-black">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="strict">Strict - Exact match</SelectItem>
                        <SelectItem value="unordered">Unordered - Order-independent</SelectItem>
                        <SelectItem value="set">Set - Ignore duplicates</SelectItem>
                        <SelectItem value="custom">Custom - Use custom comparator</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-black/70">
                      {editingProblem.signature.comparisonMode === 'strict' && 'Exact JSON equality - default behavior.'}
                      {editingProblem.signature.comparisonMode === 'unordered' && 'Use this for problems like 3Sum where order of results doesn\'t matter.'}
                      {editingProblem.signature.comparisonMode === 'set' && 'Treat output as a set, ignoring order and duplicates.'}
                      {editingProblem.signature.comparisonMode === 'custom' && 'Provide a custom JavaScript function for comparison.'}
                    </p>
                  </div>

                  {editingProblem.signature.comparisonMode === 'custom' && (
                    <div className="space-y-2">
                      <Label className="text-black/70">Custom Comparator Function</Label>
                      <Textarea
                        value={editingProblem.signature.customComparator || ''}
                        onChange={(e) => {
                          setEditingProblem({
                            ...editingProblem,
                            signature: {
                              ...editingProblem.signature,
                              customComparator: e.target.value
                            }
                          });
                        }}
                        placeholder="function compare(expected, actual) {&#10;  // Your comparison logic&#10;  return true/false;&#10;}"
                        className="bg-white border-blue-200 text-black text-sm font-mono"
                        rows={8}
                      />
                      <p className="text-xs text-black/70">
                        Provide a JavaScript function that takes (expected, actual) and returns true if they match.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Edit Test Cases */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-black">Edit Test Cases</h3>
                <div className="space-y-4">
                  {(editingProblem.testCases || []).map((testCase, index) => (
                    <div key={index} className="border border-blue-200 rounded-lg p-4 bg-blue-50">
                      <div className="flex justify-between items-center mb-3">
                        <span className="font-medium text-black">Test Case {index + 1}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const updated = [...(editingProblem.testCases || [])];
                            updated.splice(index, 1);
                            setEditingProblem({ ...editingProblem, testCases: updated });
                          }}
                          className="text-red-600 border-red-500 hover:bg-red-50"
                        >
                          Remove
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label className="text-black/70 text-sm">Input</Label>
                          <Textarea
                            value={JSON.stringify(testCase.input, null, 2)}
                            onChange={(e) => {
                              try {
                                const updated = [...(editingProblem.testCases || [])];
                                updated[index] = { ...updated[index], input: JSON.parse(e.target.value) };
                                setEditingProblem({ ...editingProblem, testCases: updated });
                              } catch (error) {
                                // Invalid JSON, don't update
                              }
                            }}
                            className="bg-white border-blue-200 text-black text-sm font-mono"
                            rows={4}
                          />
                        </div>
                        <div>
                          <Label className="text-black/70 text-sm">Expected Output</Label>
                          <Textarea
                            value={JSON.stringify(testCase.output, null, 2)}
                            onChange={(e) => {
                              try {
                                const updated = [...(editingProblem.testCases || [])];
                                updated[index] = { ...updated[index], output: JSON.parse(e.target.value) };
                                setEditingProblem({ ...editingProblem, testCases: updated });
                              } catch (error) {
                                // Invalid JSON, don't update
                              }
                            }}
                            className="bg-white border-blue-200 text-black text-sm font-mono"
                            rows={4}
                          />
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-black/70">
                        <strong>Preview:</strong> Input: {JSON.stringify(testCase.input)} → Output: {JSON.stringify(testCase.output)}
                      </div>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const newTestCase = { input: {}, output: null };
                      setEditingProblem({
                        ...editingProblem,
                        testCases: [...(editingProblem.testCases || []), newTestCase]
                      });
                    }}
                    className="w-full border-blue-200 text-black hover:bg-blue-50"
                  >
                    Add Test Case
                  </Button>
                </div>
              </div>

              {/* Edit Solutions */}
              {editingProblem.solutions && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-black">Edit Solutions</h3>
                  <div className="space-y-4">
                    {Object.entries(editingProblem.solutions).map(([lang, code]) => (
                      <div key={lang} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Label className="text-black capitalize font-medium">{lang}</Label>
                          <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                            Editable
                          </span>
                        </div>
                        <MonacoEditor
                          value={editingSolutions[lang] || code || ''}
                          language={lang === 'cpp' ? 'cpp' : lang === 'js' ? 'javascript' : lang}
                          height="300px"
                          className="bg-white"
                          onChange={(newValue) => {
                            setEditingSolutions(prev => ({
                              ...prev,
                              [lang]: newValue
                            }));
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-black/70 bg-blue-50 p-3 rounded">
                    <strong>Note:</strong> You can edit the solutions directly. Changes will be saved to the database when you click &quot;Save Changes&quot;.
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4 border-t border-blue-200">
                <Button
                  onClick={() => {
                    setEditDialogOpen(false);
                    setEditingProblem(null);
                    setEditingSolutions({});
                  }}
                  variant="outline"
                  className="bg-white border-blue-200 text-black hover:bg-blue-50"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveEdits}
                  disabled={isSaving}
                  className="text-white"
                  style={{ backgroundColor: '#2599D4' }}
                >
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

