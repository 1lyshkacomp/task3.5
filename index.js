// index.js (Subscription Bot - Final Version)

require('dotenv').config();
process.env.TZ = process.env.TZ || 'UTC'; // Встановлюємо часовий пояс UTC

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const axios = require('axios'); 
const logger = require('./logger');
const mongoose = require('mongoose');
const cron = require('node-cron');
const Subscription = require('./models/subscription'); // Наша Модель

// --- 1. КОНФІГУРАЦІЯ ---
const token = process.env.BOT_TOKEN;
const weatherApiKey = process.env.OPENWEATHER_API_KEY;
const dbConnectionString = process.env.DB_CONNECTION_STRING;
const port = process.env.PORT || 8080; 
const webhookPath = '/bot/' + token; 

// "Тимчасова пам'ять" для процесу підписки
// (Це НАДІЙНИЙ метод, кращий за bot.once)
const userStates = {};

// --- 2. ПІДКЛЮЧЕННЯ ДО БД ---
mongoose.connect(dbConnectionString)
  .then(() => {
    logger.info('MongoDB connection successful!');
  })
  .catch((err) => {
    logger.error({ error: err.message }, 'MongoDB connection error!');
    process.exit(1); 
  });

// --- 3. ФУНКЦІЇ API (Погода) ---
// (Ті самі, що й у минулому завданні)
async function getWeather(lat, lon) {
    if (!weatherApiKey) {
        logger.error("OPENWEATHER_API_KEY не встановлено.");
        throw new Error('API Key не встановлено.');
    }
    const url = 'https://api.openweathermap.org/data/2.5/weather';
    const params = { lat, lon, appid: weatherApiKey, units: 'metric', lang: 'ua' };
    const response = await axios.get(url, { params });
    return response.data;
}

function formatWeatherMessage(data) {
    const { name, weather, main, wind } = data;
    const description = weather[0].description;
    const temp = Math.round(main.temp);
    const feelsLike = Math.round(main.feels_like);
    const message = `
**Погода у місті ${name}**
${description.charAt(0).toUpperCase() + description.slice(1)}
🌡️ *Температура:* **${temp}°C** (відчувається як ${feelsLike}°C)
💨 *Швидкість вітру:* ${Math.round(wind.speed)} м/с
    `;
    return message.trim();
}

// --- 4. ІНІЦІАЛІЗАЦІЯ БОТА ТА СЕРВЕРА (WEBHOOK) ---
const bot = new TelegramBot(token); 
const app = express();
app.use(express.json());

app.listen(port, () => {
    logger.info(`Express server is running on port ${port}.`);
});

app.post(webhookPath, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200); 
});

// --- 5. "БУДИЛЬНИК" (CRON JOB) ---
logger.info('Cron job scheduler started. Will check every minute.');
cron.schedule('* * * * *', async () => {
    const now = new Date();
    const currentTimeUTC = now.toISOString().substring(11, 16); 
    logger.info(`Cron tick: ${currentTimeUTC} UTC. Checking...`);

    try {
        const subs = await Subscription.find({
            notificationTime: currentTimeUTC,
            isActive: true
        });

        if (subs.length === 0) return;

        logger.info(`Found ${subs.length} subscriptions. Sending...`);

        for (const sub of subs) {
            try {
                const weatherData = await getWeather(sub.location.latitude, sub.location.longitude);
                const message = formatWeatherMessage(weatherData);
                await bot.sendMessage(sub.chatId, "🌤️ Ваш щоденний прогноз погоди:\n" + message, { parse_mode: 'Markdown' });
            } catch (error) {
                logger.error({ chatId: sub.chatId, error: error.message }, "Failed to send scheduled weather.");
                await bot.sendMessage(sub.chatId, "Не вдалося отримати ваш прогноз погоди. Можливо, ви відкликали дозвіл на геолокацію?");
            }
        }
    } catch (dbError) {
        logger.error({ error: dbError.message }, "Cron: Database query failed.");
    }
});

// --- 6. ОБРОБНИКИ КОМАНД БОТА ---

// /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 
        "👋 Вітаю! Я бот для підписки на погоду.\n\n" +
        "**Команди:**\n" +
        "/subscribe - Почати процес підписки\n" +
        "/list - Показати мої підписки\n" +
        "/unsubscribe - Скасувати підписку",
        { parse_mode: 'Markdown' }
    );
});

