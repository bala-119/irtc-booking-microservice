const mongoose = require("mongoose");

const passengerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  age: { type: Number, required: true },
  gender: {
    type: String,
    enum: ["MALE", "FEMALE", "NOT PREFERRED"],
    default: "NOT PREFERRED"
  }
}, { _id: false });

const seatSchema = new mongoose.Schema({
  coach: { type: String, required: true },
  seat_number: { type: Number, required: true }
}, { _id: false });

const bookingSchema = new mongoose.Schema({
  pnr: { type: String, unique: true, required: true },

  user_id: { type: String, required: true },

  schedule_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },

  train_id: mongoose.Schema.Types.ObjectId,
  train_number: String,
  train_name: String,

  from_station: { type: String, required: true },
  to_station: { type: String, required: true },

  class_type: { type: String, required: true },

  booking_type: {
    type: String,
    enum: ["GENERAL", "TATKAL"],
    default: "GENERAL"
  },

  journey_date: { type: Date, required: true },

  passengers: [passengerSchema],
  seat_details: [seatSchema],

  status: {
    type: String,
    enum: ["CONFIRMED", "WAITING", "CANCELLED"],
    default: "CONFIRMED"
  },

  fare_per_passenger: { type: Number, required: true },
  total_fare: { type: Number, required: true },

  cancellation_reason: { type: String } // optional
}, { timestamps: true });

module.exports = mongoose.model("Booking", bookingSchema);
