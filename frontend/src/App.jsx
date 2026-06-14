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
  AlertCircle,
  Settings,
  History,
  Trash2
} from 'lucide-react';

function App() {
  // --- States ---
  const [currentMode, setCurrentMode] = useState('API');
  const [cudaAvailable, setCudaAvailable] = useState(false);
  const [deviceName, setDeviceName] = useState('CPU');
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [downloadModalReason, setDownloadModalReason] = useState('pytorch');

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

  // Advanced settings states
  const [textStylePreset, setTextStylePreset] = useState('none');
  const [textModel, setTextModel] = useState('black-forest-labs/FLUX.1-schnell');
  const [textNegativePrompt, setTextNegativePrompt] = useState('');
  const [textSeed, setTextSeed] = useState('');
  const [textRandomizeSeed, setTextRandomizeSeed] = useState(true);

  const [imageNegativePrompt, setImageNegativePrompt] = useState('');
  const [imageSeed, setImageSeed] = useState('');
  const [imageRandomizeSeed, setImageRandomizeSeed] = useState(true);

  const [isAdvancedOpenTxt, setIsAdvancedOpenTxt] = useState(false);
  const [isAdvancedOpenImg, setIsAdvancedOpenImg] = useState(false);

  // API Key Settings States
  const [unsplashKey, setUnsplashKey] = useState(localStorage.getItem('unsplash_access_key') || '');
  const [hfToken, setHfToken] = useState(localStorage.getItem('huggingface_token') || '');
  const [pollinationsKey, setPollinationsKey] = useState(localStorage.getItem('pollinations_api_key') || '');
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Creation History State
  const [historyItems, setHistoryItems] = useState(JSON.parse(localStorage.getItem('intel_history') || '[]'));

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

  const getStyledPrompt = (prompt, style) => {
    if (!style || style === 'none') return prompt;
    switch(style) {
      case 'photorealistic':
        return `${prompt}, ultra-realistic, photorealistic, high detail, 8k, cinematic lighting, sharp focus`;
      case 'anime':
        return `${prompt}, anime style, hand-drawn illustration, vibrant colors, detailed lineart, anime aesthetic`;
      case '3d':
        return `${prompt}, 3D render, Unreal Engine 5 render, highly detailed, octane render, Raytracing, hyper-detailed`;
      case 'cyberpunk':
        return `${prompt}, cyberpunk theme, neon lights, futuristic cityscape details, dark moody cyberpunk aesthetic, high detail`;
      case 'oil':
        return `${prompt}, oil painting style, visible brush strokes, classic art masterpiece, rich textures, artistic lighting`;
      default:
        return prompt;
    }
  };

  const addToHistory = (imageUrl, prompt, type) => {
    const newItem = {
      id: Date.now().toString(),
      src: imageUrl,
      prompt: prompt,
      type: type,
      timestamp: new Date().toLocaleString()
    };
    const currentHist = JSON.parse(localStorage.getItem('intel_history') || '[]');
    const updated = [newItem, ...currentHist].slice(0, 30);
    setHistoryItems(updated);
    localStorage.setItem('intel_history', JSON.stringify(updated));
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
      headers: { 
        'Content-Type': 'application/json',
        'X-Unsplash-Key': unsplashKey
      },
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

    const finalPrompt = getStyledPrompt(textPrompt, textStylePreset);
    const computedSeed = textRandomizeSeed ? -1 : (textSeed ? Number(textSeed) : -1);

    fetch('/generate-text-image', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-HF-Token': hfToken
      },
      body: JSON.stringify({
        prompt: finalPrompt,
        steps: textSteps,
        guidance_scale: textGuidance,
        height: height,
        width: width,
        negative_prompt: textNegativePrompt,
        seed: computedSeed,
        model: textModel
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
          addToHistory(imageUrl, textPrompt, 'Text to Image');
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

    const computedSeed = imageRandomizeSeed ? -1 : (imageSeed ? Number(imageSeed) : -1);

    const formData = new FormData();
    formData.append('image', uploadedFile);
    formData.append('prompt', imagePrompt);
    formData.append('strength', imageStrength);
    formData.append('negative_prompt', imageNegativePrompt);
    formData.append('seed', computedSeed);

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
          addToHistory(dataUrl, imagePrompt, 'Image to Image');
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
    switch (activeTab) {
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
          <button className="settings-toggle-btn" onClick={() => setShowSettingsModal(true)} title="API Keys Settings">
            <Settings size={18} />
          </button>
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
              onClick={() => {
                setDownloadModalReason('pytorch');
                setShowDownloadModal(true);
              }}
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
            onClick={() => {
              setDownloadModalReason('img2img');
              setShowDownloadModal(true);
            }}
          >
            <Layers /> Image to Image
          </button>
          <button
            className={`nav-tab ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            <History size={18} /> Creation History
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

                  <div className="setting-row" style={{ marginTop: '12px' }}>
                    <label htmlFor="textStylePreset">Art Style Preset</label>
                    <select
                      id="textStylePreset"
                      value={textStylePreset}
                      onChange={(e) => setTextStylePreset(e.target.value)}
                    >
                      <option value="none">No Preset (Raw Prompt)</option>
                      <option value="photorealistic">Photorealistic</option>
                      <option value="anime">Anime / Manga</option>
                      <option value="3d">3D Render / CGI</option>
                      <option value="cyberpunk">Cyberpunk Style</option>
                      <option value="oil">Classic Oil Painting</option>
                    </select>
                  </div>

                  {currentMode === 'LOCAL' && (
                    <div style={{ marginTop: '12px' }}>
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
                    </div>
                  )}

                  <button 
                    type="button"
                    className="advanced-toggle-btn" 
                    onClick={() => setIsAdvancedOpenTxt(!isAdvancedOpenTxt)}
                  >
                    <Sliders size={14} /> <span>{isAdvancedOpenTxt ? 'Hide Advanced Settings' : 'Show Advanced Settings'}</span>
                  </button>

                  <AnimatePresence>
                    {isAdvancedOpenTxt && (
                      <motion.div 
                        className="advanced-panel"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        style={{ overflow: 'hidden' }}
                      >
                        {currentMode === 'API' && (
                          <div className="input-group">
                            <label htmlFor="textModel">Cloud Model</label>
                            <select
                              id="textModel"
                              value={textModel}
                              onChange={(e) => setTextModel(e.target.value)}
                            >
                              <option value="black-forest-labs/FLUX.1-schnell">FLUX.1 Schnell (Fast)</option>
                              <option value="stabilityai/stable-diffusion-xl-base-1.0">Stable Diffusion XL (Quality)</option>
                            </select>
                          </div>
                        )}

                        <div className="input-group">
                          <label htmlFor="textNegativePrompt">Negative Prompt</label>
                          <textarea
                            id="textNegativePrompt"
                            rows={2}
                            placeholder="Things you don't want in the image..."
                            value={textNegativePrompt}
                            onChange={(e) => setTextNegativePrompt(e.target.value)}
                          />
                        </div>

                        <div className="input-group">
                          <label>Generation Seed</label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <input
                              type="number"
                              placeholder="Random"
                              disabled={textRandomizeSeed}
                              value={textRandomizeSeed ? '' : textSeed}
                              onChange={(e) => setTextSeed(e.target.value)}
                              style={{ flexGrow: 1 }}
                            />
                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '11px', whiteSpace: 'nowrap' }}>
                              <input
                                type="checkbox"
                                checked={textRandomizeSeed}
                                onChange={(e) => setTextRandomizeSeed(e.target.checked)}
                              />
                              Random
                            </label>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <button className="primary-btn pulse-glow" onClick={handleGenerateText} style={{ marginTop: '16px' }}>
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

                  <button 
                    type="button"
                    className="advanced-toggle-btn" 
                    onClick={() => setIsAdvancedOpenImg(!isAdvancedOpenImg)}
                    style={{ marginTop: '12px' }}
                  >
                    <Sliders size={14} /> <span>{isAdvancedOpenImg ? 'Hide Advanced Settings' : 'Show Advanced Settings'}</span>
                  </button>

                  <AnimatePresence>
                    {isAdvancedOpenImg && (
                      <motion.div 
                        className="advanced-panel"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        style={{ overflow: 'hidden' }}
                      >
                        <div className="input-group">
                          <label htmlFor="imageNegativePrompt">Negative Prompt</label>
                          <textarea
                            id="imageNegativePrompt"
                            rows={2}
                            placeholder="Things you don't want in the image..."
                            value={imageNegativePrompt}
                            onChange={(e) => setImageNegativePrompt(e.target.value)}
                          />
                        </div>

                        <div className="input-group">
                          <label>Generation Seed</label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <input
                              type="number"
                              placeholder="Random"
                              disabled={imageRandomizeSeed}
                              value={imageRandomizeSeed ? '' : imageSeed}
                              onChange={(e) => setImageSeed(e.target.value)}
                              style={{ flexGrow: 1 }}
                            />
                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '11px', whiteSpace: 'nowrap' }}>
                              <input
                                type="checkbox"
                                checked={imageRandomizeSeed}
                                onChange={(e) => setImageRandomizeSeed(e.target.checked)}
                              />
                              Random
                            </label>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <button className="primary-btn" onClick={handleGenerateImage} style={{ marginTop: '16px' }}>
                  <Sparkles size={16} /> <span>Redraw Image</span>
                </button>
              </motion.div>
            )}

            {activeTab === 'history' && (
              <motion.div
                key="history"
                className="tab-panel"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.15 }}
              >
                <div className="panel-header">
                  <h3>History Controls</h3>
                  <p>Manage your locally cached generated artwork history.</p>
                </div>
                <button 
                  className="primary-btn" 
                  style={{ background: 'var(--accent-red)', width: '100%', border: 'none', borderRadius: '8px', cursor: 'pointer', padding: '12px', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: '600' }}
                  onClick={() => {
                    if (window.confirm("Are you sure you want to clear all history?")) {
                      setHistoryItems([]);
                      localStorage.removeItem('intel_history');
                    }
                  }}
                >
                  <Trash2 size={16} /> <span>Clear All History</span>
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
            {activeTab === 'history' ? (
              <motion.div
                key="history-grid"
                className={`results-grid ${isTwoColLayout ? 'two-col' : ''}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                {historyItems.length === 0 ? (
                  <div className="empty-state" style={{ gridColumn: '1 / -1', padding: '80px 0' }}>
                    <History className="empty-icon" />
                    <h3>No Creation History</h3>
                    <p>Your generated masterpieces will appear here once you create them.</p>
                  </div>
                ) : (
                  historyItems.map((item) => (
                    <motion.div
                      key={item.id}
                      className="image-card"
                      whileHover={{ scale: 1.02 }}
                      transition={{ duration: 0.2 }}
                      style={{ height: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px' }}
                    >
                      <div className="canvas-image-container" style={{ aspectRatio: '1', borderRadius: '8px', overflow: 'hidden' }}>
                        <img
                          src={item.src}
                          className="result-image"
                          alt="History Artwork"
                          onClick={() => {
                            setGeneratedImageSrc(item.src);
                            setGeneratedPromptText(item.prompt);
                            setViewState('generation');
                            if (item.type.includes('Text')) setActiveTab('txt2img');
                            else setActiveTab('img2img');
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', textAlign: 'left' }}>
                        <span className="meta-label" style={{ fontSize: '9px', color: 'var(--accent-blue)' }}>{item.type}</span>
                        <p style={{ fontSize: '11px', color: 'var(--color-text-secondary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', minHeight: '32px' }}>
                          "{item.prompt}"
                        </p>
                        <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', marginTop: '4px' }}>{item.timestamp}</span>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                          <a href={item.src} download={`intel_art_${item.id}.png`} className="canvas-action-btn primary" style={{ padding: '6px 12px', fontSize: '11px', flexGrow: 1, borderRadius: '4px', textDecoration: 'none' }}>
                            <Download size={12} /> Save
                          </a>
                          <button
                            className="canvas-action-btn secondary"
                            style={{ padding: '6px', borderRadius: '4px' }}
                            onClick={() => {
                              const updated = historyItems.filter(h => h.id !== item.id);
                              setHistoryItems(updated);
                              localStorage.setItem('intel_history', JSON.stringify(updated));
                            }}
                            title="Delete Item"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}
              </motion.div>
            ) : (
              <>
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
              </>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* 📥 Run Locally Setup Modal */}
      <AnimatePresence>
        {showDownloadModal && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowDownloadModal(false)}
          >
            <motion.div
              className="modal-card"
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button className="modal-close-btn" onClick={() => setShowDownloadModal(false)}>
                <X size={20} />
              </button>

              <div className="modal-header-desc">
                <h3>📥 Local Engine Setup</h3>
                <p style={{ color: '#ef4444', fontWeight: '600', fontSize: '14px', margin: '0 0 12px 0', lineHeight: '1.4' }}>
                  You need to download this project and run it locally to get those features due to need for GPU.
                </p>
                <p>
                  To unlock high-fidelity subject preservation, custom model support, and unlimited free generations, please set up the project on your local machine with PyTorch.
                </p>
              </div>

              <div className="modal-steps">
                <div className="modal-step-item">
                  <strong>Step 1:</strong> Download and extract the project ZIP file.
                </div>
                <div className="modal-step-item">
                  <strong>Step 2:</strong> Install python dependencies (requires Python 3.10+):
                  <pre style={{ margin: '8px 0 0 0', padding: '8px', background: 'rgba(0,0,0,0.4)', borderRadius: '4px', overflowX: 'auto', color: '#10b981' }}>
                    pip install -r requirements.txt
                  </pre>
                </div>
                <div className="modal-step-item">
                  <strong>Step 3:</strong> Start the local development server:
                  <pre style={{ margin: '8px 0 0 0', padding: '8px', background: 'rgba(0,0,0,0.4)', borderRadius: '4px', overflowX: 'auto', color: '#10b981' }}>
                    python app.py
                  </pre>
                </div>
              </div>

              <a
                href="/api/download-project"
                download="intel-studio.zip"
                className="primary-btn"
                style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '8px' }}
                onClick={() => setShowDownloadModal(false)}
              >
                <Download size={18} />
                <span>Download Project ZIP</span>
              </a>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ⚙️ API Settings Modal */}
      <AnimatePresence>
        {showSettingsModal && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowSettingsModal(false)}
          >
            <motion.div
              className="modal-card"
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button className="modal-close-btn" onClick={() => setShowSettingsModal(false)}>
                <X size={20} />
              </button>

              <div className="modal-header-desc">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <Settings className="brand-icon" style={{ color: 'var(--accent-blue)', margin: 0 }} />
                  <h3 style={{ margin: 0 }}>API Credentials</h3>
                </div>
                <p>
                  Configure your personal API keys below. If left blank, generations will fall back to server-side credentials when available.
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', margin: '20px 0' }}>
                <div className="input-group">
                  <label htmlFor="modalUnsplashKey">Unsplash Access Key</label>
                  <input
                    type="password"
                    id="modalUnsplashKey"
                    placeholder="Enter Unsplash Access Key..."
                    value={unsplashKey}
                    onChange={(e) => setUnsplashKey(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: '8px',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--color-text-primary)'
                    }}
                  />
                  <div style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
                    Used for search library queries.
                  </div>
                </div>

                <div className="input-group">
                  <label htmlFor="modalHfToken">Hugging Face Token</label>
                  <input
                    type="password"
                    id="modalHfToken"
                    placeholder="Enter Hugging Face Token (hf_...)"
                    value={hfToken}
                    onChange={(e) => setHfToken(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: '8px',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--color-text-primary)'
                    }}
                  />
                  <div style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
                    Used for Serverless Inference API (Text to Image).
                  </div>
                </div>

                <div className="input-group">
                  <label htmlFor="modalPollinationsKey">Pollinations API Key (Optional)</label>
                  <input
                    type="password"
                    id="modalPollinationsKey"
                    placeholder="Enter Pollinations API Key..."
                    value={pollinationsKey}
                    onChange={(e) => setPollinationsKey(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: '8px',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--color-text-primary)'
                    }}
                  />
                  <div style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
                    Optional developer key for Pollinations models.
                  </div>
                </div>
              </div>

              <button
                className="primary-btn"
                onClick={() => {
                  localStorage.setItem('unsplash_access_key', unsplashKey);
                  localStorage.setItem('huggingface_token', hfToken);
                  localStorage.setItem('pollinations_api_key', pollinationsKey);
                  setShowSettingsModal(false);
                }}
              >
                <span>Save Credentials</span>
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
