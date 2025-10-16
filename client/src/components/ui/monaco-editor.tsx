'use client';

import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import { codeClashTheme } from '@/themes/codeClashTheme';

interface MonacoEditorProps {
  value: string;
  language: string;
  height?: string;
  className?: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
}

export function MonacoEditor({ 
  value, 
  language, 
  height = '300px',
  className = '',
  onChange,
  readOnly = false
}: MonacoEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const monacoEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    if (!editorRef.current) return;

    // Register the custom theme
    monaco.editor.defineTheme('codeclash', codeClashTheme);

    // Create the editor
    const editor = monaco.editor.create(editorRef.current, {
      value,
      language,
      theme: 'codeclash',
      readOnly,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      lineNumbers: 'on',
      folding: true,
      lineDecorationsWidth: 0,
      lineNumbersMinChars: 0,
      renderLineHighlight: 'line',
      cursorStyle: 'line',
      selectOnLineNumbers: true,
      glyphMargin: false,
      contextmenu: true,
      mouseWheelZoom: true,
      scrollbar: {
        vertical: 'auto',
        horizontal: 'auto',
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
      },
      automaticLayout: true,
    });

    monacoEditorRef.current = editor;

    // Handle content changes
    if (onChange) {
      editor.onDidChangeModelContent(() => {
        const newValue = editor.getValue();
        onChange(newValue);
      });
    }

    return () => {
      editor.dispose();
    };
  }, []);

  useEffect(() => {
    if (monacoEditorRef.current && monacoEditorRef.current.getValue() !== value) {
      monacoEditorRef.current.setValue(value);
    }
  }, [value]);

  useEffect(() => {
    if (monacoEditorRef.current) {
      monaco.editor.setModelLanguage(monacoEditorRef.current.getModel()!, language);
    }
  }, [language]);

  useEffect(() => {
    if (monacoEditorRef.current) {
      monacoEditorRef.current.updateOptions({ readOnly });
    }
  }, [readOnly]);

  return (
    <div 
      ref={editorRef} 
      style={{ height }}
      className={`border border-gray-600 rounded ${className}`}
    />
  );
}
