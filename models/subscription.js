// /project/workspace/models/subscription.js

const mongoose = require('mongoose'); // FIX: Обов'язково підключаємо mongoose тут

// --- 1. ВИЗНАЧЕННЯ СХЕМИ ---
const subscriptionSchema = new mongoose.Schema({
    // ID чату Telegram
    chatId: {
        type: Number,
        required: true,
        unique: true,
    },
    // Ім'я користувача (для зручності)
    username: {
        type: String,
        required: false,
    },
    // Географічне місце розташування (з Telegram)
    location: {
        latitude: {
            type: Number,
            required: true,
        },
        longitude: {
            type: Number,
            required: true,
        },
    },
    // Час сповіщення у форматі "HH:MM" (UTC)
    notificationTime: {
        type: String, // Наприклад, "09:30"
        required: true,
    },
    // Статус підписки
    isActive: {
        type: Boolean,
        default: true,
    },
});

// --- 2. СТВОРЕННЯ МОДЕЛІ ---
const Subscription = mongoose.model("Subscription", subscriptionSchema);

// --- 3. ЕКСПОРТ МОДУЛЯ ---
module.exports = Subscription;