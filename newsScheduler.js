// ✅ FILE: newsScheduler.js
const fetch = require('node-fetch');
const cron = require('node-cron');

// CONFIG
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const NEWS_API_URL = 'https://newsdata.io/api/1/news?apikey=pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx&country=ke,us,gb&language=en&category=top,technology,world,business,sports';
const START_HOUR = 6;
const END_HOUR = 22;

// 🔍 Summarize news headlines with OpenRouter AI
async function summarizeWithAI(headlines) {
  const prompt = `Summarize the following news headlines into clear, short bullet points:\n\n${headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "openai/gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7
      })
    });

    const data = await res.json();
    return data.choices?.[0]?.message?.content || "⚠️ AI summary unavailable.";
  } catch (err) {
    console.error("❌ AI summarization failed:", err.message);
    return "⚠️ AI summarization error.";
  }
}

// 🔔 Send news to WhatsApp
async function sendNewsToWhatsApp(client, number) {
  const now = new Date();
  const hour = now.getHours();
  if (hour < START_HOUR || hour >= END_HOUR) {
    console.log("🕒 Outside active hours — skipping.");
    return;
  }

  try {
    const newsRes = await fetch(NEWS_API_URL);
    const newsData = await newsRes.json();

    console.log("📦 Raw API response:", JSON.stringify(newsData, null, 2));

    const topHeadlines = newsData.results?.slice?.(0, 5)?.map(article => article.title);
    if (!topHeadlines || topHeadlines.length === 0) {
      console.log("⚠️ No valid news found.");
      await client.sendMessage(number, "⚠️ No fresh news available right now.");
      return;
    }

    const aiSummary = await summarizeWithAI(topHeadlines);

    const message = `🗞️ *Top News – ${now.toLocaleTimeString()}*\n\n`
      + topHeadlines.map((h, i) => `${i + 1}. ${h}`).join('\n')
      + `\n\n🧠 *Summary:*\n${aiSummary}`;

    await client.sendMessage(number, message)
      .then(() => console.log(`📩 Message sent to ${number}`))
      .catch(err => console.error("❌ Failed to send message:", err));

  } catch (err) {
    console.error("❌ Error while fetching/sending news:", err.message);
    await client.sendMessage(number, "⚠️ Something went wrong while trying to send today's news.");
  }
}

// 🕐 Auto-schedule every hour
function startNewsScheduler(client, number) {
  cron.schedule('5 * * * *', () => {
    console.log("⏰ Running scheduled news update...");
    sendNewsToWhatsApp(client, number);
  });
}

module.exports = { startNewsScheduler, sendNewsToWhatsApp };
