require('dotenv').config();
const { Telegraf } = require('telegraf');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const OpenAI = require('openai');
const express = require('express');
const cron = require('node-cron');
const newsHandler = require('./news');

const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1'
});
const telegramBot = new Telegraf(process.env.TELEGRAM_TOKEN);
const waClient = new Client({ authStrategy: new LocalAuth() });

// In-memory storage (user ID → history/reminders)
const chatHistory = new Map();
const reminders = new Map();
const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

// Env validation
if (!process.env.TELEGRAM_TOKEN || !process.env.OPENROUTER_API_KEY || !process.env.NEWS_API_KEY) {
  log('ERROR: Missing required env vars');
  process.exit(1);
}
const allowedNumbers = (process.env.ALLOWED_NUMBERS || '').split(',').map(n => n.trim());

// AI Response Generator (context-aware, smart replies)
async function generateAIResponse(userId, message, platform = 'whatsapp') {
  const history = chatHistory.get(userId) || [];
  history.push({ role: 'user', content: message });

  // Smart reply logic for meetings
  let systemPrompt = `You are a smart assistant on ${platform}. Reply concisely and cleverly. If the message mentions a meeting (e.g., "we need to meet"), ask for time/location and promise to notify OP-88.`;
  if (message.toLowerCase().includes('meet')) {
    systemPrompt += ' For meeting requests, respond with: "Cool, when and where should we meet? I’ll notify OP-88 once you confirm!"';
  }

  try {
    const completion = await openrouter.chat.completions.create({
      model: process.env.OPENROUTER_MODEL || 'meta-ai/llama-3.1-8b-instruct',
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.slice(-10)
      ],
      max_tokens: 200,
      temperature: 0.8
    });

    const response = completion.choices[0]?.message?.content || 'Thinking... try again!';
    history.push({ role: 'assistant', content: response });
    chatHistory.set(userId, history);
    return response;
  } catch (error) {
    log(`OpenRouter error for ${userId}: ${error.message}`);
    return 'AI’s taking a nap—try again soon!';
  }
}

// WhatsApp: Handle incoming messages
waClient.on('qr', (qr) => {
  log('WhatsApp QR ready—scan it!');
  qrcode.generate(qr, { small: true });
});

waClient.on('ready', () => log('WhatsApp client ready!'));

waClient.on('message', async (msg) => {
  if (msg.fromMe) return;
  const userId = msg.from;
  if (!allowedNumbers.includes(userId.split('@')[0])) {
    log(`Ignored msg from ${userId} (not in ALLOWED_NUMBERS)`);
    return;
  }

  const response = await generateAIResponse(userId, msg.body, 'whatsapp');
  msg.reply(response);
  log(`WhatsApp reply to ${userId}: ${response.substring(0, 50)}...`);

  // Notify Telegram (your admin chat)
  telegramBot.telegram.sendMessage('YOUR_TELEGRAM_ADMIN_ID', `New WA msg from ${userId}: ${msg.body}\nReplied: ${response}`);
});

// Telegram: Commands & Engagement
telegramBot.start((ctx) => ctx.reply('Hey! I’m your AI agent—chat, set reminders, or get news with /news!'));

// News briefing
telegramBot.command('news', async (ctx) => {
  const news = await newsHandler.getNewsBrief();
  ctx.reply(news);
});

// Reminder command (/reminder 1h Buy milk)
telegramBot.command('reminder', (ctx) => {
  const [_, time, ...noteParts] = ctx.message.text.split(' ');
  const note = noteParts.join(' ');
  if (!time || !note) return ctx.reply('Use: /reminder <time> <note>, e.g., /reminder 1h Buy milk');

  const delay = parseTime(time);
  if (!delay) return ctx.reply('Invalid time format! Use Xm, Xh, or Xd.');

  const userId = ctx.from.id.toString();
  reminders.set(`${userId}:${note}`, { time: Date.now() + delay, note });
  ctx.reply(`Reminder set: "${note}" in ${time}`);
});

// Alarm command (/alarm 10m Wake up!)
telegramBot.command('alarm', (ctx) => {
  const [_, time, ...noteParts] = ctx.message.text.split(' ');
  const note = noteParts.join(' ');
  if (!time || !note) return ctx.reply('Use: /alarm <time> <note>, e.g., /alarm 10m Wake up!');

  const delay = parseTime(time);
  if (!delay) return ctx.reply('Invalid time format! Use Xm, Xh, or Xd.');

  setTimeout(() => {
    ctx.reply(`🔔 ALARM: ${note}`);
    telegramBot.telegram.sendMessage('YOUR_TELEGRAM_ADMIN_ID', `Alarm triggered: ${note}`);
  }, delay);
  ctx.reply(`Alarm set: "${note}" in ${time}`);
});

// Parse time (e.g., 1h → 3600000ms)
function parseTime(timeStr) {
  const match = timeStr.match(/^(\d+)([mhd])$/);
  if (!match) return null;
  const [, value, unit] = match;
  const num = parseInt(value);
  return unit === 'm' ? num * 60 * 1000 : unit === 'h' ? num * 3600 * 1000 : num * 86400 * 1000;
}

// Handle Telegram chat
telegramBot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return; // Skip commands
  const userId = ctx.from.id.toString();
  const response = await generateAIResponse(userId, ctx.message.text, 'telegram');
  ctx.reply(response);

  // Escalate after delay
  setTimeout(() => {
    ctx.reply('Still here? Say "escalate" to ping OP-88!');
  }, parseInt(process.env.HUMAN_DELAY_MS) || 300000);
});

// Check reminders (every minute)
cron.schedule('* * * * *', () => {
  const now = Date.now();
  for (const [key, { time, note }] of reminders) {
    if (now >= time) {
      const userId = key.split(':')[0];
      telegramBot.telegram.sendMessage(userId, `⏰ Reminder: ${note}`);
      reminders.delete(key);
    }
  }
});

// Express server
const app = express();
app.get('/health', (req, res) => res.json({ status: 'alive', chats: chatHistory.size, reminders: reminders.size }));
app.listen(process.env.PORT || 3000, () => log(`Server on port ${process.env.PORT || 3000}`));

// Error handlers
waClient.on('auth_failure', (msg) => log(`WhatsApp auth failed: ${msg}`));
telegramBot.catch((err) => log(`Telegram error: ${err}`));
process.on('unhandledRejection', (reason) => log(`Unhandled: ${reason}`));

// Start
waClient.initialize();
telegramBot.launch().then(() => log('Telegram bot launched!'));

// Shutdown
process.once('SIGINT', () => {
  waClient.destroy();
  telegramBot.stop('SIGINT');
  process.exit(0);
});
