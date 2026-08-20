const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
  ticketRef: { type: String, unique: true, required: true, index: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  department: { type: String, required: true },
  category: { type: String, default: 'General' },
  subject: { type: String, required: true },
  description: { type: String, required: true },
  priority: { type: String, default: 'Medium' },
  status: { type: String, default: 'Open' },
  assignedTo: { type: String, default: '' },
  resolution: { type: String, default: '' },
  attachments: [{
    name: String,
    size: Number,
    type: String,
    ext: String,
    path: String
  }]
}, { timestamps: true });

ticketSchema.index({ status: 1, priority: 1, department: 1, category: 1 });
ticketSchema.index({ name: 'text', subject: 'text', description: 'text', ticketRef: 'text' });

module.exports = mongoose.model('Ticket', ticketSchema);
