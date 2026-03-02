import { useState } from 'react'
import TextGenerator from './components/TextGenerator.jsx'
import './App.css'

function App() {
  const [generatedText, setGeneratedText] = useState('')

  return (
    <div className="app">
      <header className="app-header">
        <h1>🤖 AWS AI Generator</h1>
        <p>Enter a prompt or upload an image; the model will produce text or a variation.</p>
      </header>

      <main className="app-main">
        <TextGenerator onTextGenerated={setGeneratedText} />

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
