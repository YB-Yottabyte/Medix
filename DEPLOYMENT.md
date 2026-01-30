# Vercel Deployment Guide

## Prerequisites
1. Install Vercel CLI: `npm install -g vercel`
2. Login to Vercel: `vercel login`

## Deployment Steps

### 1. Deploy to Vercel
```bash
cd "/Users/sairithwikk/Desktop/College/Spring 2026/CSE 492/medical-qa-system"
vercel
```

### 2. Set Environment Variables (Required)
After deployment, go to your Vercel dashboard and set:

**Required:**
- `GROQ_API_KEY`: Your Groq API key for AI responses
- `VERCEL_ACCESS_PASSWORD`: Password for private access (optional)

**Optional:**
- `HF_HUB_OFFLINE`: Set to "1" to avoid Hugging Face timeouts

### 3. Enable Password Protection
In your Vercel project settings:
1. Go to Functions tab
2. Add environment variable: `VERCEL_ACCESS_PASSWORD=your_password`
3. The middleware will automatically protect your site

### 4. Custom Domain (Optional)
- Add your custom domain in Vercel dashboard
- Automatic HTTPS enabled

## Important Notes

### File Structure for Vercel:
```
medical-qa-system/
├── vercel.json          # Vercel configuration
├── api/
│   └── index.py         # Vercel entry point
├── app.py               # Main Flask app
├── requirements.txt     # Dependencies
├── runtime.txt          # Python version
└── [all other files]
```

### Environment Variables Needed:
- **GROQ_API_KEY**: Get from https://console.groq.com/keys
- **VERCEL_ACCESS_PASSWORD**: Your chosen password for private access

### Accessing Your Site:
- Public URL: https://your-project-name.vercel.app
- Private: Will prompt for password if configured

## Troubleshooting

### Common Issues:
1. **Cold starts**: First request may be slow (normal for serverless)
2. **File not found**: Ensure all paths use absolute imports
3. **Dependencies**: Check requirements.txt includes all needed packages

### Monitoring:
- Check Vercel dashboard for deployment logs
- View function logs for debugging
- Monitor usage and performance

## Security Notes:
- All data processing happens server-side
- API keys are secure in environment variables
- Password protection available for private access
- HTTPS enabled by default