'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'react-toastify';
import { FileText } from 'lucide-react';
import { generateProblem, verifyProblemSolutions, getUnverifiedProblems, getVerifiedProblems, getProblemById, updateProblem, deleteProblem, fetchLeetCodeProblemDetails } from '@/lib/actions';
import type { ProblemExample, AdminProblem, Difficulty, SpecialInputHint } from '@/types/admin';
import { ProblemForm } from '@/components/admin/ProblemForm';
import { ProblemList } from '@/components/admin/ProblemList';
import { EditProblemDialog } from '@/components/admin/EditProblemDialog';

export default function ProblemManagement() {
  const [title, setTitle] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('Easy');
  const [description, setDescription] = useState('');
  const [examples, setExamples] = useState<ProblemExample[]>([
    { input: '', output: '', explanation: '' },
  ]);
  const [constraints, setConstraints] = useState<string[]>(['']);
  const [timeComplexity, setTimeComplexity] = useState('O(n)');
  const [leetcodeUrl, setLeetcodeUrl] = useState('');
  const [isAutofilling, setIsAutofilling] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStep, setGenerationStep] = useState<string>('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [unverifiedProblems, setUnverifiedProblems] = useState<AdminProblem[]>([]);
  const [loadingProblems, setLoadingProblems] = useState(true);
  const [verifiedProblems, setVerifiedProblems] = useState<AdminProblem[]>([]);
  const [loadingVerified, setLoadingVerified] = useState(true);
  const [editingProblem, setEditingProblem] = useState<AdminProblem | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingSolutions, setEditingSolutions] = useState<Record<string, string>>({});
  const [deletingProblemId, setDeletingProblemId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const [specialInputHint, setSpecialInputHint] = useState<SpecialInputHint>({
    type: 'none',
    parameterName: 'head',
  });

  const handleEditDialogChange = (open: boolean) => {
    setEditDialogOpen(open);
    if (!open) {
      setEditingProblem(null);
      setEditingSolutions({});
    }
  };

  // Handle mounting to prevent hydration issues
  useEffect(() => {
    setMounted(true);
  }, []);

  // Load unverified problems on component mount
  useEffect(() => {
    if (mounted) {
      loadUnverifiedProblems();
      loadVerifiedProblems();
    }
  }, [mounted]);

  const loadUnverifiedProblems = async () => {
    try {
      setLoadingProblems(true);
      const problems = await getUnverifiedProblems();
      setUnverifiedProblems(Array.isArray(problems) ? (problems as AdminProblem[]) : []);
    } catch (error) {
      console.error('Error loading unverified problems:', error);
      toast.error('Failed to load unverified problems');
    } finally {
      setLoadingProblems(false);
    }
  };

  const loadVerifiedProblems = async () => {
    try {
      setLoadingVerified(true);
      const problems = await getVerifiedProblems();
      setVerifiedProblems(Array.isArray(problems) ? (problems as AdminProblem[]) : []);
    } catch (error) {
      console.error('Error loading verified problems:', error);
      toast.error('Failed to load verified problems');
    } finally {
      setLoadingVerified(false);
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
        specialInputHint,
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
        toast.error('error' in result ? result.error : 'Failed to generate problem');
      }
    } catch (error) {
      console.error('Error generating problem:', error);
      toast.error('Failed to generate problem');
    } finally {
      setIsGenerating(false);
      setGenerationStep('');
    }
  };

  const handleAutofillFromLeetCode = async () => {
    const trimmedUrl = leetcodeUrl.trim();
    if (!trimmedUrl) {
      toast.error('Please enter a LeetCode problem URL');
      return;
    }

    if (trimmedUrl !== leetcodeUrl) {
      setLeetcodeUrl(trimmedUrl);
    }

    setIsAutofilling(true);

    try {
      const result = await fetchLeetCodeProblemDetails(trimmedUrl);

      if (!result?.success || !result.details) {
        toast.error(result?.error || 'Failed to fetch LeetCode problem details');
        return;
      }

      const { details } = result;

      if (details.title) {
        setTitle(details.title);
      }

      if (details.difficulty) {
        setDifficulty(details.difficulty);
      }

      setDescription(details.description || '');
      setConstraints(details.constraints.length > 0 ? [...details.constraints] : ['']);

      const mappedExamples =
        details.examples.length > 0
          ? details.examples.map(example => ({
              input: example.input ?? '',
              output: example.output ?? '',
              explanation: example.explanation ?? '',
            }))
          : [{ input: '', output: '', explanation: '' }];

      setExamples(mappedExamples);

      toast.success('LeetCode problem details loaded');
    } catch (error) {
      console.error('Error autofilling from LeetCode:', error);
      toast.error('Failed to fetch LeetCode problem details');
    } finally {
      setIsAutofilling(false);
    }
  };

  const handleVerify = async (problemId: string) => {
    setIsVerifying(true);
    try {
      const result = await verifyProblemSolutions(problemId);
      if (result.success) {
        toast.success('Problem verified successfully!');
        loadUnverifiedProblems();
        loadVerifiedProblems();
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
      const fullProblem = problem as AdminProblem;
      setEditingProblem(fullProblem);
      setEditingSolutions(fullProblem.solutions || {});
      setEditDialogOpen(true);
    } else {
      toast.error('Failed to load problem for editing');
    }
  };

  const handleDeleteProblem = async (problemId: string) => {
    const confirmed = window.confirm('Delete this problem permanently? This cannot be undone.');
    if (!confirmed) {
      return;
    }

    setDeletingProblemId(problemId);
    try {
      const result = await deleteProblem(problemId);
      if (result.success) {
        toast.success('Problem deleted successfully');
        if (editingProblem?._id === problemId) {
          handleEditDialogChange(false);
        }
        await Promise.all([loadUnverifiedProblems(), loadVerifiedProblems()]);
      } else {
        toast.error(result.error || 'Failed to delete problem');
      }
    } catch (error) {
      console.error('Error deleting problem:', error);
      toast.error('Failed to delete problem');
    } finally {
      setDeletingProblemId(null);
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
        specialInputs: editingProblem.specialInputs,
      });
      if (result.success) {
        toast.success('Problem updated successfully!');
        await Promise.all([loadUnverifiedProblems(), loadVerifiedProblems()]);
        handleEditDialogChange(false);
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
        <ProblemForm
          title={title}
          difficulty={difficulty}
          description={description}
          examples={examples}
          constraints={constraints}
          timeComplexity={timeComplexity}
          leetcodeUrl={leetcodeUrl}
          isGenerating={isGenerating}
          generationStep={generationStep}
          isAutofilling={isAutofilling}
          onTitleChange={setTitle}
          onDifficultyChange={setDifficulty}
          onDescriptionChange={setDescription}
          onExamplesChange={setExamples}
          onConstraintsChange={setConstraints}
          onTimeComplexityChange={setTimeComplexity}
          onLeetcodeUrlChange={setLeetcodeUrl}
          onGenerate={handleGenerate}
          onAutofill={handleAutofillFromLeetCode}
          onAddExample={addExample}
          onRemoveExample={removeExample}
          onUpdateExample={updateExample}
          onAddConstraint={addConstraint}
          onRemoveConstraint={removeConstraint}
          onUpdateConstraint={updateConstraint}
          specialInputHint={specialInputHint}
          onSpecialInputHintChange={setSpecialInputHint}
        />

        <ProblemList
          title="Unverified Problems"
          description="Problems that need verification before being used in matches"
          problems={unverifiedProblems}
          loading={loadingProblems}
          isVerifying={isVerifying}
          deletingProblemId={deletingProblemId}
          variant="unverified"
          onVerify={handleVerify}
          onEdit={handleEditProblem}
          onDelete={handleDeleteProblem}
        />

        <ProblemList
          title="Verified Problems"
          description="Published problems that are currently available for matches"
          problems={verifiedProblems}
          loading={loadingVerified}
          isVerifying={false}
          deletingProblemId={deletingProblemId}
          variant="verified"
          onEdit={handleEditProblem}
          onDelete={handleDeleteProblem}
        />
      </div>

      <EditProblemDialog
        isOpen={editDialogOpen}
        editingProblem={editingProblem}
        editingSolutions={editingSolutions}
        isSaving={isSaving}
        deletingProblemId={deletingProblemId}
        onClose={() => handleEditDialogChange(false)}
        onSave={handleSaveEdits}
        onDelete={handleDeleteProblem}
        onProblemChange={setEditingProblem}
        onSolutionsChange={setEditingSolutions}
      />
    </div>
  );
}

