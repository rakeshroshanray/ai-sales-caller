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

CRITICAL: You must ALWAYS respond to what the person ACTUALLY says, not what you think they might have said. If their speech is unclear or garbled, ask them to repeat it clearly. Never make assumptions about what they said - always respond to the actual words you hear.

  CRITICAL CONVERSATION RULES:
  1. COMPLETE your responses fully when not interrupted - do not stop speaking unless the person starts talking
  2. Only stop speaking when the person actually begins talking (not during silence)
  3. Listen carefully to what they say and respond appropriately
  4. NEVER repeat the same response or phrase - always rephrase your answers differently
  5. Be conversational and natural, not robotic
  6. If interrupted, acknowledge what they said and respond to their specific point
  7. After completing a response, WAIT for the person to speak before continuing
  8. Do not immediately start a new response after finishing one - give the person time to respond
  9. This should be a natural back-and-forth conversation, not a monologue

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

SPECIFIC RESPONSES FOR COMMON REQUESTS:
- If they ask for email details or information: "Absolutely! I'd be happy to send you all the event details via email. Could you please provide me with your email address? I'll make sure you get the complete information package including event details, property specs, and commission structure."
- If they provide an email address: "I heard you say [repeat the email as heard]. Is that correct? If not, please repeat it slowly and clearly so I can get it right."
- If the email transcription seems unclear or contains unusual characters: "I want to make sure I get your email address exactly right. Could you please spell it out for me? For example, if your email is john at gmail dot com, please say it that way."
- If their speech is unclear or garbled: "I'm having trouble understanding what you said. Could you please repeat that more slowly and clearly?"
- If you're unsure about what they said: "I didn't catch that clearly. Could you please repeat what you just said?"

CONTEXT-AWARE RESPONSES:
- If they say they're busy: "I understand you're busy. Would a different time work better for you, or would you prefer I send you the information package so you can review it at your convenience?"
- If they say they're not interested: "I appreciate your honesty. Is there a specific reason you're not interested, or would you prefer to receive the information to keep on file for future reference?"
- If they ask about pricing: "The rental rates and commission structure are part of the detailed package we'll share at the event. But I can tell you that commissions are competitive and we make the leasing process very straightforward for your clients."
- If they ask about location: "King William is located in downtown Hamilton, which is seeing great growth. The exact address and directions will be in the email package I send you."
- If they say they'll think about it: "That's perfectly fine. Would you like me to send you the information package so you have all the details when you're ready to decide?"
- If they ask about pricing or rates: "The rental rates and commission structure are part of the detailed package we'll share at the event. But I can tell you that commissions are competitive and we make the leasing process very straightforward for your clients."
- If they ask about the property location: "King William is located in downtown Hamilton, which is seeing great growth. The exact address and directions will be in the email package I send you."
- If they ask about timing or scheduling: "The event is on July 17th at 12PM, and it's about an hour long including lunch. If that time doesn't work, I can definitely send you the information package and we can arrange a private tour at your convenience."

  IMPORTANT: Always complete your thoughts fully. Only stop speaking if the person interrupts you. If they're silent, continue with your response until you've made your complete point. After finishing your response, wait for them to speak before continuing the conversation.

UNDERSTANDING AND RESPONSE ACCURACY:
- Listen carefully to what the person actually says, not what you think they might have said
- If their words are unclear or garbled, ask them to repeat clearly
- Respond directly to their specific words and meaning
- If they say "I'm busy," respond to that specific statement about being busy
- If they say "I'm not interested," respond to that specific statement about not being interested
- Never give generic responses that don't match what they actually said
- Always acknowledge their specific words before responding

