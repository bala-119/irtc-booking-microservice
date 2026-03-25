// const mongoose = require("mongoose");

// const classSeatSchema = new mongoose.Schema({
//   total: { type: Number, required: true, min: 0 },
//   available: { type: Number, required: true, min: 0 }
// }, { _id: false });

// const scheduleSchema = new mongoose.Schema({
//   train_id: {
//     type: mongoose.Schema.Types.ObjectId,
//     required: true,
//     index: true
//   },
//   train_number: { type: String, required: true, index: true },
//   train_name: { type: String, required: true },
//   journey_date: { type: Date, required: true, index: true },
//   seats: { type: Map, of: classSeatSchema, required: true },
//   seat_counters: { type: Map, of: Number, default: {} },
//   status: { type: String, enum: ["ACTIVE", "CANCELLED", "DELAYED"], default: "ACTIVE" }
// }, { timestamps: true });

// // Prevent duplicate schedules for same train/date
// scheduleSchema.index({ train_id: 1, journey_date: 1 }, { unique: true });

// module.exports = mongoose.model("Schedule", scheduleSchema);

const mongoose = require("mongoose");

const classSeatSchema = new mongoose.Schema({
  total: { type: Number, required: true, min: 0 },
  available: { type: Number, required: true, min: 0 }
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

  seat_counters: { type: Map, of: Number, default: {} },

  // 🔥 NEW: reusable seats pool
  reusable_seats: {
    type: Map,
    of: [
      {
        coach: String,
        seat_number: Number
      }
    ],
    default: {}
  },

  status: {
    type: String,
    enum: ["ACTIVE", "CANCELLED", "DELAYED"],
    default: "ACTIVE"
  }

}, { timestamps: true });

scheduleSchema.index({ train_id: 1, journey_date: 1 }, { unique: true });

module.exports = mongoose.model("Schedule", scheduleSchema);