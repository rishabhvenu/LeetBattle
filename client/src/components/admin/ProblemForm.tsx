import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus } from 'lucide-react';
import type { ProblemExample, Difficulty, SpecialInputHint, SpecialInputCategory } from '@/types/admin';

interface ProblemFormProps {
  title: string;
  difficulty: Difficulty;
  description: string;
  examples: ProblemExample[];
  constraints: string[];
  timeComplexity: string;
  leetcodeUrl: string;
  isGenerating: boolean;
  generationStep: string;
  isAutofilling: boolean;
  onTitleChange: (value: string) => void;
  onDifficultyChange: (value: Difficulty) => void;
  onDescriptionChange: (value: string) => void;
  onExamplesChange: (examples: ProblemExample[]) => void;
  onConstraintsChange: (constraints: string[]) => void;
  onTimeComplexityChange: (value: string) => void;
  onLeetcodeUrlChange: (value: string) => void;
  onGenerate: () => void;
  onAutofill: () => void;
  onAddExample: () => void;
  onRemoveExample: (index: number) => void;
  onUpdateExample: (index: number, field: keyof ProblemExample, value: string) => void;
  onAddConstraint: () => void;
  onRemoveConstraint: (index: number) => void;
  onUpdateConstraint: (index: number, value: string) => void;
  specialInputHint: SpecialInputHint;
  onSpecialInputHintChange: (hint: SpecialInputHint) => void;
}

export function ProblemForm({
  title,
  difficulty,
  description,
  examples,
  constraints,
  timeComplexity,
  leetcodeUrl,
  isGenerating,
  generationStep,
  isAutofilling,
  onTitleChange,
  onDifficultyChange,
  onDescriptionChange,
  onExamplesChange,
  onConstraintsChange,
  onTimeComplexityChange,
  onLeetcodeUrlChange,
  onGenerate,
  onAutofill,
  onAddExample,
  onRemoveExample,
  onUpdateExample,
  onAddConstraint,
  onRemoveConstraint,
  onUpdateConstraint,
  specialInputHint,
  onSpecialInputHintChange,
}: ProblemFormProps) {
  return (
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
        <div className="space-y-2">
          <Label htmlFor="leetcodeUrl" className="text-black">LeetCode Problem URL</Label>
          <div className="flex flex-col md:flex-row gap-3">
            <Input
              id="leetcodeUrl"
              value={leetcodeUrl}
              onChange={(e) => onLeetcodeUrlChange(e.target.value)}
              placeholder="https://leetcode.com/problems/two-sum"
              className="bg-white border-blue-200 text-black flex-1"
            />
            <Button
              type="button"
              onClick={onAutofill}
              disabled={isAutofilling}
              className="text-white md:w-auto"
              style={{ backgroundColor: '#2599D4' }}
            >
              {isAutofilling ? 'Loading...' : 'Autofill from LeetCode'}
            </Button>
          </div>
        </div>

        <div>
          <Label htmlFor="title" className="text-black">Problem Title</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Enter problem title"
            className="bg-white border-blue-200 text-black"
          />
        </div>

        <div>
          <Label htmlFor="difficulty" className="text-black">Difficulty</Label>
          <Select value={difficulty} onValueChange={onDifficultyChange}>
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
            onChange={(e) => onDescriptionChange(e.target.value)}
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
                      onClick={() => onRemoveExample(index)}
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
                      onChange={(e) => onUpdateExample(index, 'input', e.target.value)}
                      placeholder="Input example"
                      className="bg-white border-blue-200 text-black text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-black/70 text-sm">Output</Label>
                    <Textarea
                      value={example.output}
                      onChange={(e) => onUpdateExample(index, 'output', e.target.value)}
                      placeholder="Expected output"
                      className="bg-white border-blue-200 text-black text-sm"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-black/70 text-sm">Explanation (Optional)</Label>
                  <Textarea
                    value={example.explanation}
                    onChange={(e) => onUpdateExample(index, 'explanation', e.target.value)}
                    placeholder="Explain the example..."
                    className="bg-white border-blue-200 text-black text-sm"
                  />
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={onAddExample}
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
                  onChange={(e) => onUpdateConstraint(index, e.target.value)}
                  placeholder="Enter constraint"
                  className="bg-white border-blue-200 text-black"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onRemoveConstraint(index)}
                  className="text-red-600 border-red-500 hover:bg-red-50"
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={onAddConstraint}
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
            onChange={(e) => onTimeComplexityChange(e.target.value)}
            placeholder="e.g., O(n), O(n log n), O(n²), O(2ⁿ)"
            className="bg-white border-blue-200 text-black"
          />
        </div>

        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
          <Label className="text-black font-semibold">Special Input Metadata</Label>
          <p className="text-sm text-black/70">
            Choose extra metadata the runner should use when constructing inputs.
          </p>

          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="flex-1">
              <Label className="text-black/70 text-sm">Category</Label>
              <Select
                value={specialInputHint.type}
                onValueChange={(value: SpecialInputCategory) =>
                  onSpecialInputHintChange({ ...specialInputHint, type: value })
                }
              >
                <SelectTrigger className="bg-white border-blue-200 text-black">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="linked_list_cycle">Linked list cycle</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {specialInputHint.type === 'linked_list_cycle' && (
              <div>
                <Label className="text-black/70 text-sm">List parameter name</Label>
                <Input
                  value={specialInputHint.parameterName}
                  onChange={(e) =>
                    onSpecialInputHintChange({
                      ...specialInputHint,
                      parameterName: e.target.value.trim() || 'head',
                    })
                  }
                  className="bg-white border-blue-200 text-black text-sm w-28"
                />
              </div>
            )}
          </div>
        </div>

        <Button
          onClick={onGenerate}
          disabled={isGenerating}
          className="w-full text-white"
          style={{ backgroundColor: '#2599D4' }}
        >
          {isGenerating ? generationStep : 'Generate Problem'}
        </Button>
      </CardContent>
    </Card>
  );
}

