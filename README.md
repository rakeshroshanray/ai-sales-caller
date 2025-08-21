# AI Sales Caller

An intelligent AI-powered sales calling system that uses Twilio and OpenAI's Realtime API to conduct human-like voice conversations with potential clients.

## Features

- 🤖 **AI-Powered Conversations**: Uses OpenAI's Realtime API for natural, human-like voice interactions
- 📞 **Outbound Calling**: Initiates calls using Twilio's API
- 🎯 **Sales Script Integration**: Follows customizable sales scripts with objection handling
- 🎧 **Real-time Interruption**: AI stops speaking when the user starts talking
- 💬 **Natural Turn-taking**: Human-like conversation flow with proper pauses and responses
- 📱 **Web Interface**: Simple HTML interface to input phone numbers and initiate calls

## Technology Stack

- **Backend**: Node.js with Express
- **Voice API**: Twilio for call handling and media streaming
- **AI**: OpenAI Realtime API for conversational AI
- **Tunneling**: Cloudflare Tunnel for public webhook endpoints
- **WebSockets**: Real-time audio streaming between Twilio and OpenAI

## Prerequisites

- Node.js (v16 or higher)
- Twilio Account with API credentials
- OpenAI API key with Realtime API access
- Cloudflare Tunnel (or similar tunneling service)

## Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd AI-Caller
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   Create a `.env` file in the root directory:
   ```env
   TWILIO_ACCOUNT_SID=your_twilio_account_sid
   TWILIO_AUTH_TOKEN=your_twilio_auth_token
   TWILIO_NUMBER=your_twilio_phone_number
   OPENAI_API_KEY=your_openai_api_key
   APP_DOMAIN=your_public_domain_for_webhooks
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

5. **Set up tunneling**
   ```bash
   cloudflared tunnel --url http://localhost:3000 --no-autoupdate --protocol http2
   ```

6. **Update APP_DOMAIN**
   Update the `APP_DOMAIN` in your `.env` file with the tunnel URL provided by cloudflared.

## Usage

1. Open your browser and navigate to `http://localhost:3000`
2. Enter a phone number in the input field
3. Click "Make Call" to initiate an AI sales call
4. The AI will follow the sales script and handle objections naturally

## Project Structure

```
AI-Caller/
├── public/
│   └── index.html          # Web interface for phone input
├── server.js               # Main server logic
├── package.json            # Dependencies and scripts
├── .env                    # Environment variables (not in git)
├── .gitignore             # Git ignore rules
└── README.md              # This file
```

## Key Features Explained

### Real-time Interruption Detection
The system monitors audio input and immediately stops the AI when the user starts speaking, ensuring natural conversation flow.

### Sales Script Integration
The AI follows a comprehensive sales script for real estate broker outreach, including:
- Greeting and introduction
- Value proposition
- Objection handling
- Call-to-action

### Audio Buffer Management
Sophisticated audio buffer handling ensures smooth conversation without lag or audio artifacts.

## Configuration

### Customizing the Sales Script
Edit the `SALES_SCRIPT` constant in `server.js` to modify the AI's behavior and responses.

### Adjusting Interruption Sensitivity
Modify these parameters in `server.js`:
- `audioBufferSize > 2000`: Audio threshold for detecting user speech
- `sustainedSpeechThreshold = 1000`: Time (ms) before interrupting AI
- `lastCommitMs > 1500`: Frequency of audio buffer commits

## Troubleshooting

### Common Issues

1. **Call drops immediately**
   - Check if your tunnel URL is accessible
   - Verify Twilio credentials
   - Ensure APP_DOMAIN is correctly set

2. **AI doesn't respond naturally**
   - Check OpenAI API key and quota
   - Verify Realtime API access
   - Review sales script configuration

3. **Audio quality issues**
   - Check network connectivity
   - Verify audio buffer settings
   - Monitor server logs for errors

### Logs
The application provides detailed logging for debugging:
- `[Twilio WS]`: WebSocket connection events
- `[OpenAI Event]`: AI response events
- `[Conversation]`: Conversation flow events
- `[Audio]`: Audio buffer management

## Security Notes

- Never commit your `.env` file to version control
- Keep your API keys secure
- Use HTTPS in production
- Monitor API usage and costs

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Support

For issues and questions, please open an issue on GitHub or contact the development team.
