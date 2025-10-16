'use client';

import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import { codeClashTheme } from '@/themes/codeClashTheme';

interface MonacoReadOnlyProps {
  value: string;
  language: string;
  height?: string;
  className?: string;
}

export function MonacoReadOnly({ 
  value, 
  language, 
  height = '200px',
  className = ''
}: MonacoReadOnlyProps) {
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
      readOnly: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      lineNumbers: 'on',
      folding: true,
      lineDecorationsWidth: 0,
      lineNumbersMinChars: 0,
      renderLineHighlight: 'none',
      cursorStyle: 'line',
      cursorWidth: 0, // Hide cursor
      selectOnLineNumbers: false,
      glyphMargin: false,
      contextmenu: false,
      mouseWheelZoom: false,
      scrollbar: {
        vertical: 'auto',
        horizontal: 'auto',
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
      },
      // Disable all interactions
      domReadOnly: true,
      readOnlyMessage: {
        value: 'Code is read-only'
      }
    });

    monacoEditorRef.current = editor;

    // Disable all mouse interactions
    editor.onMouseDown((e) => {
      e.event.preventDefault();
      e.event.stopPropagation();
    });

    editor.onMouseUp((e) => {
      e.event.preventDefault();
      e.event.stopPropagation();
    });

    editor.onMouseMove((e) => {
      e.event.preventDefault();
      e.event.stopPropagation();
    });

    // Disable keyboard interactions
    editor.onKeyDown((e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    // Disable context menu
    editor.onContextMenu((e) => {
      e.event.preventDefault();
      e.event.stopPropagation();
    });

    return () => {
      editor.dispose();
    };
  }, []);

  useEffect(() => {
    if (monacoEditorRef.current) {
      monacoEditorRef.current.setValue(value);
    }
  }, [value]);

  useEffect(() => {
    if (monacoEditorRef.current) {
      monaco.editor.setModelLanguage(monacoEditorRef.current.getModel()!, language);
    }
  }, [language]);

  return (
    <div 
      ref={editorRef} 
      style={{ height }}
      className={`border border-gray-600 rounded ${className}`}
    />
  );
}
