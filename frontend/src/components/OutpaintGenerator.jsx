import { useState, useRef } from 'react'
import './OutpaintGenerator.css'

// API base URL – set VITE_API_URL in your .env.local file
const API_URL = import.meta.env.VITE_API_URL

if (!API_URL) {
  console.warn(
    '[aws-ai-app] VITE_API_URL is not set. ' +
    'Copy frontend/.env.example to frontend/.env.local and add your API Gateway URL.'
  )
}

function OutpaintGenerator({ onTextGenerated }) {
  const [selectedFile, setSelectedFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [prompt, setPrompt] = useState('Extend the scene naturally')
  const [padding, setPadding] = useState(256)
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
    if (!selectedFile) {
      setStatus('Please select an image to extend.')
      return
    }

    if (!prompt.trim()) {
      setStatus('Please enter a prompt to describe how to extend the scene.')
      return
    }

    setIsLoading(true)
    onTextGenerated(null)

    try {
      if (!API_URL) {
        throw new Error('VITE_API_URL is not configured. See frontend/.env.example.')
      }

      if (selectedFile && selectedFile.size > 5_000_000) {
        setStatus('Image large – it may hit Bedrock limits. Consider reducing dimensions.')
      }

      let body = {
        prompt,
        padding,
        editMode: 'outpaint',
      }

      // Upload image first
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

      setStatus('Generating extended image…')
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
        if (data.s3Key) {
          // Ask backend for a presigned GET URL
          const fetchRes = await fetch(`${API_URL}/fetch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: data.s3Key }),
          })
          if (fetchRes.ok) {
            const { url } = await fetchRes.json()
            onTextGenerated(url)
          } else {
            onTextGenerated(data.imageData)
          }
        } else {
          onTextGenerated(data.imageData)
        }
      }

      setStatus('Generation successful!')
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="outpaint-generator">
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
            <span className="drop-icon">🖼️</span>
            <p>Click or drag &amp; drop an image to extend</p>
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
          placeholder="Describe how to extend the image (e.g., 'Add more landscape with mountains in the distance')…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>

      <div className="prompt-row">
        <label className="prompt-label" htmlFor="padding-input">
          Canvas Padding (pixels): {padding}
        </label>
        <input
          id="padding-input"
          type="range"
          min="64"
          max="512"
          step="32"
          value={padding}
          onChange={(e) => setPadding(parseInt(e.target.value))}
          className="padding-slider"
        />
        <small className="padding-hint">How much to extend the image canvas</small>
      </div>

      <button
        className="generate-btn"
        onClick={handleGenerate}
        disabled={isLoading || !selectedFile}
      >
        {isLoading ? (
          <span className="spinner" aria-hidden="true" />
        ) : (
          '🎨 Extend Image'
        )}
        {isLoading && 'Working…'}
      </button>

      {status && (
        <p className={`status ${status.startsWith('Error') ? 'error' : 'info'}`}>{status}</p>
      )}
    </div>
  )
}

export default OutpaintGenerator
