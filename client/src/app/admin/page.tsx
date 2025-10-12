'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'react-toastify';
import { generateProblem, verifyProblemSolutions, getUnverifiedProblems, getProblemById, updateProblem, resetAllPlayerData } from '@/lib/actions';

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
  verificationResults?: any;
  verificationError?: string[];
  failedTestCases?: Record<string, Array<{
    testNumber: number;
    input: any;
    expected: any;
    actual: any;
    error?: string;
  }>>;
};

export default function AdminPage() {
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
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Load unverified problems on component mount
  useEffect(() => {
    loadUnverifiedProblems();
  }, []);

  const loadUnverifiedProblems = async () => {
    try {
      setLoadingProblems(true);
      const problems = await getUnverifiedProblems();
      setUnverifiedProblems(problems);
    } catch (error) {
      console.error('Error loading unverified problems:', error);
      toast.error('Failed to load unverified problems');
    } finally {
      setLoadingProblems(false);
    }
  };

  const addExample = () => {
    setExamples([...examples, { input: '', output: '', explanation: '' }]);
  };

  const removeExample = (index: number) => {
    setExamples(examples.filter((_, i) => i !== index));
  };

  const updateExample = (index: number, field: keyof ProblemExample, value: string) => {
    const updated = [...examples];
    updated[index][field] = value;
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

  const handleGenerateProblem = async () => {
    // Validate inputs
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }
    if (!description.trim()) {
      toast.error('Description is required');
      return;
    }
    if (examples.length === 0 || !examples[0].input.trim()) {
      toast.error('At least one example is required');
      return;
    }
    if (constraints.length === 0 || !constraints[0].trim()) {
      toast.error('At least one constraint is required');
      return;
    }
    if (!timeComplexity.trim()) {
      toast.error('Time complexity is required');
      return;
    }

    setIsGenerating(true);
    setGenerationStep('Step 1/3: Rewriting problem and generating metadata...');

    try {
      // Simulate step updates (actual steps happen in the server action)
      setTimeout(() => {
        if (isGenerating) setGenerationStep('Step 2/3: Generating solutions for 4 languages...');
      }, 2000);
      
      setTimeout(() => {
        if (isGenerating) setGenerationStep('Step 3/3: Verifying solutions against test cases...');
      }, 5000);
      
      const result = await generateProblem({
        title,
        difficulty,
        description,
        examples: examples.map(ex => ({
          input: ex.input,
          output: ex.output,
          explanation: ex.explanation || null,
        })),
        constraints: constraints.filter(c => c.trim() !== ''),
        timeComplexity,
      });

      if (!result.success) {
        const errorMsg = result.details 
          ? `${result.error}\n\nDetails:\n${(result.details as string[]).join('\n')}`
          : result.error || 'Failed to generate problem';
        throw new Error(errorMsg);
      }

      const successMsg = result.verified 
        ? `Problem generated, verified, and saved! ${result.verificationSummary || ''}`
        : `Problem generated successfully! ID: ${result.problemId}`;
      toast.success(successMsg);
      
      // Reload unverified problems list to show the new problem
      await loadUnverifiedProblems();
      
      // Reset form
      setTitle('');
      setDescription('');
      setExamples([{ input: '', output: '', explanation: '' }]);
      setConstraints(['']);
      setDifficulty('Easy');
      setTimeComplexity('O(n)');
    } catch (error: any) {
      toast.error(error.message || 'Failed to generate problem');
      console.error('Error generating problem:', error);
    } finally {
      setIsGenerating(false);
      setGenerationStep('');
    }
  };

  const handleVerifyProblem = async (problemId: string) => {
    setIsVerifying(true);
    try {
      const result = await verifyProblemSolutions(problemId);
      
      if (result.success) {
        toast.success(`Verification successful! ${result.message}`);
        // Reload unverified problems list to remove the verified problem
        await loadUnverifiedProblems();
      } else {
        toast.error(`Verification failed: ${result.error}`);
        if (result.details) {
          console.error('Verification details:', result.details);
        }
        // Reload to show updated verification errors
        await loadUnverifiedProblems();
      }
    } catch (error: any) {
      toast.error(`Verification error: ${error.message}`);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleEditProblem = async (problemId: string) => {
    const problem = await getProblemById(problemId);
    if (problem) {
      setEditingProblem(problem as UnverifiedProblem);
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
        solutions: editingProblem.solutions,
      });

      if (result.success) {
        toast.success('Problem updated successfully');
        setEditDialogOpen(false);
        setEditingProblem(null);
        await loadUnverifiedProblems();
      } else {
        toast.error(`Failed to update: ${result.error}`);
      }
    } catch (error: any) {
      toast.error(`Save error: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetAllData = async () => {
    setIsResetting(true);
    try {
      const result = await resetAllPlayerData();
      
      if (result.success) {
        toast.success(result.message || 'All player data has been reset successfully');
        setResetDialogOpen(false);
      } else {
        toast.error(`Reset failed: ${result.error}`);
      }
    } catch (error: any) {
      toast.error(`Reset error: ${error.message}`);
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold text-white mb-8 text-center">Admin Panel</h1>
        
        {/* Problem Generation Form */}
        <Card className="bg-gray-800 border-gray-700 mb-8">
          <CardHeader>
            <CardTitle className="text-2xl text-white">Generate Problem</CardTitle>
            <CardDescription className="text-gray-400">
              Enter problem details to generate a reworded version with function signatures
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title" className="text-white">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Two Sum"
                className="bg-gray-700 border-gray-600 text-white placeholder:text-gray-400"
              />
            </div>

            {/* Difficulty */}
            <div className="space-y-2">
              <Label htmlFor="difficulty" className="text-white">Difficulty</Label>
              <Select value={difficulty} onValueChange={(value: any) => setDifficulty(value)}>
                <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-700 border-gray-600">
                  <SelectItem value="Easy" className="text-white hover:bg-gray-600">Easy</SelectItem>
                  <SelectItem value="Medium" className="text-white hover:bg-gray-600">Medium</SelectItem>
                  <SelectItem value="Hard" className="text-white hover:bg-gray-600">Hard</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Time Complexity */}
            <div className="space-y-2">
              <Label htmlFor="timeComplexity" className="text-white">Target Time Complexity (Required)</Label>
              <Select value={timeComplexity} onValueChange={setTimeComplexity}>
                <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-700 border-gray-600">
                  <SelectItem value="O(1)" className="text-white hover:bg-gray-600">O(1) - Constant</SelectItem>
                  <SelectItem value="O(log n)" className="text-white hover:bg-gray-600">O(log n) - Logarithmic</SelectItem>
                  <SelectItem value="O(n)" className="text-white hover:bg-gray-600">O(n) - Linear</SelectItem>
                  <SelectItem value="O(n log n)" className="text-white hover:bg-gray-600">O(n log n) - Linearithmic</SelectItem>
                  <SelectItem value="O(n^2)" className="text-white hover:bg-gray-600">O(n²) - Quadratic</SelectItem>
                  <SelectItem value="O(n^3)" className="text-white hover:bg-gray-600">O(n³) - Cubic</SelectItem>
                  <SelectItem value="O(2^n)" className="text-white hover:bg-gray-600">O(2ⁿ) - Exponential</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description" className="text-white">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter problem description..."
                rows={4}
                className="bg-gray-700 border-gray-600 text-white placeholder:text-gray-400"
              />
            </div>

            {/* Examples */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <Label className="text-white">Examples</Label>
                <Button
                  type="button"
                  onClick={addExample}
                  variant="outline"
                  size="sm"
                  className="bg-gray-700 border-gray-600 text-white hover:bg-gray-600"
                >
                  Add Example
                </Button>
              </div>
              {examples.map((example, index) => (
                <div key={index} className="space-y-2 p-4 bg-gray-700 rounded-lg">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-white font-semibold">Example {index + 1}</span>
                    {examples.length > 1 && (
                      <Button
                        type="button"
                        onClick={() => removeExample(index)}
                        variant="destructive"
                        size="sm"
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Input
                      value={example.input}
                      onChange={(e) => updateExample(index, 'input', e.target.value)}
                      placeholder="Input: e.g., nums = [2,7,11,15], target = 9"
                      className="bg-gray-600 border-gray-500 text-white placeholder:text-gray-400"
                    />
                    <Input
                      value={example.output}
                      onChange={(e) => updateExample(index, 'output', e.target.value)}
                      placeholder="Output: e.g., [0,1]"
                      className="bg-gray-600 border-gray-500 text-white placeholder:text-gray-400"
                    />
                    <Input
                      value={example.explanation}
                      onChange={(e) => updateExample(index, 'explanation', e.target.value)}
                      placeholder="Explanation (optional)"
                      className="bg-gray-600 border-gray-500 text-white placeholder:text-gray-400"
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Constraints */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <Label className="text-white">Constraints</Label>
                <Button
                  type="button"
                  onClick={addConstraint}
                  variant="outline"
                  size="sm"
                  className="bg-gray-700 border-gray-600 text-white hover:bg-gray-600"
                >
                  Add Constraint
                </Button>
              </div>
              {constraints.map((constraint, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    value={constraint}
                    onChange={(e) => updateConstraint(index, e.target.value)}
                    placeholder="e.g., 2 <= nums.length <= 10^4"
                    className="bg-gray-700 border-gray-600 text-white placeholder:text-gray-400"
                  />
                  {constraints.length > 1 && (
                    <Button
                      type="button"
                      onClick={() => removeConstraint(index)}
                      variant="destructive"
                      size="sm"
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {/* Generate Button */}
            <div className="space-y-3">
              <Button
                onClick={handleGenerateProblem}
                disabled={isGenerating}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                size="lg"
              >
                {isGenerating ? 'Generating...' : 'Generate Problem'}
              </Button>
              
              {isGenerating && generationStep && (
                <p className="text-sm text-gray-400 text-center animate-pulse">
                  {generationStep}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Unverified Problems List */}
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="text-2xl text-white">Unverified Problems</CardTitle>
                <CardDescription className="text-gray-400">
                  Problems that need verification before they can be used in matches
                </CardDescription>
              </div>
              <Button
                onClick={loadUnverifiedProblems}
                disabled={loadingProblems}
                variant="outline"
                className="bg-gray-700 border-gray-600 text-white hover:bg-gray-600"
              >
                {loadingProblems ? 'Loading...' : 'Refresh'}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingProblems ? (
              <div className="text-center py-8">
                <p className="text-gray-400">Loading unverified problems...</p>
              </div>
            ) : unverifiedProblems.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-400">No unverified problems found. Generate a new problem above!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {unverifiedProblems.map((problem) => (
                  <Card key={problem._id} className="bg-gray-700 border-gray-600">
                    <CardContent className="p-4">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="text-lg font-semibold text-white">{problem.title}</h3>
                            <Badge variant="secondary" className="bg-gray-600 text-white">
                              {problem.difficulty}
                            </Badge>
                            {problem.timeComplexity && (
                              <Badge variant="outline" className="border-blue-500 text-blue-300">
                                {problem.timeComplexity}
                              </Badge>
                            )}
                            {problem.topics && problem.topics.length > 0 && (
                              <Badge variant="outline" className="border-gray-500 text-gray-300">
                                {problem.topics.join(', ')}
                              </Badge>
                            )}
                          </div>
                          <p className="text-gray-300 text-sm mb-2">{problem.description}</p>
                          {problem.signature && (
                            <div className="text-sm text-gray-400 mb-2">
                              <span className="font-mono">
                                {problem.signature.functionName}(
                                {problem.signature.parameters.map((p, i) => 
                                  `${p.name}: ${p.type}${i < problem.signature!.parameters.length - 1 ? ', ' : ''}`
                                ).join('')}
                                ) → {problem.signature.returnType}
                              </span>
                            </div>
                          )}
                          <div className="flex gap-2 text-xs text-gray-400">
                            <span>Created: {new Date(problem.createdAt).toLocaleDateString()}</span>
                            {problem.testCases && (
                              <span>• {problem.testCases.length} test cases</span>
                            )}
                            {problem.solutions && (
                              <span>• {Object.keys(problem.solutions).length} solutions</span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2 ml-4">
                          <Button
                            onClick={() => handleEditProblem(problem._id)}
                            variant="outline"
                            className="bg-gray-600 hover:bg-gray-500 text-white border-gray-500"
                            size="sm"
                          >
                            Edit
                          </Button>
                          <Button
                            onClick={() => handleVerifyProblem(problem._id)}
                            disabled={isVerifying}
                            className="bg-green-600 hover:bg-green-700 text-white"
                            size="sm"
                          >
                            {isVerifying ? 'Verifying...' : 'Verify'}
                          </Button>
                        </div>
                      </div>
                      
                      {/* Show examples */}
                      {problem.examples && problem.examples.length > 0 && (
                        <div className="mt-3">
                          <h4 className="text-sm font-medium text-gray-300 mb-2">Examples:</h4>
                          <div className="space-y-1">
                            {problem.examples.slice(0, 2).map((example, idx) => (
                              <div key={idx} className="text-xs text-gray-400">
                                <span className="text-gray-500">Input:</span> {example.input} | 
                                <span className="text-gray-500 ml-1">Output:</span> {example.output}
                              </div>
                            ))}
                            {problem.examples.length > 2 && (
                              <div className="text-xs text-gray-500">
                                +{problem.examples.length - 2} more examples...
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {/* Show verification errors if present */}
                      {problem.verificationError && problem.verificationError.length > 0 && (
                        <div className="mt-3 p-3 bg-red-900/30 border border-red-700 rounded">
                          <h4 className="text-sm font-medium text-red-400 mb-2">⚠️ Verification Failed:</h4>
                          <div className="space-y-1">
                            {problem.verificationError.map((error, idx) => (
                              <div key={idx} className="text-xs text-red-300">
                                • {error}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* Show failed test cases summary */}
                      {problem.failedTestCases && Object.keys(problem.failedTestCases).length > 0 && (
                        <div className="mt-3">
                          <h4 className="text-sm font-medium text-gray-300 mb-2">Failed Tests Summary:</h4>
                          <div className="grid grid-cols-4 gap-2 text-xs">
                            {Object.entries(problem.failedTestCases).map(([lang, tests]) => (
                              <div key={lang} className="p-2 rounded bg-red-900/30 border border-red-700">
                                <div className="font-medium capitalize text-red-400">{lang}</div>
                                <div className="text-red-300">
                                  {tests.length} test{tests.length > 1 ? 's' : ''} failed
                                </div>
                                <div className="mt-1 text-red-300">
                                  #{tests.map(t => t.testNumber).join(', #')}
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="mt-2 text-xs text-gray-400">
                            💡 Click &quot;Edit&quot; to see details and fix the test cases
                          </div>
                        </div>
                      )}
                      
                      {/* Show verification results details if present and all passed */}
                      {problem.verificationResults && !problem.failedTestCases && (
                        <div className="mt-3">
                          <h4 className="text-sm font-medium text-gray-300 mb-2">Verification Details:</h4>
                          <div className="grid grid-cols-4 gap-2 text-xs">
                            {Object.entries(problem.verificationResults).map(([lang, result]: [string, any]) => (
                              <div key={lang} className={`p-2 rounded ${result.allPassed ? 'bg-green-900/30 border border-green-700' : 'bg-red-900/30 border border-red-700'}`}>
                                <div className="font-medium capitalize">{lang}</div>
                                <div className={result.allPassed ? 'text-green-400' : 'text-red-400'}>
                                  {result.passedTests}/{result.totalTests} passed
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Reset Player Data Section */}
        <Card className="bg-gray-800 border-gray-700 mt-8">
          <CardHeader>
            <CardTitle className="text-2xl text-white">⚠️ Danger Zone</CardTitle>
            <CardDescription className="text-gray-400">
              Destructive actions that cannot be undone
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="p-4 bg-red-900/20 border border-red-700 rounded-lg">
              <h3 className="text-lg font-semibold text-red-400 mb-2">Reset All Player Data</h3>
              <p className="text-sm text-gray-300 mb-4">
                This will permanently delete all matches and submissions, reset all user stats to default values, and clear all Redis cache data. 
                User accounts, login information, and profile details will be preserved.
              </p>
              <div className="space-y-2 text-xs text-gray-400 mb-4">
                <div>• All matches will be deleted</div>
                <div>• All submissions will be deleted</div>
                <div>• User stats (wins, losses, rating) will be reset to defaults</div>
                <div>• Avatars and bios will be cleared</div>
                <div>• All Redis data (queues, active matches, user cache) will be cleared</div>
                <div>• User login credentials will remain intact</div>
              </div>
              <Button
                onClick={() => setResetDialogOpen(true)}
                variant="destructive"
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                Reset All Player Data
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Reset Confirmation Dialog */}
        <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
          <DialogContent className="bg-gray-800 border-gray-700 text-white">
            <DialogHeader>
              <DialogTitle className="text-2xl text-red-400">⚠️ Confirm Reset</DialogTitle>
              <DialogDescription className="text-gray-300">
                This action cannot be undone. Are you absolutely sure?
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 mt-4">
              <div className="p-4 bg-red-900/30 border border-red-700 rounded">
                <p className="text-white font-semibold mb-2">This will permanently:</p>
                <ul className="text-sm text-gray-300 space-y-1">
                  <li>✓ Delete ALL match history</li>
                  <li>✓ Delete ALL code submissions</li>
                  <li>✓ Reset ALL user statistics</li>
                  <li>✓ Clear ALL user avatars and bios</li>
                  <li>✓ Clear ALL Redis data (queues, matches, cache)</li>
                </ul>
              </div>
              
              <div className="p-4 bg-green-900/30 border border-green-700 rounded">
                <p className="text-white font-semibold mb-2">This will preserve:</p>
                <ul className="text-sm text-gray-300 space-y-1">
                  <li>✓ User accounts and login credentials</li>
                  <li>✓ User profile names</li>
                  <li>✓ Problem database</li>
                </ul>
              </div>

              <div className="flex gap-3 justify-end mt-6">
                <Button
                  onClick={() => setResetDialogOpen(false)}
                  variant="outline"
                  className="bg-gray-700 border-gray-600 text-white hover:bg-gray-600"
                  disabled={isResetting}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleResetAllData}
                  disabled={isResetting}
                  variant="destructive"
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  {isResetting ? 'Resetting...' : 'Yes, Reset All Data'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Edit Problem Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="bg-gray-800 border-gray-700 text-white max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-2xl">Edit Problem: {editingProblem?.title}</DialogTitle>
              <DialogDescription className="text-gray-400">
                Fix failed test cases or update solutions. Changes are saved immediately.
              </DialogDescription>
            </DialogHeader>
            
            {editingProblem && (
              <div className="space-y-6 mt-4">
                {/* Show failed test cases */}
                {editingProblem.failedTestCases && Object.keys(editingProblem.failedTestCases).length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-white">❌ Failed Test Cases</h3>
                    {Object.entries(editingProblem.failedTestCases).map(([lang, tests]) => (
                      <div key={lang} className="bg-gray-700 p-3 rounded">
                        <h4 className="font-medium capitalize text-red-400 mb-2">
                          {lang} - {tests.length} failed test{tests.length > 1 ? 's' : ''}
                        </h4>
                        <div className="space-y-2">
                          {tests.map((test, idx) => (
                            <div key={idx} className="bg-gray-800 p-2 rounded text-xs">
                              <div className="font-medium text-gray-300">Test #{test.testNumber}</div>
                              <div className="text-gray-400">
                                Input: {JSON.stringify(test.input)}
                              </div>
                              <div className="text-gray-400">
                                Expected: {JSON.stringify(test.expected)}
                              </div>
                              <div className="text-red-400">
                                Got: {JSON.stringify(test.actual)}
                              </div>
                              {test.error && (
                                <div className="text-red-300 mt-1">
                                  Error: {test.error}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Edit Test Cases */}
                <div className="space-y-3">
                  <h3 className="text-lg font-semibold text-white">Test Cases (JSON)</h3>
                  <Textarea
                    value={JSON.stringify(editingProblem.testCases, null, 2)}
                    onChange={(e) => {
                      try {
                        const parsed = JSON.parse(e.target.value);
                        setEditingProblem({ ...editingProblem, testCases: parsed });
                      } catch (err) {
                        // Invalid JSON, don't update
                      }
                    }}
                    rows={15}
                    className="font-mono text-xs bg-gray-700 border-gray-600 text-white"
                  />
                </div>
                
                {/* Edit Solutions */}
                {editingProblem.solutions && (
                  <div className="space-y-3">
                    <h3 className="text-lg font-semibold text-white">Solutions</h3>
                    {Object.entries(editingProblem.solutions).map(([lang, code]) => (
                      <div key={lang} className="space-y-2">
                        <Label className="text-white capitalize">{lang}</Label>
                        <Textarea
                          value={code || ''}
                          onChange={(e) => {
                            setEditingProblem({
                              ...editingProblem,
                              solutions: {
                                ...editingProblem.solutions,
                                [lang]: e.target.value,
                              }
                            });
                          }}
                          rows={10}
                          className="font-mono text-xs bg-gray-700 border-gray-600 text-white"
                        />
                      </div>
                    ))}
                  </div>
                )}
                
                <div className="flex gap-3 justify-end">
                  <Button
                    onClick={() => {
                      setEditDialogOpen(false);
                      setEditingProblem(null);
                    }}
                    variant="outline"
                    className="bg-gray-700 border-gray-600 text-white hover:bg-gray-600"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveEdits}
                    disabled={isSaving}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

