/**
 * Special Input Framework
 * Normalizes problem test cases that require pre-execution preparation (e.g., linked list cycles)
 */

export type SpecialInputType = 'linked_list_cycle';

export interface SpecialInputConfig {
  id: string;
  type: SpecialInputType;
  label?: string;
  description?: string;
  targets: Array<{
    parameter: string;
    role?: 'input' | 'output';
  }>;
  options?: Record<string, unknown>;
}

export interface ProblemTestCase {
  input: Record<string, unknown>;
  output: unknown;
  specialInputData?: Record<string, any>;
  runtimeSpecialInputs?: RuntimeSpecialInput[];
}

export interface RuntimeSpecialInput {
  type: SpecialInputType;
  configId: string;
  targets: Array<{
    parameter: string;
    cycleIndex: number;
  }>;
}

interface SpecialInputHandlerContext {
  config: SpecialInputConfig;
  data: Record<string, unknown> | undefined;
  testCase: ProblemTestCase;
  testCaseIndex: number;
}

type SpecialInputHandler = (ctx: SpecialInputHandlerContext) => RuntimeSpecialInput | null;

const handlerRegistry: Record<SpecialInputType, SpecialInputHandler> = {
  linked_list_cycle: linkedListCycleHandler,
};

/**
 * Prepare problem test cases by applying registered special-input handlers.
 */
export function prepareTestCasesForExecution(
  testCases: ProblemTestCase[] = [],
  configs: SpecialInputConfig[] = []
): ProblemTestCase[] {
  if (!Array.isArray(testCases) || testCases.length === 0) {
    return testCases ?? [];
  }

  const applicableConfigs = Array.isArray(configs) ? configs : [];

  return testCases.map((testCase, index) => {
    const legacyData =
      testCase && typeof (testCase as any).specialInputs === 'object'
        ? (testCase as any).specialInputs
        : undefined;

    const specialInputsRaw =
      testCase && typeof testCase.specialInputData === 'object' && testCase.specialInputData
        ? testCase.specialInputData
        : legacyData && typeof legacyData === 'object'
        ? legacyData
        : {};

    const normalizedSpecialInputs: Record<string, any> = { ...specialInputsRaw };
    const runtimeSpecialInputs: RuntimeSpecialInput[] = [];

    for (const config of applicableConfigs) {
      const handler = handlerRegistry[config.type];
      if (!handler) {
        continue;
      }

      const configData = normalizedSpecialInputs[config.id] as Record<string, unknown> | undefined;
      const result = handler({
        config,
        data: configData,
        testCase,
        testCaseIndex: index,
      });

      if (result) {
        runtimeSpecialInputs.push(result);
      }
    }

    return {
      ...testCase,
      specialInputData: normalizedSpecialInputs,
      runtimeSpecialInputs: runtimeSpecialInputs.length > 0 ? runtimeSpecialInputs : undefined,
    };
  });
}

function linkedListCycleHandler({
  config,
  data,
}: SpecialInputHandlerContext): RuntimeSpecialInput | null {
  if (!config.targets || config.targets.length === 0) {
    return null;
  }

  const targets: Array<{ parameter: string; cycleIndex: number }> = [];
  const payload = normalizeRecord(data);

  for (const target of config.targets) {
    const cycleIndex = resolveCycleIndexForParameter(target.parameter, payload, config.targets.length);
    if (cycleIndex !== null && cycleIndex >= 0) {
      targets.push({ parameter: target.parameter, cycleIndex });
    }
  }

  if (targets.length === 0) {
    return null;
  }

  return {
    type: 'linked_list_cycle',
    configId: config.id,
    targets,
  };
}

function normalizeRecord(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return { ...value };
}

function resolveCycleIndexForParameter(
  parameter: string,
  data: Record<string, unknown>,
  targetCount: number
): number | null {
  const directValue = data[parameter];
  const fallbackValue =
    targetCount === 1 && typeof data.cycleIndex !== 'undefined' ? data.cycleIndex : undefined;

  const value = typeof directValue !== 'undefined' ? directValue : fallbackValue;
  return parseCycleIndex(value);
}

function parseCycleIndex(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }

  if (value && typeof value === 'object' && 'cycleIndex' in (value as Record<string, unknown>)) {
    return parseCycleIndex((value as Record<string, unknown>).cycleIndex);
  }

  return null;
}

