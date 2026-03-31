const mongoose = require("mongoose");

const classSeatSchema = new mongoose.Schema({
  total: { type: Number, required: true, min: 0 },
  available: { type: Number, required: true, min: 0 }
}, { _id: false });

const seatBookingSchema = new mongoose.Schema({
  class_type: { type: String, required: true },
  coach: { type: String, required: true },
  seat_number: { type: Number, required: true },
  from: { type: String, required: true }, // station code
  to: { type: String, required: true },   // station code
  passenger: {
    name: { type: String, required: true },
    age: { type: Number, required: true },
    gender: { type: String, required: true }
  },
  pnr: { type: String, required: true } // link back to booking
}, { _id: false });

const scheduleSchema = new mongoose.Schema({
  train_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  train_number: { type: String, required: true, index: true },
  train_name: { type: String, required: true },
  journey_date: { type: Date, required: true, index: true },

  seats: { type: Map, of: classSeatSchema, required: true },

  seat_bookings: {
    type: [seatBookingSchema],
    default: []
  },

  status: {
    type: String,
    enum: ["ACTIVE", "CANCELLED", "DELAYED"],
    default: "ACTIVE"
  },

  running_day: { type: String } // optional, e.g. MON/TUE
}, { timestamps: true });

// Ensure one schedule per train per date
scheduleSchema.index({ train_id: 1, journey_date: 1 }, { unique: true });

module.exports = mongoose.model("Schedule", scheduleSchema);
