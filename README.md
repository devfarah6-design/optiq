# 🔬 optiq - Intelligent Fractionation Optimization System

## About the Project

optiq is a sophisticated AI-driven dashboard for monitoring and optimizing fractionation processes across industrial sectors:
- **LNG Processing** - Liquefied Natural Gas fractionation
- **Crude Oil Refining** - Petroleum distillation optimization
- **Pharmaceutical Manufacturing** - Compound separation and purification
- **Chemical Processing** - Multi-component fractionation
- **Food & Beverage** - Component separation and quality control

The system uses predictive AI models to minimize energy consumption while maintaining strict quality standards, reducing operational costs and environmental impact.

---

## 🎨 Brand Identity

**optiq** features:
- **Industrial-grade UI** - Dark theme with sector-specific color schemes
- **Real-time Monitoring** - Live performance metrics with AI-powered trends
- **Smart Setpoint Advisor** - ML-based recommendations for optimal control
- **Multi-company Support** - Single app, multiple clients without code changes
- **Enterprise Security** - Data encryption, HIPAA-ready, on-premise deployment

---

## 🚀 Quick Start (5 minutes)

### Prerequisites
```bash
Node.js >= 18.0.0
npm >= 9.0.0
```

### Setup for Development

```bash
# 1. Clone and install
git clone https://github.com/devfarah6-design/optiq
cd optiq
npm install

# 2. Start development server
npm run dev

# 3. Open browser
# → http://localhost:3000
```

### First Time Configuration

1. **Triple-click the optiq logo** in the header
2. **Enter company details:**
   - Company Name: `TricOil Inc` (or your client)
   - Logo URL: `https://your-logo.png`
   - Sector: Select from dropdown (LNG, Oil, Pharma, Chemical, F&B)
3. **Configuration saves** to browser storage automatically


## ⚙️ Configuration System

### How It Works

The app supports **zero-code configuration switching** between different companies:

**Priority order (highest to lowest):**
1. **Environment Variables** - Set via Docker/Server
2. **Window Object** - Injected by HTML server
3. **Local Storage** - User's browser cache
4. **Default Demo** - Fallback

### Configuration Fields

```typescript
interface CompanyConfig {
  id: string;                    // Unique identifier
  name: string;                  // Display name
  logo: string;                  // Image URL or Base64
  sector: 'LNG' | 'Crude Oil' | 'Pharmaceutical' | 'Chemical' | 'Food & Beverage';
  apiEndpoint: string;           // Backend API URL
  apiKey?: string;               // Optional authentication
  dataEncryption: boolean;       // Enable encryption
  dataStorageLocation: 'local' | 'encrypted' | 'none';
}
```

### Example: Multi-Client Setup (No Code Changes)

**Client 1 - LNG Terminal:**
```bash
export CLICFY_CONFIG='{"name":"LNG Terminal Asia","logo":"...","sector":"LNG"}'
npm start
```

**Client 2 - Oil Refinery:**
```bash
export CLICFY_CONFIG='{"name":"TricOil Inc","logo":"...","sector":"Crude Oil"}'
npm start
```

Same code, different branding. That's optiq's power.

---

## 🌐 Deployment

### OPTION A: Netlify (Prototype) - 5 minutes

**Perfect for:** Quick demos, stakeholder presentations, testing

```bash
# 1. Login to Netlify
netlify login

# 2. Deploy in one command
npm run deploy:netlify

# 3. Your app is live!
# → https://your-site.netlify.app
```

**Pros:**
- ✅ Free tier available
- ✅ Auto-HTTPS
- ✅ Global CDN
- ✅ Zero config

---

### OPTION B: Docker + Private Server (Production) - 1 hour

**Perfect for:** Sensitive company data, HIPAA/ISO compliance, air-gapped systems

#### Quick Setup

```bash
# 1. Build Docker image
npm run docker:build

# 2. Run with Docker Compose
npm run docker:compose:up

# 3. Access via HTTPS
# → https://your-company.local
```



## 🔒 Security Features

### Prototype (Netlify)
- HTTPS/TLS encryption in transit
- Security headers configured
- XSS, CSRF protection
- Code minification

### Production (On-Premise)
- **Full data privacy** - Runs on your servers
- **Encryption at rest** - PostgreSQL encrypted volumes
- **Encryption in transit** - TLS 1.2+
- **Access control** - IP whitelisting, JWT auth
- **Audit logs** - All user actions logged
- **Compliance ready** - HIPAA, ISO 27001, GDPR

### Sensitive Data Handling

**NEVER hardcode credentials:**
```typescript
// ❌ WRONG
const API_KEY = "sk_live_secret";

// ✅ CORRECT
const API_KEY = process.env.CLICFY_API_KEY;
```

All secrets injected at runtime via environment variables or Docker.

---

## 📊 Features

### Real-Time Monitoring
- **Live Metrics** - Energy consumption, product purity, system stability
- **Process Trends** - Historical data visualization with Chart.js
- **Status Indicators** - System health at a glance

### AI-Powered Recommendations
- **Setpoint Advisor** - Machine learning-based optimization
- **Predicted Performance** - Expected energy & purity outcomes
- **One-Click Apply** - Implement recommendations instantly

### Multi-Company Support
- **No Code Changes** - Single code base, multiple companies
- **Instant Switching** - Change company config without rebuild
- **Sector-Specific Themes** - Colors/styling per industrial sector
- **Branded Interface** - Company logo and name in header

