import React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MonacoEditor } from '@/components/ui/monaco-editor';
import { Trash2 } from 'lucide-react';
import type { AdminProblem } from '@/types/admin';
import type { SpecialInputConfig } from '@/types/db';

interface EditProblemDialogProps {
  isOpen: boolean;
  editingProblem: AdminProblem | null;
  editingSolutions: Record<string, string>;
  isSaving: boolean;
  deletingProblemId: string | null;
  onClose: () => void;
  onSave: () => void;
  onDelete: (problemId: string) => void;
  onProblemChange: (problem: AdminProblem) => void;
  onSolutionsChange: (solutions: Record<string, string>) => void;
}

export function EditProblemDialog({
  isOpen,
  editingProblem,
  editingSolutions,
  isSaving,
  deletingProblemId,
  onClose,
  onSave,
  onDelete,
  onProblemChange,
  onSolutionsChange,
}: EditProblemDialogProps) {
  if (!editingProblem) return null;

  const listNodeParameters = editingProblem.signature?.parameters?.filter((param) =>
    param.type.toLowerCase().includes('listnode')
  ) ?? [];

  const linkedListCycleConfigs = (editingProblem.specialInputs || []).filter(
    (config) => config.type === 'linked_list_cycle'
  );

  const isLinkedListCycleEnabled = (paramName: string) =>
    linkedListCycleConfigs.some((config) =>
      config.targets?.some((target) => target.parameter === paramName)
    );

  const toggleLinkedListCycle = (paramName: string, enabled: boolean) => {
    const configId = `linked_list_cycle:${paramName}`;
    const currentConfigs = editingProblem.specialInputs || [];
    const exists = currentConfigs.some((config) => config.id === configId);

    if (enabled) {
      if (exists) return;

      const newConfig: SpecialInputConfig = {
        id: configId,
        type: 'linked_list_cycle',
        label: `Cycle for ${paramName}`,
        description: 'Attach the tail of the linked list to the given index',
        targets: [
          {
            parameter: paramName,
            role: 'input',
          },
        ],
      };

      onProblemChange({
        ...editingProblem,
        specialInputs: [...currentConfigs, newConfig],
      });
      return;
    }

    if (!exists) return;

    const updatedConfigs = currentConfigs.filter((config) => config.id !== configId);
    const updatedTestCases = (editingProblem.testCases || []).map((testCase) => {
      if (!testCase.specialInputData || !(configId in testCase.specialInputData)) {
        return testCase;
      }

      const { [configId]: _removed, ...rest } = testCase.specialInputData;
      return {
        ...testCase,
        specialInputData: Object.keys(rest).length > 0 ? rest : undefined,
      };
    });

    onProblemChange({
      ...editingProblem,
      specialInputs: updatedConfigs.length > 0 ? updatedConfigs : undefined,
      testCases: updatedTestCases,
    });
  };

  const handleCycleInputChange = (testIndex: number, configId: string, rawValue: string) => {
    if (!editingProblem.testCases) return;

    const updatedTestCases = [...editingProblem.testCases];
    const existingTestCase = updatedTestCases[testIndex];
    if (!existingTestCase) return;

    const specialInputData = { ...(existingTestCase.specialInputData || {}) };

    if (rawValue.trim() === '') {
      if (specialInputData[configId]) {
        delete specialInputData[configId];
      }
    } else {
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed)) return;

      const normalized = Math.trunc(parsed);
      specialInputData[configId] = {
        ...(specialInputData[configId] || {}),
        cycleIndex: normalized,
      };
    }

    updatedTestCases[testIndex] = {
      ...existingTestCase,
      specialInputData: Object.keys(specialInputData).length > 0 ? specialInputData : undefined,
    };

    onProblemChange({
      ...editingProblem,
      testCases: updatedTestCases,
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto bg-white border-blue-200">
        <DialogHeader>
          <DialogTitle className="text-black">Edit Problem</DialogTitle>
          <DialogDescription className="text-black/70">
            Modify test cases and solutions for this problem
          </DialogDescription>
        </DialogHeader>
        
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
                    onProblemChange({
                      ...editingProblem,
                      signature: {
                        ...editingProblem.signature!,
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
                      onProblemChange({
                        ...editingProblem,
                        signature: {
                          ...editingProblem.signature!,
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

          {(listNodeParameters.length > 0 || linkedListCycleConfigs.length > 0) && (
            <div className="space-y-3 border border-blue-200 rounded-lg p-4 bg-blue-50">
              <h3 className="text-lg font-semibold text-black">Special Input Metadata</h3>
              <p className="text-sm text-black/70">
                Enable special handling for linked list parameters. When enabled, you can specify the zero-based index that the tail should connect to (LeetCode&apos;s <code className="bg-blue-100 px-1 py-0.5 rounded">pos</code> field) in each test case.
              </p>
              {listNodeParameters.length > 0 ? (
                <div className="space-y-2">
                  {listNodeParameters.map((param) => {
                    const checked = isLinkedListCycleEnabled(param.name);
                    return (
                      <label
                        key={param.name}
                        className="flex items-center gap-2 text-sm text-black"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={checked}
                          onChange={(event) => toggleLinkedListCycle(param.name, event.target.checked)}
                        />
                        <span>
                          Attach cycle metadata for <code className="bg-blue-100 px-1 py-0.5 rounded">{param.name}</code>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-black/70">
                  No linked list parameters detected in the current signature. Existing special inputs will still be saved.
                </p>
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
                        onProblemChange({ ...editingProblem, testCases: updated });
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
                            onProblemChange({ ...editingProblem, testCases: updated });
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
                            onProblemChange({ ...editingProblem, testCases: updated });
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
                  {linkedListCycleConfigs.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <Label className="text-black/70 text-sm">Special Inputs</Label>
                      {linkedListCycleConfigs.map((config) => {
                        const targetNames = config.targets?.map((target) => target.parameter).join(', ') || config.label || config.id;
                        const data = testCase.specialInputData?.[config.id] as { cycleIndex?: number } | undefined;
                        const value = typeof data?.cycleIndex === 'number' ? String(data.cycleIndex) : '';
                        return (
                          <div key={config.id} className="flex items-center gap-3">
                            <span className="text-sm text-black/70 w-60">
                              Cycle index for <code className="bg-blue-100 px-1 py-0.5 rounded">{targetNames}</code>
                            </span>
                            <Input
                              value={value}
                              onChange={(event) => handleCycleInputChange(index, config.id, event.target.value)}
                              placeholder="e.g. 1"
                              className="bg-white border-blue-200 text-black w-28"
                            />
                          </div>
                        );
                      })}
                      <p className="text-xs text-black/60">
                        Leave blank (or use -1) for no cycle. Values are zero-based.
                      </p>
                    </div>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const newTestCase = { input: {}, output: null };
                  onProblemChange({
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
                        onSolutionsChange({
                          ...editingSolutions,
                          [lang]: newValue
                        });
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
            {editingProblem && (
              <Button
                onClick={() => onDelete(editingProblem._id)}
                variant="outline"
                className="border-red-500 text-red-600 hover:bg-red-50"
                disabled={deletingProblemId === editingProblem._id}
              >
                {deletingProblemId === editingProblem._id ? (
                  'Deleting...'
                ) : (
                  <span className="flex items-center gap-1">
                    <Trash2 className="h-4 w-4" />
                    Delete Problem
                  </span>
                )}
              </Button>
            )}
            <Button
              onClick={onClose}
              variant="outline"
              className="bg-white border-blue-200 text-black hover:bg-blue-50"
            >
              Cancel
            </Button>
            <Button
              onClick={onSave}
              disabled={isSaving}
              className="text-white"
              style={{ backgroundColor: '#2599D4' }}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

