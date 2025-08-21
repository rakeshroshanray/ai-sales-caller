require('dotenv').config();
const express = require('express');
const cors = require('cors');
const twilio = require('twilio');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_NUMBER,
  OPENAI_API_KEY,
  APP_DOMAIN,
  PORT
} = process.env;

const PORT_NUMBER = Number(PORT) || 3000;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_NUMBER || !OPENAI_API_KEY || !APP_DOMAIN) {
  console.warn('Warning: Missing required environment variables. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_NUMBER, OPENAI_API_KEY, APP_DOMAIN');
}

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Simple healthcheck
app.get('/health', (_req, res) => res.status(200).json({ ok: true }));

// Start outbound call
app.post('/api/call', async (req, res) => {
  const { phoneNumber } = req.body || {};
  if (!phoneNumber) {
    return res.status(400).json({ error: 'phoneNumber is required in body' });
  }
  try {
    const call = await twilioClient.calls.create({
      url: `https://${APP_DOMAIN}/twiml`,
      to: phoneNumber,
      from: TWILIO_NUMBER,
      statusCallback: `https://${APP_DOMAIN}/status`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST'
    });
    res.status(200).json({ message: 'Call initiated', callSid: call.sid });
  } catch (error) {
    console.error('Error creating call:', error);
    res.status(500).json({ error: 'Failed to initiate call', details: String(error?.message || error) });
  }
});

// TwiML to connect media stream
function buildTwiml() {
  const response = new twilio.twiml.VoiceResponse();
  // Optional brief message before connecting
  // response.say({ voice: 'Polly.Joanna' }, 'Connecting you to our AI assistant.');
  const connect = response.connect();
  connect.stream({
    url: `wss://${APP_DOMAIN}/media-stream`,
    statusCallback: `https://${APP_DOMAIN}/stream-status`,
    statusCallbackMethod: 'POST'
  });
  return response.toString();
}

app.get('/twiml', (req, res) => {
  try { console.log('[HTTP] GET /twiml from', req.ip, req.headers['user-agent']); } catch(_) {}
  res.type('text/xml').send(buildTwiml());
});

app.post('/twiml', (req, res) => {
  try { console.log('[HTTP] POST /twiml from', req.ip, req.headers['user-agent']); } catch(_) {}
  res.type('text/xml').send(buildTwiml());
});

// Twilio status callback logger
app.post('/status', express.urlencoded({ extended: true }), (req, res) => {
  try {
    console.log('[Twilio Status]', req.body);
  } catch (_) {}
  res.sendStatus(200);
});

// Twilio <Stream> status callback (start/stop/errors)
app.post('/stream-status', express.urlencoded({ extended: true }), (req, res) => {
  try {
    console.log('[Stream Status]', req.body);
  } catch (_) {}
  res.sendStatus(200);
});

// WebSocket server for Twilio Media Streams
// Accept Twilio's "audio" subprotocol to prevent immediate hangups
const wss = new WebSocket.Server({
  noServer: true,
  handleProtocols: (protocols /* Set<string> */, request) => {
    try {
      // Twilio offers the "audio" subprotocol
      if (protocols && typeof protocols.has === 'function' && protocols.has('audio')) {
        return 'audio';
      }
      // Fallback to the first offered protocol if any
      const first = protocols && typeof protocols.values === 'function' ? protocols.values().next().value : undefined;
      return first || false;
    } catch (e) {
      return false;
    }
  }
});