### Industrial Design
- **Dark Theme** - Optimized for 24/7 monitoring
- **High Contrast** - Easy readability in control rooms
- **Responsive Layout** - Works on desktop, tablet, mobile
- **Custom Fonts** - JetBrains Mono for data, Poppins for UI

---

## 🛠️ Development

### Add New Metrics

1. Add data field to `ProcessData` interface:
```typescript
interface ProcessData {
  energy: number;
  purity: number;
  stability: number;
  // Add new metric here:
  efficiency: number;
}
```

2. Add to metric cards in render:
```typescript
<div className="metric-card efficiency">
  <div className="metric-label">Efficiency</div>
  <div className="metric-value">{current.efficiency.toFixed(1)}%</div>
</div>
```

### Add New Industrial Sector

1. Update `SECTOR_COLORS` in `App.tsx`:
```typescript
const SECTOR_COLORS = {
  // ...existing...
  'Mining': { primary: '#8b4513', accent: '#a0522d', bg: '#1a1410' },
}
```

2. Update `CompanyConfig` type:
```typescript
sector: 'LNG' | 'Crude Oil' | 'Pharmaceutical' | 'Chemical' | 'Food & Beverage' | 'Mining';
```

### Connect Real API

Replace mock data in `App.tsx`:

```typescript
// Current: Mock data
const generateMockReadings = () => Array(33).fill(0).map(() => Math.random() * 2 - 1);

// Replace with: Real API
async function getRealReadings() {
  const response = await fetch(`${config.apiEndpoint}/readings`);
  const data = await response.json();
  return data.readings;
}
```

---

## 📦 Build & Production

### Production Build
```bash
npm run build:prod
# Outputs to: dist/
```

### Optimize for Production
- ✅ Minified CSS & JS
- ✅ Code splitting (Chart.js in separate bundle)
- ✅ Sourcemaps disabled (security)
- ✅ Console logs removed
- ✅ Tree-shaking enabled

---

## 🔧 Environment Variables

### For Development
```bash
VITE_API_BASE_URL=http://localhost:8000
VITE_DEBUG=true
```

### For Production (Netlify)
```bash
VITE_API_BASE_URL=https://api.yourdomain.com
VITE_DATA_ENCRYPTION=true
VITE_DEBUG=false
```

### For On-Premise (Docker)
```bash
VITE_API_BASE_URL=https://internal-api.company.local
VITE_DATA_ENCRYPTION=true
CLICFY_CONFIG={"name":"Company","logo":"...","sector":"..."}
CLICFY_API_KEY=sk_your_secret_key
DB_PASSWORD=your_secure_password
JWT_SECRET=your_jwt_secret
```

---

## 📱 Mobile Responsive

The dashboard is fully responsive:
- **Desktop (1400px+)** - 3-column layout
- **Tablet (768px-1400px)** - 2-column layout
- **Mobile (<768px)** - 1-column stacked layout

---

## 🤝 Integration

### API Endpoints Required

Your backend should provide:

```
GET  /api/predictions
     Returns: { energy, purity, stability, timestamp }

GET  /api/recommendations
     Returns: { recommended_sp, expected_energy, expected_purity }

POST /api/setpoint/apply
     Body: { sp: [45, 52, 38] }
     Returns: { status, applied_at }
```

### OPC-UA Integration

For real process data:
```typescript
// Connect to OPC-UA server
const client = await connect('opc.tcp://plc-server:4840');
const readings = await client.read([
  'ns=2;s=Fractionator.Energy',
  'ns=2;s=Fractionator.Purity',
  'ns=2;s=Fractionator.Stability',
]);
```

---

## 🐛 Troubleshooting

### Config not loading
- Check browser console for errors
- Verify `localStorage` is enabled
- Clear cache: `localStorage.clear()`

### API connection fails
- Verify `VITE_API_BASE_URL` is correct
- Check CORS settings on backend
- Inspect network tab in DevTools

### Styles not applied
- Clear browser cache (Ctrl+Shift+Delete)
- Check CSS file is in `src/` folder
- Verify imports in App.tsx

---

## 📚 Documentation

- **Deployment** - See `DEPLOYMENT_GUIDE.md`
- **API Docs** - See `backend/docs/api.md`
- **Architecture** - See `docs/architecture.md`
- **Security** - See `docs/security.md`

---

## 🎯 Roadmap

### v1.1 (Q2 2024)
- [ ] Multi-user authentication
- [ ] Historical data export (CSV/PDF)
- [ ] Email alerts for anomalies
- [ ] Mobile app (React Native)

### v1.2 (Q3 2024)
- [ ] Advanced analytics & forecasting
- [ ] Custom report builder
- [ ] Integration with ERP systems
- [ ] Multi-language support

### v2.0 (Q4 2024)
- [ ] SaaS platform
- [ ] White-label capabilities
- [ ] Advanced role-based access
- [ ] Machine learning model training UI

---

## 📄 License

MIT License - See LICENSE file

---

## 🤝 Support

For issues or questions:
- GitHub Issues: https://github.com/devfarah6-design/optiq/issues
- Email: limounifarah@gmail.com
- Docs: https://drive.google.com/drive/u/0/folders/1qVCsiWRrWzPPWejZGWEXTGM_J3Hm67hy
---

## 🎉 Quick Links

| Goal | Action |
|------|--------|
| Try it now | `npm run dev` |
| Deploy prototype | `npm run deploy:netlify` |
| Deploy production | `npm run docker:compose:up` |
| Build Docker image | `npm run docker:build` |
| View logs | `npm run docker:compose:logs` |

---

**Made with ❤️ for Industrial Optimization**#   o p t i q  
 