import { Brain, Code2, Timer } from 'lucide-react';
import type React from 'react';

export const languages = [
  { value: "javascript", label: "JavaScript" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "cpp", label: "C++" },
] as const;

export const difficultyConfig: Record<string, { color: string; bg: string; text: string; icon: React.ElementType }> = {
  easy: { color: "text-green-600", bg: "bg-green-100", text: "text-green-600", icon: Brain },
  medium: { color: "text-yellow-600", bg: "bg-yellow-100", text: "text-yellow-600", icon: Code2 },
  hard: { color: "text-red-600", bg: "bg-red-100", text: "text-red-600", icon: Timer },
};

