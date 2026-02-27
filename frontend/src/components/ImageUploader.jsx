import { useState, useRef } from 'react'
import './ImageUploader.css'

// API base URL – set VITE_API_URL in your .env.local file
const API_URL = import.meta.env.VITE_API_URL

if (!API_URL) {
  console.warn(
    '[aws-ai-app] VITE_API_URL is not set. ' +
    'Copy frontend/.env.example to frontend/.env.local and add your API Gateway URL.'
  )
}

function ImageUploader({ onImageGenerated }) {
  const [selectedFile, setSelectedFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [prompt, setPrompt] = useState('')
  const [status, setStatus] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)

  const handleFileSelect = (file) => {
    if (!file || !file.type.startsWith('image/')) {
      setStatus('Please select a valid image file.')
      return
    }
    setSelectedFile(file)
    setPreview(URL.createObjectURL(file))
    setStatus('')
    onImageGenerated(null)
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
      setStatus('Please select an image first.')
      return
    }

    setIsLoading(true)
    onImageGenerated(null)

    try {
      if (!API_URL) {
        throw new Error('VITE_API_URL is not configured. See frontend/.env.example.')
      }

      // Step 1: Request a pre-signed S3 URL
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

      // Step 2: Upload the image directly to S3
      setStatus('Uploading image to S3…')
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': selectedFile.type },
        body: selectedFile,
      })
      if (!uploadRes.ok) throw new Error('S3 upload failed')

      // Step 3: Ask Lambda to generate an image variation via Bedrock
      setStatus('Generating image with Amazon Bedrock Titan…')
      const generateRes = await fetch(`${API_URL}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key,
          prompt: prompt || 'Generate a creative variation of this image',
        }),
      })
      if (!generateRes.ok) {
        const err = await generateRes.json().catch(() => ({}))
        throw new Error(err.error || 'Image generation failed')
      }
      const { imageData } = await generateRes.json()

      onImageGenerated(imageData)
      setStatus('Image generated successfully!')
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="uploader">
      {/* Drop zone */}
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
            <p>Click or drag &amp; drop an image here</p>
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

      {/* Prompt input */}
      <div className="prompt-row">
        <label htmlFor="prompt-input" className="prompt-label">
          Prompt (optional)
        </label>
        <input
          id="prompt-input"
          type="text"
          className="prompt-input"
          placeholder="Describe the variation you want…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>

      {/* Generate button */}
      <button
        className="generate-btn"
        onClick={handleGenerate}
        disabled={isLoading || !selectedFile}
      >
        {isLoading ? (
          <span className="spinner" aria-hidden="true" />
        ) : (
          '✨ Generate Image'
        )}
        {isLoading && 'Working…'}
      </button>

      {/* Status message */}
      {status && (
        <p className={`status ${status.startsWith('Error') ? 'error' : 'info'}`}>
          {status}
        </p>
      )}
    </div>
  )
}

export default ImageUploader
