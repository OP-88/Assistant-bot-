require('dotenv').config();
const { Telegraf } = require('telegraf');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const OpenRouter = require('openrouter');
const express = require('express');

const openai = new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY });
const telegramBot = new Telegraf(process.env.TELEGRAM_TOKEN);

// Simple in-memory storage for chat history (per user/group ID)
const chatHistory = new Map();

// Logger
const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

// Env validation
if (!process.env.TELEGRAM_TOKEN || !process.env.OPENROUTER_API_KEY) {
  log('ERROR: Missing TELEGRAM_TOKEN or OPENROUTER_API_KEY in .env');
  process.exit(1);
}

// AI Response Generator (shared for both platforms—context-aware)
async function generateAIResponse(userId, message, platform = 'whatsapp') {
  const history = chatHistory.get(userId) || [];
  history.push({ role: 'user', content: message });
  // Keep last 5 exchanges to avoid token bloat
  const recentHistory = history.slice(-10);

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENROUTER_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `You are a fun, engaging assistant on ${platform}. Keep replies witty and concise to hold attention until a human arrives.` },
        ...recentHistory
      ],
      max_tokens: 200,
      temperature: 0.8,
    });

    const response = completion.choices[0]?.message?.content || 'Hmm, let me think...';
    history.push({ role: 'assistant', content: response });
    chatHistory.set(userId, history);
    return response;
  } catch (error) {
    log(`OpenAI error for ${userId}: ${error.message}`);
    return 'Oops, my brain short-circuited! Try again?';
  }
}

// WhatsApp Client Setup
const waClient = new Client({ authStrategy: new LocalAuth() });

waClient.on('qr', (qr) => {
  log('WhatsApp QR ready—scan it!');
  qrcode.generate(qr, { small: true });
});

waClient.on('ready', () => {
  log('WhatsApp client ready—listening for messages!');
});

waClient.on('message', async (msg) => {
  if (msg.fromMe) return; // Ignore self
  const userId = msg.from;
  const response = await generateAIResponse(userId, msg.body, 'whatsapp');
  msg.reply(response);
  log(`WhatsApp reply to ${userId}: ${response.substring(0, 50)}...`);
});

// Telegram Bot Setup
telegramBot.start((ctx) => ctx.reply('Hey! I\'m your AI buddy—chat away to kill time. What\'s up?'));
telegramBot.on('text', async (ctx) => {
  const userId = ctx.from.id.toString();
  const message = ctx.message.text;
  const response = await generateAIResponse(userId, message, 'telegram');

  ctx.reply(response);

  // "Keep busy" feature: After reply, set a timer for escalation
  setTimeout(() => {
    ctx.reply(`We've been chatting—want me to ping a human? (Say "yes" to escalate)`);
  }, parseInt(process.env.HUMAN_DELAY_MS) || 300000);

  log(`Telegram reply to ${userId}: ${response.substring(0, 50)}...`);
});

// Optional: Forward WhatsApp msgs to Telegram group for human review (add your group ID)
waClient.on('message', (msg) => {
  if (!msg.fromMe) {
    telegramBot.telegram.sendMessage('YOUR_TELEGRAM_GROUP_ID', `New WA msg from ${msg.from}: ${msg.body}`);
  }
});

// Error Handlers
waClient.on('auth_failure', (msg) => log(`WhatsApp auth failed: ${msg}`));
telegramBot.catch((err) => log(`Telegram error: ${err}`));
process.on('unhandledRejection', (reason) => log(`Unhandled: ${reason}`));

// Express Health Server (for monitoring/deployment)
const app = express();
app.get('/health', (req, res) => res.json({ status: 'alive', chats: chatHistory.size }));
app.listen(process.env.PORT || 3000, () => log(`Server on port ${process.env.PORT || 3000}`));

// Initialize
waClient.initialize();
telegramBot.launch().then(() => log('Telegram bot launched!'));

// Graceful shutdown
process.once('SIGINT', () => {
  waClient.destroy();
  telegramBot.stop('SIGINT');
  process.exit(0);
});
