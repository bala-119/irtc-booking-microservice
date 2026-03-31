const jwt = require("jsonwebtoken");
const bookingService = require("../services/bookingService");
const generateTicketPDF = require("../utils/generateTicket");
const Booking = require("../models/bookingSchema.model");
const fs = require("fs");

class BookingController {

  // BOOK TICKET
  async bookTicket(req, res) {
    try {
      console.log("going to decode");
      const decodedUser = req.user;
      console.log("decoded", decodedUser);

      // ✅ Map token claims to booking payload
      const bookingPayload = {
        ...req.body,
        user_id: decodedUser.id,          // required by schema
        email: decodedUser.email,
        phone: decodedUser.phone,
        role: decodedUser.role,
        fullName: decodedUser.fullName,
        user_name: decodedUser.user_name,
        email_verified: decodedUser.email_verified,
        phone_verified: decodedUser.phone_verified,
        aadhaarId_verified: decodedUser.aadhaarId_verified
        // add other claims if needed
      };

      console.log("Booking payload:", bookingPayload);

      const booking = await bookingService.bookSeat(bookingPayload);

      return res.status(201).json({
        success: true,
        message: "Ticket booked successfully",
        data: booking
      });
    } catch (err) {
      console.error("BOOKING ERROR:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // GET BOOKING
  async getBooking(req, res) {
    try {
      const { pnr } = req.params;
      if (!pnr) {
        return res.status(400).json({ success: false, message: "PNR is required" });
      }

      const booking = await bookingService.getBooking(pnr);
      if (!booking) {
        return res.status(404).json({ success: false, message: "Booking not found" });
      }

      return res.status(200).json({ success: true, data: booking });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // DOWNLOAD TICKET
  async downloadTicket(req, res) {
    try {
      const { pnr } = req.params;
      const { user_id } = req.user;

      if (!pnr) {
        return res.status(400).json({ success: false, message: "PNR is required" });
      }

      const booking = await Booking.findOne({ pnr, user_id });
      if (!booking) {
        return res.status(404).json({ success: false, message: "Booking not found" });
      }

      const filePath = await generateTicketPDF(booking);

      res.download(filePath, () => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  // CANCEL TICKET
  async cancelTicket(req, res) {
    try {
      const { pnr } = req.params;
      const { user_id } = req.user;

      if (!pnr) {
        return res.status(400).json({ success: false, message: "PNR is required" });
      }

      const result = await bookingService.cancelTicket(pnr, user_id);
      if (!result) {
        return res.status(404).json({ success: false, message: "Booking not found or already cancelled" });
      }

      return res.status(200).json({
        success: true,
        message: `Ticket cancelled successfully for ${pnr}`,
        data: result
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new BookingController();