// Sales script and behaviors (embedded as instructions)
const SALES_SCRIPT = `You are a friendly but persistent sales assistant making outbound calls to real estate brokers. You're calling about a broker launch event for King William rentals in downtown Hamilton.

CRITICAL CONVERSATION RULES:
1. COMPLETE your responses fully when not interrupted - do not stop speaking unless the person starts talking
2. Only stop speaking when the person actually begins talking (not during silence)
3. Listen carefully to what they say and respond appropriately
4. NEVER repeat the same response or phrase - always rephrase your answers differently
5. Be conversational and natural, not robotic
6. If interrupted, acknowledge what they said and respond to their specific point

Your goal: Invite brokers to an exclusive launch event on July 17th at 12PM for King William rentals.

Key information to share naturally (but never repeat verbatim):
- King William is a new rental property in downtown Hamilton
- The event is on July 17th at 12PM, catered, on-site
- Commissions are paid on leases
- Easy leasing process for clients
- Great opportunity in current market

When handling objections, respond naturally and differently each time:
- If they don't usually do rentals: "I understand that perspective, but here's why this could be valuable for you - even if your current clients aren't looking for rentals, having King William in your toolkit gives you a great Plan B. We've had brokers tell us clients circled back months later when they didn't qualify for financing or were waiting out the market."
- If they're busy: "Totally fair - I know everyone's juggling a lot right now. If you can pop by even for a quick walkthrough and grab some lunch, it's worth it. You'll walk away with everything you need to start leasing - and you can start earning right away if clients are a fit."
- If their clients aren't looking to rent: "Sometimes it's the referrals you don't expect. We've had brokers tell us clients circled back months later when they didn't qualify for financing. Having King William in your toolkit gives you a great Plan B. And with commissions in place, it's worth being first in line."
- If they question if it's worth attending: "I get it - a lot of launches feel the same. But this one's different: You'll get early access to a strong lease product, meet the team and see how smooth the process is, and commissions are already being paid."

IMPORTANT: Always complete your thoughts fully. Only stop speaking if the person interrupts you. If they're silent, continue with your response until you've made your complete point.`;

function extractKeyPoints(transcript) {
  // Extract key points from transcript to track what's been said
  const keyPoints = [];
  const sentences = transcript.split(/[.!?]+/).filter(s => s.trim().length > 10);
  
  // Take the most important sentences (first 2-3)
  for (let i = 0; i < Math.min(3, sentences.length); i++) {
    const sentence = sentences[i].trim();
    if (sentence.length > 10) {
      keyPoints.push(sentence);
    }
  }
  
  return keyPoints;
}

function connectOpenAIRealtime() {
  const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
  const headers = {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    'OpenAI-Beta': 'realtime=v1'
  };
  return new WebSocket(url, { headers });
}

