🔬 optiq

optiq is an AI-powered dashboard designed to monitor and optimize industrial fractionation processes across multiple sectors. It focuses on improving efficiency, reducing energy consumption, and maintaining strict quality standards.

What it does

optiq helps industries like LNG processing, oil refining, pharmaceuticals, chemical manufacturing, and food production better manage separation processes. It uses predictive models to suggest optimal operating conditions and improve overall system performance.

The goal is simple:
lower costs, better output, smarter decisions.

Key features
Real-time monitoring of energy, purity, and system stability
AI-based recommendations for optimal setpoints
Multi-company support without changing the code
Clean industrial UI (dark theme, high contrast)
Secure deployment options (cloud or on-premise)
Quick start

Make sure you have:

Node.js ≥ 18
npm ≥ 9

Then run:

git clone https://github.com/devfarah6-design/optiq
cd optiq
npm install
npm run dev

Open your browser at:

http://localhost:3000
First-time setup
Triple-click the optiq logo in the header
Enter your company info (name, logo, sector)
The configuration is saved automatically in your browser
Configuration

optiq is built to switch between different companies without modifying the code.

Configuration can come from:

Environment variables
Injected window object
Local storage
Default demo fallback

Example:

export CLICFY_CONFIG='{"name":"TricOil Inc","sector":"Crude Oil"}'
npm start
Deployment
Quick demo (Netlify)
npm run deploy:netlify

Best for demos and testing.

Production (Docker)
npm run docker:build
npm run docker:compose:up

Best for private, secure environments.

Security
HTTPS encryption
Secure headers
Optional data encryption
Environment-based secrets
Ready for enterprise environments (HIPAA, ISO, GDPR)

Never hardcode secrets:

// wrong
const API_KEY = "secret";

// correct
const API_KEY = process.env.CLICFY_API_KEY;
API integration

Your backend should provide endpoints like:

GET /api/predictions
GET /api/recommendations
POST /api/setpoint/apply

You can also connect directly to industrial systems (e.g. OPC-UA).

Development

You can easily extend the system:

Add new metrics
Add new industrial sectors
Replace mock data with real APIs

Everything is designed to be modular and flexible.

Build
npm run build:prod

Output goes to:

dist/
Environment variables

Example:

VITE_API_BASE_URL=http://localhost:8000
VITE_DEBUG=true

Production:

VITE_API_BASE_URL=https://api.yourdomain.com
VITE_DATA_ENCRYPTION=true
Roadmap
Authentication system
Data export (CSV/PDF)
Alerts and notifications
Mobile app
Advanced analytics
SaaS platform
Support
GitHub Issues:
https://github.com/devfarah6-design/optiq/issues
Email:
limounifarah@gmail.com


Built for industrial optimization ⚙️


