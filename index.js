// index.js (Subscription Bot - Final Version з виправленням)

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
    // ... (код Cron залишається без змін) ...
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
    // ... (код /start залишається без змін) ...
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
    // ... (код /unsubscribe залишається без змін) ...
    const chatId = msg.chat.id;
    try {
        const deleted = await Subscription.findOneAndDelete({ chatId: chatId });
        if (deleted) {
            logger.info({ chatId }, "User unsubscribed.");
            bot.sendMessage(chatId, "Ви успішно відписалися від сповіщень. 👋");
        } else {
            bot.sendMessage(chatId, "Ви ще не були підписані.");
        }
        delete userStates[chatId]; 
    } catch (error) {
        logger.error({ chatId, error: error.message }, "Unsubscribe failed.");
        bot.sendMessage(chatId, "Не вдалося скасувати підписку. Спробуйте ще раз.");
    }
});

// /list
bot.onText(/\/list/, async (msg) => {
    // ... (код /list залишається без змін) ...
    const chatId = msg.chat.id;
    try {
        const subs = await Subscription.find({ chatId: chatId, isActive: true });

        if (subs.length === 0) {
            return bot.sendMessage(chatId, "📭 У вас немає активних підписок. \nНатисніть /subscribe, щоб почати.");
        }

        let text = "📋 Ваші активні підписки:\n\n";
        for (const sub of subs) {
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


// /subscribe
bot.onText(/\/subscribe/, async (msg) => {
    // ... (код /subscribe залишається без змін) ...
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

// --- ⭐ ИСПРАВЛЕННЫЙ ОБРАБОТЧИК ТЕКСТА ⭐ ---
// Обработчик текстовых сообщений (Шаг 3 подписки)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // --- НАЧАЛО ИСПРАВЛЕНИЯ ---

    // 1. Игнорируем, если это НЕ текст (например, геолокация, фото)
    //    Это исправляет ошибку 'undefined.startsWith'
    if (!text) {
        return;
    }

    // 2. Игнорируем команды (их обрабатывают onText)
    if (text.startsWith('/')) {
        return;
    }
    
    // 3. Игнорируем, если мы не ожидаем ответа от этого юзера
    if (!userStates[chatId] || !userStates[chatId].state) {
        // Можно отправить помощь, если юзер пишет просто так
        // bot.sendMessage(chatId, "Я не понимаю. Используйте /start для помощи.");
        return;
    }
    // --- КОНЕЦ ИСПРАВЛЕНИЯ ---

    // Теперь мы уверены, что 'text' существует и это не команда.
    // Проверяем, ожидаем ли мы время
    if (userStates[chatId].state === 'awaiting_time') {
        
        // Валидация времени
        if (!/^\d{2}:\d{2}$/.test(text)) {
            bot.sendMessage(chatId, "❌ Неправильный формат. Попробуйте еще раз (например, `09:00`).", { parse_mode: 'Markdown' });
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
                { upsert: true, new: true } // Создать, если не найдено
            );

            logger.info({ chatId, time: notificationTime }, "Subscription successful!");
            bot.sendMessage(chatId, `✅ Готово! Вы подписаны на ежедневный прогноз погоды в ${notificationTime} UTC.`, { parse_mode: 'Markdown' });

        } catch (error) {
            logger.error({ chatId, error: error.message }, "Failed to save subscription.");
            bot.sendMessage(chatId, "Ой, произошла ошибка базы данных. Попробуйте /subscribe еще раз.");
        } finally {
            delete userStates[chatId]; // Очищаем состояние
        }
    }
});