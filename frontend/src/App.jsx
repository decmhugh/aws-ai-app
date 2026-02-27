import { useState } from 'react'
import ImageUploader from './components/ImageUploader.jsx'
import './App.css'

function App() {
  const [generatedImage, setGeneratedImage] = useState(null)

  return (
    <div className="app">
      <header className="app-header">
        <h1>🎨 AWS AI Image Generator</h1>
        <p>Upload an image and let Amazon Bedrock Titan create a variation</p>
      </header>

      <main className="app-main">
        <ImageUploader onImageGenerated={setGeneratedImage} />

        {generatedImage && (
          <section className="result-section">
            <h2>Generated Image</h2>
            <div className="result-image-wrapper">
              <img
                src={`data:image/png;base64,${generatedImage}`}
                alt="AI-generated result"
                className="result-image"
              />
            </div>
            <a
              href={`data:image/png;base64,${generatedImage}`}
              download="generated-image.png"
              className="download-btn"
            >
              ⬇ Download Image
            </a>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
