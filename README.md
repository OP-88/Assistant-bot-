# Assistant-Bot
A Telegram-hosted AI agent that auto-replies to WhatsApp messages, filters by sender, delivers news briefs, and sets reminders/alarms. Powered by Node.js, OpenRouter, and NewsAPI.

![Demo](demo.gif)

## Features
- Smart WhatsApp replies (e.g., "We need to meet" → "When/where? I’ll notify!")
- Telegram commands: `/news`, `/reminder`, `/alarm`
- Selective replies by phone number
- News briefings (top headlines)
- Notifications to admin via Telegram

## Setup
1. Clone: `git clone https://github.com/OP-88/Assistant-bot-`
2. Install: `npm install`
3. Copy `.env.example` to `.env`, add keys (Telegram, OpenRouter, NewsAPI)
4. Run: `npm run dev`
5. Scan WhatsApp QR, test Telegram bot (@YourBot)

## Tech
![Node.js](https://img.shields.io/badge/Node.js-v18-green) ![Telegraf](https://img.shields.io/badge/Telegraf-4.16-blue) ![OpenRouter](https://img.shields.io/badge/OpenRouter-LLaMA-orange)

## Demo
[Live Bot](https://t.me/YourBot) | [Video](demo.mp4)
