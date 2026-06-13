import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Sparkles, 
  Sliders, 
  Search, 
  Image as ImageIcon, 
  Layers, 
  Cpu, 
  Zap, 
  CloudUpload, 
  X, 
  Download, 
  Share2, 
  LayoutGrid, 
  Palette, 
  AlertCircle 
} from 'lucide-react';

function App() {
  // --- States ---
  const [currentMode, setCurrentMode] = useState('API');
  const [cudaAvailable, setCudaAvailable] = useState(false);
  const [deviceName, setDeviceName] = useState('CPU');
  
  const [activeTab, setActiveTab] = useState('search');
  const [viewState, setViewState] = useState('empty'); // 'empty', 'results', 'generation'
  
  // Loader States
  const [isLoading, setIsLoading] = useState(false);
  const [loaderTitle, setLoaderTitle] = useState('Generating Canvas');
  const [loaderDesc, setLoaderDesc] = useState('Initializing...');
  const [loaderPercent, setLoaderPercent] = useState(0);

  // Form Parameters
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  
  const [textPrompt, setTextPrompt] = useState('');
  const [textResolution, setTextResolution] = useState('768x768');
  const [textSteps, setTextSteps] = useState(30);
  const [textGuidance, setTextGuidance] = useState(8.0);
  
  const [uploadedFile, setUploadedFile] = useState(null);
  const [uploadedPreview, setUploadedPreview] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const [imageStrength, setImageStrength] = useState(0.60);

  // Output State
  const [generatedImageSrc, setGeneratedImageSrc] = useState('');
  const [generatedPromptText, setGeneratedPromptText] = useState('');
  const [isTwoColLayout, setIsTwoColLayout] = useState(false);
  
  const fileInputRef = useRef(null);
  const isDraggingRef = useRef(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // --- Fetch Hardware Config on Load ---
  useEffect(() => {
    fetchHardwareConfig();
  }, []);

  const fetchHardwareConfig = () => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        setCurrentMode(data.generation_mode);
        setCudaAvailable(data.cuda_available);
        setDeviceName(data.device_name);
      })
      .catch(err => {
        console.error('⚠️ Config fetch failed:', err);
      });
  };

  // --- Actions ---
  const setEngineMode = (mode) => {
    setLoaderTitle('Switching Engine');
    setLoaderDesc(`Configuring system to run on ${mode}...`);
    setLoaderPercent(0);
    setIsLoading(true);
    
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generation_mode: mode })
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'success') {
        setCurrentMode(data.generation_mode);
      }
    })
    .catch(err => alert('Failed to change engine mode: ' + err))
    .finally(() => setIsLoading(false));
  };

  const pollProgress = (taskId, successCallback, errorCallback) => {
    const intervalId = setInterval(() => {
      fetch(`/api/progress/${taskId}`)
        .then(res => res.json())
        .then(data => {
          if (data.error) {
            clearInterval(intervalId);
            errorCallback(data.error);
            return;
          }

          let statusMessage = data.message || 'Processing generation...';
          setLoaderPercent(data.percent);
          
          if (data.status === 'processing') {
            if (data.percent > 0) {
              setLoaderDesc(`${statusMessage} (${data.percent}%)`);
            } else {
              setLoaderDesc(`${statusMessage}`);
            }
          } else if (data.status === 'success') {
            setLoaderDesc(data.message || 'Finalizing output...');
          } else if (data.status === 'error') {
            setLoaderDesc('Generation failed: ' + (data.error || ''));
          }

          if (data.status === 'success') {
            clearInterval(intervalId);
            successCallback(data.result);
          } else if (data.status === 'error') {
            clearInterval(intervalId);
            errorCallback(data.error);
          }
        })
        .catch(err => {
          console.error('Polling error:', err);
        });
    }, 500);
  };

  const handleSearch = () => {
    if (!searchQuery.trim()) {
      alert('Please enter a query to search!');
      return;
    }

    setLoaderTitle('Searching Library');
    setLoaderDesc(`Querying Unsplash database for "${searchQuery}"...`);
    setLoaderPercent(0);
    setIsLoading(true);

    fetch('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: searchQuery })
    })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        alert('Search failed: ' + data.error);
        return;
      }
      setSearchResults(data);
      setViewState('results');
    })
    .catch(err => alert('Failed to search images: ' + err))
    .finally(() => setIsLoading(false));
  };

  const handleGenerateText = () => {
    if (!textPrompt.trim()) {
      alert('Please enter a prompt description!');
      return;
    }

    const [height, width] = textResolution.split('x').map(Number);
    setLoaderTitle('Canvas Initialization');
    setLoaderDesc('Setting up neural network pipeline...');
    setLoaderPercent(0);
    setIsLoading(true);

    fetch('/generate-text-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: textPrompt,
        steps: textSteps,
        guidance_scale: textGuidance,
        height: height,
        width: width
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        alert('Generation failed to start: ' + data.error);
        setIsLoading(false);
        return;
      }

      pollProgress(data.task_id, (imageUrl) => {
        setGeneratedImageSrc(imageUrl);
        setGeneratedPromptText(textPrompt);
        setViewState('generation');
        setIsLoading(false);
      }, (error) => {
        alert('Generation failed: ' + error);
        setIsLoading(false);
      });
    })
    .catch(err => {
      alert('Error starting text-to-image: ' + err);
      setIsLoading(false);
    });
  };

  const handleGenerateImage = () => {
    if (!uploadedFile) {
      alert('Please upload an image first!');
      return;
    }
    if (!imagePrompt.trim()) {
      alert('Please provide a prompt description!');
      return;
    }

    setLoaderTitle('Preparing Source Image');
    setLoaderDesc('Encoding image array and uploading bytes...');
    setLoaderPercent(0);
    setIsLoading(true);

    const formData = new FormData();
    formData.append('image', uploadedFile);
    formData.append('prompt', imagePrompt);
    formData.append('strength', imageStrength);

    fetch('/generate-image-image', {
      method: 'POST',
      body: formData
    })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        alert('Image-to-image failed to start: ' + data.error);
        setIsLoading(false);
        return;
      }

      pollProgress(data.task_id, (base64Image) => {
        const dataUrl = 'data:image/png;base64,' + base64Image;
        setGeneratedImageSrc(dataUrl);
        setGeneratedPromptText(imagePrompt);
        setViewState('generation');
        setIsLoading(false);
      }, (error) => {
        alert('Image-to-image failed: ' + error);
        setIsLoading(false);
      });
    })
    .catch(err => {
      alert('Error starting image-to-image: ' + err);
      setIsLoading(false);
    });
  };

  // --- File Upload Utilities ---
  const handleFileChange = (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const processFile = (file) => {
    if (!file.type.match('image.*')) {
      alert('Only image files are allowed!');
      return;
    }
    setUploadedFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      setUploadedPreview(e.target.result);
    };
    reader.readAsDataURL(file);
  };

  const clearUploadedImage = (e) => {
    e.stopPropagation();
    setUploadedFile(null);
    setUploadedPreview('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  // --- Sharing & Layout toggles ---
  const shareArtwork = () => {
    if (navigator.share) {
      navigator.share({
        title: 'IntelStudio AI Artwork',
        text: generatedPromptText,
        url: generatedImageSrc.startsWith('data:') ? undefined : generatedImageSrc
      }).catch(console.error);
    } else {
      navigator.clipboard.writeText(generatedImageSrc);
      alert('Artwork link copied to clipboard!');
    }
  };

  const getWorkspaceTitle = () => {
    switch(activeTab) {
      case 'search': return 'Image Explorer';
      case 'txt2img': return 'AI Studio (Text to Image)';
      case 'img2img': return 'AI Studio (Image to Image)';
      default: return 'Image Explorer';
    }
  };

  return (
    <div className="app-layout">
      {/* 🎛️ Left Sidebar (Control Panel) */}
      <aside className="sidebar">
        <div className="brand">
          <Sparkles className="brand-icon" />
          <div className="brand-name">Intel<span>Studio</span></div>
        </div>

        {/* ⚙️ Mode Settings */}
        <div className="settings-box">
          <div className="settings-header">
            <span className="settings-title"><Sliders className="small-icon" /> Engine Mode</span>
            <span className="mode-badge">{currentMode}</span>
          </div>
          <div className="toggle-container">
            <button 
              className={`toggle-btn ${currentMode === 'API' ? 'active' : ''}`}
              onClick={() => setEngineMode('API')}
            >
              Serverless API
            </button>
            <button 
              className={`toggle-btn ${currentMode === 'LOCAL' ? 'active' : ''}`}
              onClick={() => setEngineMode('LOCAL')}
            >
              Local PyTorch
            </button>
          </div>
          <div className="device-status">
            {cudaAvailable ? (
              <>
                <Zap className="status-icon" style={{ color: '#10b981' }} />
                <span>GPU Mode Active ({deviceName})</span>
              </>
            ) : (
              <>
                <Cpu className="status-icon" />
                <span>Running on CPU fallback</span>
              </>
            )}
          </div>
        </div>

        {/* 📂 Navigation Tabs */}
        <nav className="nav-tabs">
          <button 
            className={`nav-tab ${activeTab === 'search' ? 'active' : ''}`}
            onClick={() => setActiveTab('search')}
          >
            <Search /> Image Library
          </button>
          <button 
            className={`nav-tab ${activeTab === 'txt2img' ? 'active' : ''}`}
            onClick={() => setActiveTab('txt2img')}
          >
            <ImageIcon /> Text to Image
          </button>
          <button 
            className={`nav-tab ${activeTab === 'img2img' ? 'active' : ''}`}
            onClick={() => setActiveTab('img2img')}
          >
            <Layers /> Image to Image
          </button>
        </nav>

        <div className="tab-divider"></div>

        {/* 📥 Active Tab Content (Animated) */}
        <div className="control-content">
          <AnimatePresence mode="wait">
            {activeTab === 'search' && (
              <motion.div 
                key="search"
                className="tab-panel"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.15 }}
              >
                <div className="panel-header">
                  <h3>Search Library</h3>
                  <p>Search millions of high-resolution royalty free images via Unsplash</p>
                </div>
                <div className="input-group">
                  <label htmlFor="searchQuery">What are you looking for?</label>
                  <div className="search-input-wrapper">
                    <input 
                      type="text" 
                      id="searchQuery" 
                      placeholder="e.g., cyberpunk city, retro room..." 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    />
                    <Search className="search-field-icon" />
                  </div>
                </div>
                <button className="primary-btn" onClick={handleSearch}>
                  <span>Search Images</span>
                </button>
              </motion.div>
            )}

            {activeTab === 'txt2img' && (
              <motion.div 
                key="txt2img"
                className="tab-panel"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.15 }}
              >
                <div className="panel-header">
                  <h3>AI Text Studio</h3>
                  <p>Create hyper-realistic artwork from text prompt using FLUX.1 / SD XL</p>
                </div>
                <div className="input-group">
                  <label htmlFor="textPrompt">Prompt Description</label>
                  <textarea 
                    id="textPrompt" 
                    rows={4} 
                    placeholder="e.g., A detailed cinematic shot of a futuristic astronaut standing in a jungle..."
                    value={textPrompt}
                    onChange={(e) => setTextPrompt(e.target.value)}
                  />
                </div>
                
                <div className="collapsible-settings">
                  <div className="setting-row">
                    <label htmlFor="imgResolution">Dimension</label>
                    <select 
                      id="imgResolution"
                      value={textResolution}
                      onChange={(e) => setTextResolution(e.target.value)}
                    >
                      <option value="512x512">Square (512x512)</option>
                      <option value="768x768">Square (768x768)</option>
                      <option value="1024x1024">Square (1024x1024)</option>
                    </select>
                  </div>
                  
                  {currentMode === 'LOCAL' && (
                    <motion.div 
                      className="setting-slider"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className="setting-slider" style={{ marginBottom: '12px' }}>
                        <div className="slider-header">
                          <label htmlFor="textSteps">Inference Steps</label>
                          <span className="slider-val">{textSteps}</span>
                        </div>
                        <input 
                          type="range" 
                          id="textSteps" 
                          min={10} 
                          max={50} 
                          value={textSteps} 
                          onChange={(e) => setTextSteps(Number(e.target.value))}
                        />
                      </div>
                      <div className="setting-slider">
                        <div className="slider-header">
                          <label htmlFor="textGuidance">Guidance Scale</label>
                          <span className="slider-val">{textGuidance.toFixed(1)}</span>
                        </div>
                        <input 
                          type="range" 
                          id="textGuidance" 
                          min={1} 
                          max={20} 
                          step={0.5}
                          value={textGuidance} 
                          onChange={(e) => setTextGuidance(Number(e.target.value))}
                        />
                      </div>
                    </motion.div>
                  )}
                </div>

                <button className="primary-btn pulse-glow" onClick={handleGenerateText}>
                  <Sparkles size={16} /> <span>Generate Image</span>
                </button>
              </motion.div>
            )}

            {activeTab === 'img2img' && (
              <motion.div 
                key="img2img"
                className="tab-panel"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.15 }}
              >
                <div className="panel-header">
                  <h3>AI Image Transformation</h3>
                  <p>Modify and redraw existing images. Mask details are detected automatically.</p>
                </div>
                
                <div className="input-group">
                  <label>Source Image</label>
                  <div 
                    className={`upload-zone ${isDragOver ? 'highlight' : ''}`}
                    onClick={() => fileInputRef.current && fileInputRef.current.click()}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <input 
                      type="file" 
                      id="imageForGeneration" 
                      className="hidden-input" 
                      accept="image/*" 
                      ref={fileInputRef}
                      onChange={handleFileChange}
                    />
                    {!uploadedPreview ? (
                      <div className="upload-placeholder">
                        <CloudUpload className="upload-icon" />
                        <span className="upload-text">Drag & drop or click to upload</span>
                        <span className="upload-subtext">PNG, JPG or JPEG</span>
                      </div>
                    ) : (
                      <div className="upload-preview">
                        <img src={uploadedPreview} alt="Upload Preview" />
                        <button className="remove-preview-btn" onClick={clearUploadedImage}>
                          <X />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="input-group">
                  <label htmlFor="imagePrompt">Modification Prompt</label>
                  <textarea 
                    id="imagePrompt" 
                    rows={3} 
                    placeholder="e.g., replace the background with a cybernetic lab..."
                    value={imagePrompt}
                    onChange={(e) => setImagePrompt(e.target.value)}
                  />
                </div>

                <div className="collapsible-settings">
                  <div className="setting-slider">
                    <div className="slider-header">
                      <label htmlFor="imgStrength">Variation Strength</label>
                      <span className="slider-val">{imageStrength.toFixed(2)}</span>
                    </div>
                    <input 
                      type="range" 
                      id="imgStrength" 
                      min={0.1} 
                      max={1.0} 
                      step={0.05} 
                      value={imageStrength} 
                      onChange={(e) => setImageStrength(Number(e.target.value))}
                    />
                    <div className="slider-desc">Lower = closer to original; Higher = more modification.</div>
                  </div>
                </div>

                <button className="primary-btn" onClick={handleGenerateImage}>
                  <Sparkles size={16} /> <span>Redraw Image</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </aside>

      {/* 🖼️ Right Workspace (Output Viewport) */}
      <main className="workspace">
        <header className="workspace-header">
          <h2>{getWorkspaceTitle()}</h2>
          <div className="workspace-actions">
            <button className="icon-btn" onClick={() => setIsTwoColLayout(!isTwoColLayout)} title="Toggle Grid Columns">
              <LayoutGrid />
            </button>
          </div>
        </header>

        <div className="viewport">
          {/* ⏳ Sleek Loader Overlay */}
          <AnimatePresence>
            {isLoading && (
              <motion.div 
                className="loader-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="loader-card">
                  <div className="spinner-ring">
                    <div></div><div></div><div></div><div></div>
                  </div>
                  <h4>{loaderTitle}</h4>
                  <p>{loaderDesc}</p>
                  <div className="progress-percentage-text">{Math.round(loaderPercent)}%</div>
                  <div className="loader-progress">
                    <div className="loader-progress-bar" style={{ width: `${loaderPercent}%` }}></div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 💡 View State Rendering */}
          <AnimatePresence mode="wait">
            {viewState === 'empty' && (
              <motion.div 
                key="empty"
                className="empty-state"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="empty-glow"></div>
                <Palette className="empty-icon" />
                <h3>Begin Your Creative Canvas</h3>
                <p>Enter queries on the left panel to search high resolution photos or generate custom AI art.</p>
              </motion.div>
            )}

            {viewState === 'results' && (
              <motion.div 
                key="results"
                className={`results-grid ${isTwoColLayout ? 'two-col' : ''}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                {searchResults.map((item, idx) => (
                  <motion.div 
                    key={idx} 
                    className="image-card"
                    whileHover={{ scale: 1.02 }}
                    transition={{ duration: 0.2 }}
                  >
                    <img 
                      src={item.image_path} 
                      className="result-image" 
                      alt="Search Result" 
                      onClick={() => window.open(item.image_path, '_blank')}
                    />
                  </motion.div>
                ))}
              </motion.div>
            )}

            {viewState === 'generation' && (
              <motion.div 
                key="generation"
                className="generation-view"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.25 }}
              >
                <div className="generated-canvas-card">
                  <div className="canvas-image-container">
                    <img src={generatedImageSrc} alt="Generated AI Canvas" />
                  </div>
                  <div className="canvas-details">
                    <div className="canvas-meta">
                      <span className="meta-label">Prompt</span>
                      <p className="meta-prompt">"{generatedPromptText}"</p>
                    </div>
                    <div className="canvas-footer-actions">
                      <a 
                        href={generatedImageSrc} 
                        download="generated_art.png" 
                        className="canvas-action-btn primary"
                      >
                        <Download size={16} /> Download Artwork
                      </a>
                      <button className="canvas-action-btn secondary" onClick={shareArtwork}>
                        <Share2 size={16} /> Share
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

export default App;
