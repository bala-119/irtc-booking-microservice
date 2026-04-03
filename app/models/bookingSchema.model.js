const mongoose = require("mongoose");

const passengerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  age: { type: Number, required: true },
  gender: {
    type: String,
    enum: ["MALE", "FEMALE", "NOT_PREFERRED"],
    default: "NOT_PREFERRED"
  }
}, { _id: false });

const seatSchema = new mongoose.Schema({
  coach: { type: String, required: true },
  seat_number: { type: Number, required: true },
  position: { type: String }
}, { _id: false });

// Payment details schema
const paymentDetailsSchema = new mongoose.Schema({
  payment_id: { type: String },
  transaction_id: { type: String },
  stripe_payment_intent_id: { type: String },
  amount: { type: Number, required: true },
  currency: { type: String, default: "INR" },
  status: {
    type: String,
    enum: ["PENDING", "PAID", "FAILED", "REFUNDED", "NOT_REQUIRED"],
    default: "PENDING"
  },
  payment_method: { type: String },
  payment_date: { type: Date },
  refund_id: { type: String },
  refund_amount: { type: Number },
  refund_date: { type: Date },
  failure_reason: { type: String },
  metadata: { type: Map, of: String }
}, { _id: false });

const bookingSchema = new mongoose.Schema({
  pnr: { type: String, unique: true, required: true, index: true },

  user_id: { type: String, required: true, index: true },

  schedule_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Schedule',
    index: true
  },

  train_id: mongoose.Schema.Types.ObjectId,
  train_number: { type: String, required: true, index: true },
  train_name: String,

  from_station: { type: String, required: true },
  to_station: { type: String, required: true },

  class_type: { type: String, required: true },
  stop_gaps: { type: Number, default: 0 },
  
  booking_type: {
    type: String,
    enum: ["GENERAL", "TATKAL"],
    default: "GENERAL"
  },

  journey_date: { type: Date, required: true, index: true },

  passengers: [passengerSchema],
  seat_details: [seatSchema],

  // BOOKING status (seat allocation)
  booking_status: {
    type: String,
    enum: ["CONFIRMED", "WAITING", "CANCELLED"],
    default: "CONFIRMED"
  },

  waiting_number: { type: Number, default: 0 },

  // PAYMENT status (separate field)
  payment_status: {
    type: String,
    enum: ["PENDING", "PAID", "FAILED", "REFUNDED", "NOT_REQUIRED"],
    default: "PENDING"
  },

  fare_per_passenger: { type: Number, required: true },
  total_fare: { type: Number, required: true },

  // Payment details
  payment_details: paymentDetailsSchema,

  cancellation_reason: { type: String },
  cancelled_at: { type: Date },
  
  // Time-based expiry for pending payments
  payment_expires_at: { type: Date },
  
  // When booking was actually confirmed (after payment)
  confirmed_at: { type: Date }
}, { timestamps: true });

// Indexes
bookingSchema.index({ user_id: 1, booking_status: 1 });
bookingSchema.index({ train_number: 1, journey_date: 1 });
bookingSchema.index({ "payment_details.payment_id": 1 });
bookingSchema.index({ payment_expires_at: 1 });
bookingSchema.index({ payment_status: 1, booking_status: 1 });

// Add TTL index to auto-cancel unpaid bookings after 15 minutes
bookingSchema.index({ payment_expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("Booking", bookingSchema);