// /unsubscribe
bot.onText(/\/unsubscribe/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        const deleted = await Subscription.findOneAndDelete({ chatId: chatId });
        if (deleted) {
            logger.info({ chatId }, "User unsubscribed.");
            bot.sendMessage(chatId, "Ви успішно відписалися від сповіщень. 👋");
        } else {
            bot.sendMessage(chatId, "Ви ще не були підписані.");
        }
        delete userStates[chatId]; // Очищуємо стан
    } catch (error) {
        logger.error({ chatId, error: error.message }, "Unsubscribe failed.");
        bot.sendMessage(chatId, "Не вдалося скасувати підписку. Спробуйте ще раз.");
    }
});

// ⭐ --- НОВА КОМАНДА /list --- ⭐
bot.onText(/\/list/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        const subs = await Subscription.find({ chatId: chatId, isActive: true });

        if (subs.length === 0) {
            return bot.sendMessage(chatId, "📭 У вас немає активних підписок. \nНатисніть /subscribe, щоб почати.");
        }

        let text = "📋 Ваші активні підписки:\n\n";
        // (Хоча у нас логіка "одна підписка на 1 юзера", зробимо через цикл)
        for (const sub of subs) {
            // Отримаємо назву міста (додатковий запит до API)
            const weather = await getWeather(sub.location.latitude, sub.location.longitude);
            text += `📍 *Місто:* ${weather.name}\n`;
            text += `⏰ *Час (UTC):* ${sub.notificationTime}\n\n`;
        }
        
        bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });

    } catch (error) {
        logger.error({ chatId, error: error.message }, "List failed.");
        bot.sendMessage(chatId, "Не вдалося отримати список підписок. Спробуйте ще раз.");
    }
});


// /subscribe (Початок покрокової розмови)
bot.onText(/\/subscribe/, async (msg) => {
    const chatId = msg.chat.id;
    const existingSub = await Subscription.findOne({ chatId: chatId });
    if (existingSub && existingSub.isActive) {
        bot.sendMessage(chatId, `Ви вже підписані на час ${existingSub.notificationTime} UTC. \nЯкщо хочете змінити, спочатку виконайте /unsubscribe.`);
        return;
    }
    
    userStates[chatId] = 'awaiting_location';
    logger.info({ chatId }, "User started subscription. Awaiting location...");
    bot.sendMessage(chatId, "Чудово! 📍 Будь ласка, надішліть свою геолокацію (через 📎).");
});

// Обробник геолокації (Крок 2 підписки)
bot.on('location', async (msg) => {
    const chatId = msg.chat.id;
    
    if (userStates[chatId] === 'awaiting_location') {
        const location = msg.location;
        userStates[chatId] = {
            state: 'awaiting_time',
            location: location
        };
        logger.info({ chatId }, "Got location. Awaiting time...");
        bot.sendMessage(chatId, "Дякую! ⏰ Тепер введіть час у UTC (Формат: `HH:MM`, наприклад `08:30`)", { parse_mode: 'Markdown' });
    }
});

// Обробник текстових повідомлень (Крок 3 підписки)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Ігноруємо, якщо це не відповідь на наш покроковий діалог
    if (!userStates[chatId] || text.startsWith('/') || msg.location) {
        return;
    }

    if (userStates[chatId].state === 'awaiting_time') {
        // Валідація часу
        if (!/^\d{2}:\d{2}$/.test(text)) {
            bot.sendMessage(chatId, "❌ Неправильний формат. Спробуйте ще раз (наприклад, `09:00`).");
            return;
        }

        const { location } = userStates[chatId];
        const notificationTime = text;

        try {
            await Subscription.findOneAndUpdate(
                { chatId: chatId },
                {
                    chatId: chatId,
                    username: msg.chat.from.username,
                    location: {
                        latitude: location.latitude,
                        longitude: location.longitude
                    },
                    notificationTime: notificationTime,
                    isActive: true
                },
                { upsert: true, new: true } // Створити, якщо не знайдено
            );

            logger.info({ chatId, time: notificationTime }, "Subscription successful!");
            bot.sendMessage(chatId, `✅ Готово! Ви підписані на щоденний прогноз погоди о ${notificationTime} UTC.`);

        } catch (error) {
            logger.error({ chatId, error: error.message }, "Failed to save subscription.");
            bot.sendMessage(chatId, "Ой, сталася помилка бази даних. Спробуйте /subscribe ще раз.");
        } finally {
            delete userStates[chatId]; // Очищуємо стан
        }
    }
});