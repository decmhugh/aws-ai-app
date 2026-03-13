import { useState } from 'react'
import TextGenerator from './components/TextGenerator.jsx'
import OutpaintGenerator from './components/OutpaintGenerator.jsx'
import './App.css'

function App() {
  const [generatedText, setGeneratedText] = useState('')
  const [currentPage, setCurrentPage] = useState('text-gen')

  return (
    <div className="app">
      <header className="app-header">
        <h1>🤖 AWS AI Generator</h1>
        <nav className="app-nav">
          <button
            className={`nav-btn ${currentPage === 'text-gen' ? 'active' : ''}`}
            onClick={() => {
              setCurrentPage('text-gen')
              setGeneratedText('')
            }}
          >
            ✨ Variations & Inpaint
          </button>
          <button
            className={`nav-btn ${currentPage === 'outpaint' ? 'active' : ''}`}
            onClick={() => {
              setCurrentPage('outpaint')
              setGeneratedText('')
            }}
          >
            🎨 Outpaint
          </button>
        </nav>
      </header>

      <main className="app-main">
        {currentPage === 'text-gen' && (
          <>
            <p className="page-description">Enter a prompt or upload an image; the model will produce text or a variation.</p>
            <TextGenerator onTextGenerated={setGeneratedText} />
          </>
        )}
        {currentPage === 'outpaint' && (
          <>
            <p className="page-description">Upload an image to expand the canvas and generate new content around the edges.</p>
            <OutpaintGenerator onTextGenerated={setGeneratedText} />
          </>
        )}

        {generatedText && (
          <section className="result-section">
            <h2>Output</h2>
            {(generatedText.startsWith('data:image') || generatedText.startsWith('http') || /^[A-Za-z0-9+/]+=*$/.test(generatedText)) ? (
              <div className="result-image-wrapper">
                <img
                  src={
                    generatedText.startsWith('http')
                      ? generatedText
                      : generatedText.startsWith('data:image')
                      ? generatedText
                      : `data:image/png;base64,${generatedText}`
                  }
                  alt="Generated result"
                  className="result-image"
                />
              </div>
            ) : (
              <pre className="result-text">{generatedText}</pre>
            )}
          </section>
        )}
      </main>
    </div>
  )
}

export default App
