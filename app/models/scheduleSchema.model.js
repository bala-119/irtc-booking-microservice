const mongoose = require("mongoose");

// Updated passenger schema with berth preference
const passengerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  age: { type: Number, required: true },
  gender: {
    type: String,
    enum: ["MALE", "FEMALE", "NOT_PREFERRED"],
    default: "NOT_PREFERRED"
  },
  berth_preference: {  // NEW: Store berth preference for waiting list
    type: String,
    enum: ["LOWER", "MIDDLE", "UPPER", "SIDE_LOWER", "SIDE_UPPER", "WINDOW", "MIDDLE", "AISLE", "NO_PREFERENCE"],
    default: "NO_PREFERENCE"
  }
}, { _id: false });

// Updated class seat schema with dynamic waiting list
const classSeatSchema = new mongoose.Schema({
  total: { type: Number, required: true, min: 0 },
  available: { type: Number, required: true, min: 0 },
  max_waiting: { type: Number, default: 0 },  // Will be set to total seats
  waiting_count: { type: Number, default: 0 }  // NEW: Track current waiting count
}, { _id: false });

// Updated seat booking schema with position
const seatBookingSchema = new mongoose.Schema({
  class_type: { type: String, required: true },
  coach: { type: String, required: true },
  seat_number: { type: Number, required: true },
  seat_position: { type: String },  // NEW: Store seat position (LOWER, UPPER, etc.)
  from: { type: String, required: true, uppercase: true },
  to: { type: String, required: true, uppercase: true },
  passenger: {
    name: { type: String, required: true },
    age: { type: Number, required: true },
    gender: { type: String, required: true },
    berth_preference: { type: String, default: "NO_PREFERENCE" }  // NEW: Store preference
  },
  pnr: { type: String, required: true, index: true }
}, { _id: false });

// Updated waiting list schema with berth preference
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

  waiting_list: [{
    pnr: { type: String, required: true },
    passengers: [passengerSchema],  // Now includes berth_preference
    from: { type: String, required: true, uppercase: true },
    to: { type: String, required: true, uppercase: true },
    class_type: { type: String, required: true },
    created_at: { type: Date, default: Date.now }
  }],

  status: {
    type: String,
    enum: ["ACTIVE", "CANCELLED", "DELAYED"],
    default: "ACTIVE"
  },

  running_day: { type: String }
}, { timestamps: true });

// Ensure one schedule per train per date
scheduleSchema.index({ train_id: 1, journey_date: 1 }, { unique: true });
scheduleSchema.index({ train_number: 1, journey_date: 1 });
scheduleSchema.index({ journey_date: 1, status: 1 });  // NEW: For refund processing

module.exports = mongoose.model("Schedule", scheduleSchema);