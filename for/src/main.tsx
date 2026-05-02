// src/main.tsx  ← keep this one, delete the CRA-style index.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { injectSpeedInsights } from '@vercel/speed-insights'
import App from './App'
import './styles/global.css'

// Initialize Vercel Speed Insights
injectSpeedInsights()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)