// models/subscription.js
const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  chatId: {
    type: Number,
    required: true,
    unique: true 
  },
  username: {
    type: String,
    required: false
  },
  location: {
    latitude: Number,
    longitude: Number
  },
  notificationTime: {
    type: String, // "HH:MM", наприклад "09:30"
    required: true
  },
  isActive: {
    type: Boolean,
    default: true 
  }
});

const Subscription = mongoose.model('Subscription', subscriptionSchema);

module.exports = Subscription;