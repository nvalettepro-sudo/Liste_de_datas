import { useCallback, useState } from 'react'
import { useStore } from '../store/useStore'

export function FileDropZone() {
  const loadFile = useStore((s) => s.loadFile)
  const [dragging, setDragging] = useState(false)

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.endsWith('.ifc')) return
      loadFile(file)
    },
    [loadFile]
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(true)
  }
  const onDragLeave = () => setDragging(false)

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center transition-colors duration-150 ${
        dragging ? 'bg-gray-900' : 'bg-gray-950'
      }`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      <label
        htmlFor="ifc-file-input"
        className={`flex flex-col items-center gap-4 px-16 py-12 border-2 border-dashed cursor-pointer transition-colors duration-150 ${
          dragging
            ? 'border-blue-400 bg-blue-950/30'
            : 'border-gray-600 hover:border-gray-400 bg-gray-900'
        }`}
      >
        <svg
          className={`w-16 h-16 ${dragging ? 'text-blue-400' : 'text-gray-500'}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <div className="text-center">
          <p className="text-xl font-medium text-gray-200">
            {dragging ? 'Déposer le fichier' : 'Charger un fichier IFC'}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Glisser-déposer ou cliquer pour sélectionner · Formats : .ifc
          </p>
        </div>
        <input
          id="ifc-file-input"
          type="file"
          accept=".ifc"
          className="sr-only"
          onChange={onInputChange}
        />
      </label>
    </div>
  )
}
