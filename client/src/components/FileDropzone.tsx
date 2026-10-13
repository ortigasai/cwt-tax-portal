import { useRef, useState } from 'react';
import Icon from './Icon';

interface FileDropzoneProps {
  accept?: string;
  disabled?: boolean;
  title: string;
  hint?: string;
  onFile: (file: File) => void;
}

// Drag-and-drop (or click) file picker. Wraps a hidden <input type="file">
// so the browser's own picker still handles keyboard/screen-reader use via
// the "Choose file" button.
export default function FileDropzone({ accept, disabled, title, hint, onFile }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
    // Reset so choosing the same file again still fires onChange.
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div
      className={`dropzone${dragging ? ' dragging' : ''}${disabled ? ' disabled' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!disabled) pick(e.dataTransfer.files);
      }}
    >
      <Icon name="upload" size={28} />
      <div className="dropzone-title">{title}</div>
      {hint && <div className="muted">{hint}</div>}
      <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => inputRef.current?.click()}>
        Choose file
      </button>
      <input ref={inputRef} type="file" accept={accept} disabled={disabled} hidden onChange={(e) => pick(e.target.files)} />
    </div>
  );
}
