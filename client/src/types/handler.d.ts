export type CodeEditorChangeHandler = (value: string | undefined) => void;
export type MountChangeHandler = (
  editor: editor.IStandaloneCodeEditor,
  monaco: Monaco
) => void;
export type SelectChangeHandler = (
  selected?: MonacoLanguage | MonacoLanguage[] | null
) => void;
export type LandingEditorChangeHandler = (action: string, data: string) => void;
export type RevealToastIdHandler = () => Id;

export type NoParamHandler = () => void;
