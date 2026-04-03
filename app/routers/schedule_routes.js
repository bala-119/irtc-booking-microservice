const express = require("express");
const router = express.Router();

const scheduleController = require("../controllers/scheduleController");
const bookingController = require("../controllers/bookingController");
const authMiddleware = require("../middlewares/authMiddleware");
const checkProfileCompleted = require("../middlewares/checkProfileCompleted");
const adminAuthMiddleware = require("../middlewares/admin.authMiddleware");

// // ==================== ADMIN ROUTES ====================
// router.post(
//   "/schedule/generate",
//   checkProfileCompleted,
//   adminAuthMiddleware("admin"),
//   scheduleController.generateSchedule
// );

// // ==================== PUBLIC ROUTES ====================
// router.get("/schedule/search-trains", scheduleController.searchSchedules);

// // ==================== PROTECTED USER ROUTES ====================
// // Booking routes
// router.post(
//   "/book",
//   checkProfileCompleted,
//   authMiddleware(),
//   bookingController.bookTicket
// );

// router.get(
//   "/:pnr",
//   checkProfileCompleted,
//   authMiddleware(),
//   bookingController.getBooking
// );

// router.get(
//   "/download-ticket/:pnr",
//   checkProfileCompleted,
//   authMiddleware(),
//   bookingController.downloadTicket
// );

// router.delete(
//   "/cancel-ticket/:pnr",
//   checkProfileCompleted,
//   authMiddleware(),
//   bookingController.cancelTicket
// );

// // ==================== PAYMENT SERVICE ENDPOINTS (Internal/Service-to-Service) ====================
// // These endpoints are called by the Payment Service after successful payment

// // Get booking details for payment processing (without user auth, uses service token)
// router.get(
//   "/for-payment/:pnr",
//   bookingController.getBookingForPayment
// );

// // Confirm payment and update booking status
// router.patch(
//   "/confirm-payment",
//   bookingController.confirmPayment
// );

// // Get payment status for a booking
// router.get(
//   "/payment-status/:pnr",
//   authMiddleware(),
//   bookingController.getPaymentStatus
// );

// // Get booking with payment details
// router.get(
//   "/with-payment/:pnr",
//   authMiddleware(),
//   bookingController.getBookingWithPayment
// );

// // Cancel unpaid booking
// router.delete(
//   "/cancel-unpaid/:pnr",
//   authMiddleware(),
//   bookingController.cancelUnpaidBooking
// );

// // Health check for payment service
// router.get(
//   "/health",
//   bookingController.healthCheck
// );
router.post(
  "/schedule/generate",
  checkProfileCompleted,
  adminAuthMiddleware("admin"),
  scheduleController.generateSchedule
);

// Admin - Manual waiting list processing
router.post(
  "/admin/process-waiting-list",
  checkProfileCompleted,
  adminAuthMiddleware("admin"),
  bookingController.manualProcessWaitingList
);

// Admin - Get waiting list status for a schedule
router.get(
  "/admin/waiting-list/:scheduleId/:classType",
  checkProfileCompleted,
  adminAuthMiddleware("admin"),
  bookingController.getWaitingListStatus
);

// Admin - Get seat availability for a schedule
router.get(
  "/admin/seats/:scheduleId/:classType",
  checkProfileCompleted,
  adminAuthMiddleware("admin"),
  bookingController.getSeatAvailability
);

// Admin - Get all bookings for a specific user
router.get(
  "/admin/user-bookings/:userId",
  checkProfileCompleted,
  adminAuthMiddleware("admin"),
  bookingController.getUserBookings
);

// Admin - Release expired bookings manually
router.post(
  "/admin/release-expired",
  checkProfileCompleted,
  adminAuthMiddleware("admin"),
  bookingController.releaseExpiredBookings
);
// ==================== PUBLIC ROUTES ====================
router.get("/schedule/search-trains", scheduleController.searchSchedules);

// Public PNR status check (limited info, no auth required)
router.get("/pnr-status/:pnr", bookingController.getPublicPNRStatus);

// ==================== PROTECTED USER ROUTES ====================
// Booking routes
router.post(
  "/book",
  checkProfileCompleted,
  authMiddleware(),
  bookingController.bookTicket
);

router.get(
  "/:pnr",
  checkProfileCompleted,
  authMiddleware(),
  bookingController.getBooking
);

router.get(
  "/download-ticket/:pnr",
  checkProfileCompleted,
  authMiddleware(),
  bookingController.downloadTicket
);

router.delete(
  "/cancel-ticket/:pnr",
  checkProfileCompleted,
  authMiddleware(),
  bookingController.cancelTicket
);
// ==================== PAYMENT & BOOKING STATUS ROUTES ====================
// Get payment status for a booking
router.get(
  "/payment-status/:pnr",
  checkProfileCompleted,
  authMiddleware(),
  bookingController.getPaymentStatus
);

// Get booking with payment details
router.get(
  "/with-payment/:pnr",
  checkProfileCompleted,
  authMiddleware(),
  bookingController.getBookingWithPayment
);
// Cancel unpaid booking (before payment)
router.delete(
  "/cancel-unpaid/:pnr",
  checkProfileCompleted,
  authMiddleware(),
  bookingController.cancelUnpaidBooking
);

// Get refund status for cancelled waiting list ticket
router.get(
  "/refund-status/:pnr",
  checkProfileCompleted,
  authMiddleware(),
  bookingController.getRefundStatus
);
// Get user's all bookings
router.get(
  "/my-bookings",
  checkProfileCompleted,
  authMiddleware(),
  bookingController.getMyBookings
);

// ==================== INTERNAL SERVICE ENDPOINTS (Payment Service) ====================
// These endpoints are called by the Payment Service after successful payment
// Service-to-service authentication using x-service-auth header

// Get booking details for payment processing
router.get(
  "/internal/for-payment/:pnr",
  bookingController.getBookingForPayment
);

// Confirm payment and update booking status
router.patch(
  "/internal/confirm-payment",
  bookingController.confirmPayment
);

// Release expired bookings (called by cron job)
router.post(
  "/internal/release-expired",
  bookingController.releaseExpiredBookings
);

// Process waiting list (called by cron job)
router.post(
  "/internal/process-waiting-list",
  bookingController.processWaitingList
);

// Health check for payment service
router.get(
  "/health",
  bookingController.healthCheck
);


module.exports = router;