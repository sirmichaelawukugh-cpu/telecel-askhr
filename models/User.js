const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true, index: true },
  password: { type: String, required: true },
  salt: { type: String, required: true },
  name: { type: String, required: true },
  email: { type: String, default: '' },
  role: { type: String, default: 'user', enum: ['admin', 'user'] }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