wss.on('connection', (twilioWs) => {
  console.log('[Twilio WS] connection opened');
  let streamSid = null;
  let lastCommitMs = 0;
  let pingInterval = null;
  let conversationStarted = false;
  let audioBufferSize = 0;
  let audioChunks = [];
  let isAISpeaking = false;
  let userInterrupted = false;
  let lastUserSpeechTime = 0;
  let consecutiveEmptyCommits = 0;
  let maxEmptyCommits = 3;
  let conversationHistory = [];
  let lastResponseType = '';
  let userSpeechStartTime = 0;
  let sustainedSpeechThreshold = 1000; // 1 second of sustained speech

  // Connect to OpenAI Realtime API
  const openAiWs = connectOpenAIRealtime();

  const safeSendTwilio = (obj) => {
    try {
      if (twilioWs.readyState === WebSocket.OPEN) {
        twilioWs.send(JSON.stringify(obj));
      }
    } catch (err) {
      console.error('Error sending to Twilio WS:', err);
    }
  };

  openAiWs.on('open', () => {
    console.log('[OpenAI WS] connected');
    // Configure session for µ-law passthrough and server-side VAD.
    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad' },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: 'alloy',
        instructions: SALES_SCRIPT,
        modalities: ['text', 'audio'],
        temperature: 0.7
      }
    };
    openAiWs.send(JSON.stringify(sessionUpdate));

    // Optional: kick off with a friendly greeting once audio starts flowing.
    // openAiWs.send(JSON.stringify({ type: 'response.create', response: { instructions: 'Start the conversation with a brief greeting.' } }));
  });

  // Relay inbound audio from Twilio to OpenAI
  twilioWs.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      switch (data.event) {
        case 'connected':
          console.log('[Twilio WS] connected event');
          break;
        case 'start':
          streamSid = data.start?.streamSid || null;
          console.log('[Twilio WS] stream started', streamSid);
          // Let the conversation start naturally without forcing a greeting
          conversationStarted = false;
          
          // Give the AI a moment to start the conversation naturally
          setTimeout(() => {
            if (openAiWs.readyState === WebSocket.OPEN && !conversationStarted) {
              console.log('[Conversation] Triggering natural start');
              const context = conversationHistory.length > 0 ? 
                `Previous conversation points: ${conversationHistory.join(', ')}. Avoid repeating these.` : 
                'This is the start of the conversation.';
              
              openAiWs.send(JSON.stringify({
                type: 'response.create',
                response: {
                  instructions: `Start the conversation naturally. ${context} Introduce yourself briefly and ask if they have a moment to discuss a new rental opportunity.`
                }
              }));
              conversationStarted = true;
            }
          }, 1000);
          break;
        case 'media': {
          const audioBase64 = data.media?.payload;
          if (audioBase64) {
            const audioAppend = { type: 'input_audio_buffer.append', audio: audioBase64 };
            if (openAiWs.readyState === WebSocket.OPEN) {
              openAiWs.send(JSON.stringify(audioAppend));
              
              // Track audio buffer size
              audioChunks.push(audioBase64);
              audioBufferSize += audioBase64.length;
              
              // Detect user speech - interrupt IMMEDIATELY while AI is speaking
              const now = Date.now();
              if (audioBufferSize > 2000) { // Sufficient audio to indicate user is speaking
                if (userSpeechStartTime === 0) {
                  userSpeechStartTime = now; // Start tracking sustained speech
                }
                lastUserSpeechTime = now;
                
                // Interrupt IMMEDIATELY if AI is speaking and user has been speaking for 1+ seconds
                if (isAISpeaking && !userInterrupted && (now - userSpeechStartTime > 1000)) {
                  userInterrupted = true;
                  console.log(`[Conversation] User interrupted AI after ${Math.round((now - userSpeechStartTime)/1000)}s - STOPPING NOW`);
                  // Cancel the response immediately
                  openAiWs.send(JSON.stringify({ type: 'response.cancel' }));
                  isAISpeaking = false;
                }
              } else {
                // Reset speech tracking if audio buffer is small
                if (now - lastUserSpeechTime > 500) { // Give 500ms grace period
                  userSpeechStartTime = 0;
                }
              }
              
              // Only commit if we have sufficient audio data and haven't exceeded empty commit limit
              if (now - lastCommitMs > 1500 && audioBufferSize > 2000 && consecutiveEmptyCommits < maxEmptyCommits) {
                lastCommitMs = now;
                console.log(`[Audio] Committing buffer: ${audioBufferSize} bytes`);
                openAiWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
                
                // Reset buffer tracking
                audioChunks = [];
                audioBufferSize = 0;
                consecutiveEmptyCommits = 0;
              }
            }
          }
          break;
        }
        case 'stop':
          console.log('[Twilio WS] stream stopped');
          
          // Final commit of any remaining audio
          if (openAiWs.readyState === WebSocket.OPEN && audioBufferSize > 0) {
            console.log('[Audio] Final commit of remaining audio buffer');
            openAiWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
          }
          
          try { openAiWs.close(); } catch (_) {}
          try { twilioWs.close(); } catch (_) {}
          break;
        default:
          break;
      }
    } catch (err) {
      console.error('Error handling Twilio WS message:', err);
    }
  });

  // Heartbeat to keep WS alive
  try {
    pingInterval = setInterval(() => {
      try {
        if (twilioWs.readyState === WebSocket.OPEN) twilioWs.ping();
        if (openAiWs.readyState === WebSocket.OPEN) openAiWs.ping();
      } catch (_) {}
    }, 20000);
  } catch (_) {}

  // Handle OpenAI WebSocket errors
  openAiWs.on('error', (error) => {
    console.error('[OpenAI WS] Error:', error);
    // Don't crash the application, just log the error
  });

  openAiWs.on('close', (code, reason) => {
    console.log('[OpenAI WS] closed', code, reason);
    // Clean up resources
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
  });

  // Handle Twilio WebSocket errors
  twilioWs.on('error', (error) => {
    console.error('[Twilio WS] Error:', error);
    // Don't crash the application, just log the error
  });

  // Relay OpenAI audio deltas back to Twilio stream
  openAiWs.on('message', (message) => {
    try {
      const evt = JSON.parse(message.toString());
      
      // Log all OpenAI events for debugging
      if (evt.type && evt.type !== 'response.audio.delta') {
        console.log('[OpenAI Event]', evt.type, evt);
      }
      
      if (evt.type === 'response.audio.delta' && evt.delta && streamSid) {
        // Track when AI starts speaking
        if (!isAISpeaking) {
          isAISpeaking = true;
          userInterrupted = false;
          console.log('[Conversation] AI started speaking');
        }
        
        safeSendTwilio({
          event: 'media',
          streamSid,
          media: { payload: evt.delta }
        });
      }
      
      // Handle conversation completion to prevent loops
      if (evt.type === 'response.completed') {
        console.log('[OpenAI] Response completed, ready for next input');
        isAISpeaking = false;
        userInterrupted = false; // Reset interruption flag
        userSpeechStartTime = 0; // Reset speech tracking
        
        // Track conversation history to prevent repetition
        if (evt.response?.output?.[0]?.content?.[0]?.transcript) {
          const transcript = evt.response.output[0].content[0].transcript;
          const keyPoints = extractKeyPoints(transcript);
          conversationHistory.push(...keyPoints);
          console.log('[Conversation] History updated:', conversationHistory);
        }
        
        // Add natural pause before listening for user input
        setTimeout(() => {
          if (!userInterrupted) {
            console.log('[Conversation] Natural pause - ready for user input');
          }
        }, 1000);
      }
      
      // Handle text output for debugging
      if (evt.type === 'response.output_text.delta') {
        process.stdout.write(evt.delta || '');
      }
      
      // Handle audio buffer errors gracefully
      if (evt.type === 'error' && evt.error?.code === 'input_audio_buffer_commit_empty') {
        consecutiveEmptyCommits++;
        console.log(`[OpenAI] Audio buffer error (${consecutiveEmptyCommits}/${maxEmptyCommits}) - continuing conversation`);
        
        // If we've had too many empty commits, reset the buffer
        if (consecutiveEmptyCommits >= maxEmptyCommits) {
          console.log('[OpenAI] Too many empty commits - resetting buffer');
          audioChunks = [];
          audioBufferSize = 0;
          consecutiveEmptyCommits = 0;
        }
        return; // Don't crash the application
      }
      
      // Handle response cancel errors gracefully
      if (evt.type === 'error' && evt.error?.code === 'response_cancel_not_active') {
        console.log('[OpenAI] Response already completed - ignoring cancel request');
        return; // Don't crash the application
      }
      
    } catch (err) {
      console.error('Error handling OpenAI WS message:', err);
      // Don't crash the application, just log the error
    }
  });

  twilioWs.on('close', (code, reason) => {
    console.log('[Twilio WS] closed', code, reason?.toString?.() || '');
    try { if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close(); } catch (_) {}
    if (pingInterval) clearInterval(pingInterval);
  });

  openAiWs.on('error', (err) => console.error('OpenAI WS error:', err?.message || err));
});

server.on('upgrade', (request, socket, head) => {
  const path = request.url || '';
  if (path === '/media-stream' || path.startsWith('/media-stream?')) {
    try {
      console.log('[HTTP upgrade] /media-stream', {
        protocol: request.headers['sec-websocket-protocol'],
        origin: request.headers['origin']
      });
    } catch (_) {}
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT_NUMBER, () => {
  console.log(`Server running on http://localhost:${PORT_NUMBER}`);
});