CONVERSATION FLOW GUIDANCE:
- When someone asks for information via email, immediately offer to send it and ask for their email address
- Don't ask them to contact you - you should be the one taking action
- If they provide an email address, confirm it back to them and assure them you'll send the information
- Always be proactive about following up with information rather than asking them to reach out
- When transcribing email addresses, if the transcription seems unclear or contains unusual characters, ask them to spell it out clearly
- Always repeat back the email address as you heard it and ask for confirmation
- If they correct the email, acknowledge the correction and confirm the correct version`;

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
  let sustainedSpeechThreshold = 800; // 800ms of sustained speech
  
  // Voice Activity Detection (VAD) variables
  let speechPatterns = [];
  let lastAudioLevel = 0;
  let consecutiveSpeechChunks = 0;
  let consecutiveSilenceChunks = 0;
  let vadThreshold = 600; // More sensitive threshold for better speech detection
  let speechConfidence = 0;
  
  // Turn-taking conversation control
  let waitingForUserInput = false;
  let lastResponseTime = 0;
  let userSilenceTimeout = null;
  let minSilenceBeforeNextResponse = 3000; // 3 seconds of silence before AI can speak again

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
                   instructions: `Start the conversation naturally. ${context} Introduce yourself briefly and ask if they have a moment to discuss a new rental opportunity. After your introduction, wait for their response before continuing.`
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
              
              // Intelligent Voice Activity Detection (VAD)
              const now = Date.now();
              const currentAudioLevel = audioBase64.length;
              
              // INTELLIGENT VAD: Wait for user to complete their thought
              if (currentAudioLevel > vadThreshold) {
                consecutiveSpeechChunks++;
                consecutiveSilenceChunks = 0;
                
                // Start tracking when user begins speaking
                if (userSpeechStartTime === 0) {
                  userSpeechStartTime = now;
                  console.log(`[VAD] User started speaking - tracking completion`);
                }
                
                // Only interrupt if user has been speaking for a sustained period (indicating they're not just pausing)
                const speechDuration = now - userSpeechStartTime;
                if (speechDuration > 2000 && isAISpeaking && !userInterrupted) { // Wait 2 seconds before interrupting
                  userInterrupted = true;
                  console.log(`[VAD] User has been speaking for ${Math.round(speechDuration/1000)}s - interrupting AI`);
                  openAiWs.send(JSON.stringify({ type: 'response.cancel' }));
                  isAISpeaking = false;
                }
                
                // If user starts speaking while AI is waiting for input, clear the silence timeout
                if (waitingForUserInput && !isAISpeaking) {
                  console.log('[VAD] User started speaking - clearing silence timeout');
                  if (userSilenceTimeout) {
                    clearTimeout(userSilenceTimeout);
                    userSilenceTimeout = null;
                  }
                  waitingForUserInput = false;
                }
              } else {
                consecutiveSilenceChunks++;
                consecutiveSpeechChunks = 0;
                
                // Only reset speech tracking after a longer period of silence (indicating user finished speaking)
                if (consecutiveSilenceChunks >= 8) { // Increased to 8 chunks (about 4 seconds) to allow for natural pauses
                  if (userSpeechStartTime > 0) {
                    userSpeechStartTime = 0;
                    console.log(`[VAD] User finished speaking - resetting speech tracking`);
                  }
                }
              }
              
              lastAudioLevel = currentAudioLevel;
              lastUserSpeechTime = now;
              
              // Improved audio buffer management for better transcription
              if (now - lastCommitMs > 800 && audioBufferSize > 2000 && consecutiveEmptyCommits < maxEmptyCommits) {
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
    
    // Handle audio buffer errors more gracefully
    if (error.message && error.message.includes('input_audio_buffer_commit_empty')) {
      console.log('[OpenAI] Audio buffer error - adjusting buffer size');
      // Increase buffer size for next commit
      audioBufferSize = Math.max(audioBufferSize, 3000);
    }
    
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
                  console.log('[OpenAI] Response completed, waiting for user input');
                  isAISpeaking = false;
                  userInterrupted = false; // Reset interruption flag
                  userSpeechStartTime = 0; // Reset speech tracking
                  lastResponseTime = Date.now();
                  waitingForUserInput = true; // Now waiting for user to speak
                  
                  // Reset VAD state
                  speechConfidence = 0;
                  consecutiveSpeechChunks = 0;
                  consecutiveSilenceChunks = 0;
                  
                  // Clear any existing silence timeout
                  if (userSilenceTimeout) {
                    clearTimeout(userSilenceTimeout);
                  }
                  
                  // Track conversation history to prevent repetition
                  if (evt.response?.output?.[0]?.content?.[0]?.transcript) {
                    const transcript = evt.response.output[0].content[0].transcript;
                    const keyPoints = extractKeyPoints(transcript);
                    conversationHistory.push(...keyPoints);
                    console.log('[Conversation] History updated:', conversationHistory);
                  }
                  
                  // Set a timeout to check if user has been silent for too long
                  userSilenceTimeout = setTimeout(() => {
                    if (waitingForUserInput && !userInterrupted && openAiWs.readyState === WebSocket.OPEN) {
                      console.log('[Conversation] User has been silent for 3 seconds, AI will continue naturally');
                      waitingForUserInput = false;
                      
                                        // AI can now continue the conversation naturally
                  // This could be asking a follow-up question, handling an objection, or moving the conversation forward
                  openAiWs.send(JSON.stringify({
                    type: 'response.create',
                    response: {
                      instructions: `The person has been silent for a moment. Continue the conversation naturally. This could mean:
                      1. They might be thinking - give them a moment and then ask if they have any questions
                      2. They might not have heard you clearly - briefly recap your main point and ask for their thoughts
                      3. They might be interested but hesitant - ask a gentle follow-up question to engage them
                      4. Keep it conversational and don't repeat what you just said. Move the conversation forward naturally.
                      Be brief and engaging.
                      
                      IMPORTANT: If the person's speech was unclear or garbled, ask them to repeat what they said more clearly.
                      
                      CRITICAL: Always respond to what they actually said, not what you think they might have said. If their words were unclear, ask for clarification.`
                    }
                  }));
                    }
                  }, minSilenceBeforeNextResponse);
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


