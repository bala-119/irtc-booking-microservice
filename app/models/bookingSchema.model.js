const mongoose = require("mongoose");

const passengerSchema = new mongoose.Schema({
  name: String,
  age: Number,
  status: {
    type: String,
    enum: ["MALE", "FEMALE", "NOT PREFERRED"],
    default: "NOT PREFERRED"
  }
}, { _id: false });

const seatSchema = new mongoose.Schema({
  coach: String,
  seat_number: Number
}, { _id: false });

const bookingSchema = new mongoose.Schema({
  pnr: { type: String, unique: true, required: true },

  user_id: { type: String, required: true },

  // 🔥 IMPORTANT
  schedule_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },

  train_id: mongoose.Schema.Types.ObjectId,
  train_number: String,
  train_name: String,

  from_station: String,
  to_station: String,

  class_type: String,

  booking_type: {
    type: String,
    enum: ["GENERAL", "TATKAL"],
    default: "GENERAL"
  },

  journey_date: Date,

  passengers: [passengerSchema],
  seat_details: [seatSchema],

  status: {
    type: String,
    enum: ["CONFIRMED", "WAITING"],
    default: "CONFIRMED"
  },

  fare_per_passenger: {
    type: Number,
    required: true
  },

  total_fare: {
    type: Number,
    required: true
  }

}, { timestamps: true });

module.exports = mongoose.model("Booking", bookingSchema);