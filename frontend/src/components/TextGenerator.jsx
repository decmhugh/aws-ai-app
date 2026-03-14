import { useState, useRef } from 'react'
import './TextGenerator.css'

// API base URL – set VITE_API_URL in your .env.local file
const API_URL = import.meta.env.VITE_API_URL

if (!API_URL) {
  console.warn(
    '[aws-ai-app] VITE_API_URL is not set. ' +
    'Copy frontend/.env.example to frontend/.env.local and add your API Gateway URL.'
  )
}

function TextGenerator({ onTextGenerated }) {
  // support optional file upload
  const [selectedFile, setSelectedFile] = useState(null)
  const [preview, setPreview] = useState(null)
  // default prompt text and mask description
  const [prompt, setPrompt] = useState('Add beard to image')
  const [maskPrompt, setMaskPrompt] = useState('lower half of the face')
  // prompt only – mask support has been removed to simplify the UI
  const [status, setStatus] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)

  const handleFileSelect = async (file) => {
    if (!file || !file.type.startsWith('image/')) {
      setStatus('Please select a valid image file.')
      return
    }

    // Titan has a maximum input image length (~1408). Resize any very large
    // images in the browser to avoid getting a 400 from Bedrock.
    const maxDim = 1024
    const bitmap = await createImageBitmap(file)
    let finalBlob = file
    if (bitmap.width > maxDim || bitmap.height > maxDim) {
      const scale = Math.min(maxDim / bitmap.width, maxDim / bitmap.height)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      finalBlob = await new Promise((resolve) =>
        canvas.toBlob(resolve, file.type || 'image/png')
      )
      // create a new File so name/type remain available
      finalBlob = new File([finalBlob], file.name, { type: finalBlob.type })
    }

    setSelectedFile(finalBlob)
    setPreview(URL.createObjectURL(finalBlob))
    setStatus('')
    onTextGenerated(null)
  }

  const handleInputChange = (e) => {
    if (e.target.files[0]) handleFileSelect(e.target.files[0])
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0])
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => setIsDragging(false)

  const handleGenerate = async () => {
    if (!prompt.trim() && !selectedFile) {
      setStatus('Please enter a prompt or choose an image.')
      return
    }

    setIsLoading(true)
    onTextGenerated(null)

    try {
      if (!API_URL) {
        throw new Error('VITE_API_URL is not configured. See frontend/.env.example.')
      }
      // warn if the image size is still very large (client resize misses something)
      if (selectedFile && (selectedFile.size > 5_000_000)) {
        setStatus('Image large – it may hit Bedrock limits. Consider reducing dimensions.')
      }
      let body = { prompt }
      if (maskPrompt && maskPrompt.trim()) {
        body.maskPrompt = maskPrompt
      }

      if (selectedFile) {
        // upload image first
        setStatus('Requesting upload URL…')
        const presignRes = await fetch(`${API_URL}/presign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: selectedFile.name,
            contentType: selectedFile.type,
          }),
        })
        if (!presignRes.ok) throw new Error('Failed to get upload URL')
        const { uploadUrl, key } = await presignRes.json()

        setStatus('Uploading image to S3…')
        const uploadRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': selectedFile.type },
          body: selectedFile,
        })
        if (!uploadRes.ok) throw new Error('S3 upload failed')

        body.key = key
      }

      setStatus('Generating response…')
      const generateRes = await fetch(`${API_URL}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!generateRes.ok) {
        const err = await generateRes.json().catch(() => ({}))
        throw new Error(err.error || 'Generation failed')
      }
      const data = await generateRes.json()

      if (data.imageData) {
        // store locally if no key, otherwise fetch signed URL
        if (data.s3Key) {
          // ask backend for a presigned GET URL
          const fetchRes = await fetch(`${API_URL}/fetch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: data.s3Key }),
          })
          if (fetchRes.ok) {
            const { url } = await fetchRes.json()
            onTextGenerated(url) // frontend will treat as URL
          } else {
            // fallback to inline image data
            onTextGenerated(data.imageData)
          }
        } else {
          onTextGenerated(data.imageData)
        }
      } else if (data.outputText) {
        onTextGenerated(data.outputText)
      }

      setStatus('Generation successful!')
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="text-generator">
      <div
        className={`drop-zone ${isDragging ? 'dragging' : ''} ${preview ? 'has-preview' : ''}`}
        onClick={() => fileInputRef.current.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current.click()}
        aria-label="Click or drag an image to upload"
      >
        {preview ? (
          <img src={preview} alt="Selected preview" className="preview-image" />
        ) : (
          <div className="drop-zone-placeholder">
            <span className="drop-icon">📂</span>
            <p>Click or drag &amp; drop an image here (optional)</p>
            <p className="drop-hint">JPEG, PNG, GIF, WEBP</p>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleInputChange}
      />

      <div className="prompt-row">
        <label className="prompt-label" htmlFor="prompt-input">
          Prompt
        </label>
        <textarea
          id="prompt-input"
          className="prompt-textarea"
          placeholder="Describe what you want…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>
      <div className="prompt-row">
        <label className="prompt-label" htmlFor="mask-input">
          Mask description (area to modify)
        </label>
        <input
          id="mask-input"
          type="text"
          className="mask-prompt-input"
          placeholder="e.g. lower half of the face"
          value={maskPrompt}
          onChange={(e) => setMaskPrompt(e.target.value)}
        />
      </div>

      <button
        className="generate-btn"
        onClick={handleGenerate}
        disabled={isLoading || (!prompt.trim() && !selectedFile)}
      >
        {isLoading ? (
          <span className="spinner" aria-hidden="true" />
        ) : (
          '✨ Generate'
        )}
        {isLoading && 'Working…'}
      </button>

      {status && (
        <p className={`status ${status.startsWith('Error') ? 'error' : 'info'}`}>{status}</p>
      )}
    </div>
  )
}

export default TextGenerator;