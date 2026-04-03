const bookingService = require("../services/bookingService");
const Booking = require("../models/bookingSchema.model");
const Schedule = require("../models/scheduleSchema.model");
const scheduleService = require("../services/scheduleService");
const waitingListProcessor = require("../jobs/waitingListProcessor");

class BookingController {

  async bookTicket(req, res) {
    try {
      console.log("Decoding user...");
      const decodedUser = req.user;

      const bookingPayload = {
        ...req.body,
        user_id: decodedUser.id,
        email: decodedUser.email,
        phone: decodedUser.phone,
        fullName: decodedUser.fullName,
        user_name: decodedUser.user_name
      };

      const booking = await bookingService.bookSeat(bookingPayload);

      // Return payment required info
      return res.status(201).json({
        success: true,
        message: booking.booking_status === "WAITING" 
          ? "Booking added to waiting list. Payment required to confirm waiting list position."
          : "Ticket booked successfully. Payment required to confirm booking.",
        data: {
          pnr: booking.pnr,
          booking_status: booking.booking_status,
          waiting_number: booking.waiting_number,
          total_fare: booking.total_fare,
          payment_status: booking.payment_status,
          payment_expires_at: booking.payment_expires_at,
          requires_payment: true,
          payment_link: `/api/payments/create-payment/${booking.pnr}` // Optional
        }
      });
    } catch (err) {
      console.error("BOOKING ERROR:", err);
      return res.status(500).json({ 
        success: false, 
        message: err.message 
      });
    }
  }

  async getBooking(req, res) {
    try {
      const { pnr } = req.params;
      const userId = req.user?.id;

      if (!pnr) {
        return res.status(400).json({ 
          success: false, 
          message: "PNR is required" 
        });
      }

      const booking = await bookingService.getBooking(pnr);
      
      // Check if booking belongs to user or is public view (only show limited info)
      if (userId && booking.user_id !== userId) {
        // For non-owners, only show basic info (like PNR status check)
        return res.status(200).json({ 
          success: true, 
          data: {
            pnr: booking.pnr,
            train_number: booking.train_number,
            train_name: booking.train_name,
            from_station: booking.from_station,
            to_station: booking.to_station,
            journey_date: booking.journey_date,
            class_type: booking.class_type,
            booking_status: booking.booking_status,
            waiting_number: booking.waiting_number,
            passenger_count: booking.passengers.length
          }
        });
      }

      return res.status(200).json({ 
        success: true, 
        data: booking 
      });
    } catch (err) {
      return res.status(500).json({ 
        success: false, 
        message: err.message 
      });
    }
  }
  // Add these methods to your existing BookingController class

  // Public PNR status check (limited info)
  async getPublicPNRStatus(req, res) {
    try {
      const { pnr } = req.params;

      if (!pnr) {
        return res.status(400).json({ 
          success: false, 
          message: "PNR is required" 
        });
      }

      const booking = await Booking.findOne({ pnr });
      
      if (!booking) {
        return res.status(404).json({ 
          success: false, 
          message: "Booking not found" 
        });
      }

      // Return limited info for public view
      return res.status(200).json({ 
        success: true, 
        data: {
          pnr: booking.pnr,
          train_number: booking.train_number,
          train_name: booking.train_name,
          from_station: booking.from_station,
          to_station: booking.to_station,
          journey_date: booking.journey_date,
          class_type: booking.class_type,
          booking_status: booking.booking_status,
          waiting_number: booking.waiting_number,
          passenger_count: booking.passengers.length
        }
      });
    } catch (err) {
      return res.status(500).json({ 
        success: false, 
        message: err.message 
      });
    }
  }

  // Get user's all bookings
  async getMyBookings(req, res) {
    try {
      const { id: user_id } = req.user;

      const bookings = await Booking.find({ user_id })
        .sort({ createdAt: -1 })
        .limit(50);

      return res.status(200).json({
        success: true,
        count: bookings.length,
        data: bookings.map(b => ({
          pnr: b.pnr,
          train_number: b.train_number,
          train_name: b.train_name,
          from_station: b.from_station,
          to_station: b.to_station,
          journey_date: b.journey_date,
          class_type: b.class_type,
          booking_status: b.booking_status,
          waiting_number: b.waiting_number,
          payment_status: b.payment_status,
          total_fare: b.total_fare,
          created_at: b.createdAt
        }))
      });

    } catch (error) {
      console.error("Get my bookings error:", error);
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Get refund status
  async getRefundStatus(req, res) {
    try {
      const { pnr } = req.params;
      const { id: user_id } = req.user;

      const booking = await Booking.findOne({ pnr, user_id });
      
      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found"
        });
      }

      const refundInfo = {
        is_refunded: booking.payment_details?.status === "REFUNDED",
        refund_amount: booking.payment_details?.refund_amount,
        refund_date: booking.payment_details?.refund_date,
        refund_reason: booking.payment_details?.refund_reason,
        refund_id: booking.payment_details?.refund_id
      };

      return res.status(200).json({
        success: true,
        data: refundInfo
      });

    } catch (error) {
      console.error("Get refund status error:", error);
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Get waiting list status (Admin)
  async getWaitingListStatus(req, res) {
    try {
      const { scheduleId, classType } = req.params;
      const { role } = req.user;

      if (role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: "Admin access required"
        });
      }

      const Schedule = require("../models/scheduleSchema.model");
      const schedule = await Schedule.findById(scheduleId);
      
      if (!schedule) {
        return res.status(404).json({
          success: false,
          message: "Schedule not found"
        });
      }

      const waitingEntries = schedule.waiting_list.filter(w => w.class_type === classType);
      const classData = schedule.seats.get(classType);

      return res.status(200).json({
        success: true,
        data: {
          total_seats: classData?.total || 0,
          available_seats: classData?.available || 0,
          waiting_count: waitingEntries.length,
          max_waiting: classData?.max_waiting || 0,
          waiting_list: waitingEntries.map((entry, index) => ({
            pnr: entry.pnr,
            position: index + 1,
            passengers_count: entry.passengers.length,
            created_at: entry.created_at
          }))
        }
      });

    } catch (error) {
      console.error("Get waiting list status error:", error);
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Manual process waiting list (Admin)
  async manualProcessWaitingList(req, res) {
    try {
      const { role } = req.user;

      if (role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: "Admin access required"
        });
      }

      const waitingListProcessor = require("../cron/waitingListProcessor");
      await waitingListProcessor.processAllWaitingLists();

      return res.status(200).json({
        success: true,
        message: "Waiting list processing completed"
      });

    } catch (error) {
      console.error("Manual process waiting list error:", error);
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Get seat availability (Admin)
  async getSeatAvailability(req, res) {
    try {
      const { scheduleId, classType } = req.params;
      const { role } = req.user;

      if (role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: "Admin access required"
        });
      }

      const Schedule = require("../models/scheduleSchema.model");
      const schedule = await Schedule.findById(scheduleId);
      
      if (!schedule) {
        return res.status(404).json({
          success: false,
          message: "Schedule not found"
        });
      }

      const classData = schedule.seats.get(classType);
      if (!classData) {
        return res.status(404).json({
          success: false,
          message: `Class ${classType} not found`
        });
      }

      const bookings = schedule.seat_bookings.filter(b => b.class_type === classType);

      const seatAvailability = {};
      for (let i = 1; i <= classData.total; i++) {
        const seatBookings = bookings.filter(b => b.seat_number === i);
        seatAvailability[i] = {
          seat_number: i,
          status: seatBookings.length === 0 ? "AVAILABLE" : "BOOKED",
          bookings: seatBookings.map(b => ({
            from: b.from,
            to: b.to,
            pnr: b.pnr
          }))
        };
      }

      return res.status(200).json({
        success: true,
        data: {
          total_seats: classData.total,
          available_seats: classData.available,
          waiting_count: classData.waiting_count || 0,
          max_waiting: classData.max_waiting,
          seat_availability: seatAvailability
        }
      });

    } catch (error) {
      console.error("Get seat availability error:", error);
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Get user bookings (Admin)
  async getUserBookings(req, res) {
    try {
      const { userId } = req.params;
      const { id: currentUserId, role } = req.user;

      if (currentUserId !== userId && role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: "Access denied"
        });
      }

      const bookings = await Booking.find({ user_id: userId })
        .sort({ createdAt: -1 })
        .limit(50);

      return res.status(200).json({
        success: true,
        count: bookings.length,
        data: bookings.map(b => ({
          pnr: b.pnr,
          train_number: b.train_number,
          train_name: b.train_name,
          from_station: b.from_station,
          to_station: b.to_station,
          journey_date: b.journey_date,
          class_type: b.class_type,
          booking_status: b.booking_status,
          waiting_number: b.waiting_number,
          payment_status: b.payment_status,
          total_fare: b.total_fare,
          created_at: b.createdAt
        }))
      });

    } catch (error) {
      console.error("Get user bookings error:", error);
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Release expired bookings (Internal)
  async releaseExpiredBookings(req, res) {
    try {
      const serviceAuth = req.headers['x-service-auth'];
      const expectedToken = process.env.SERVICE_AUTH_TOKEN || 'internal-secret-key-12345';
      
      const isAuthorized = serviceAuth === expectedToken;
      
      if (!isAuthorized && req.user?.role !== 'admin') {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized service request'
        });
      }

      const expiredBookings = await Booking.find({
        payment_status: "PENDING",
        payment_expires_at: { $lt: new Date() },
        booking_status: { $in: ["CONFIRMED", "WAITING"] }
      });

      let released = 0;
      for (const booking of expiredBookings) {
        booking.booking_status = "CANCELLED";
        booking.payment_status = "FAILED";
        booking.cancellation_reason = "Payment timeout";
        booking.cancelled_at = new Date();
        await booking.save();
        
        // Release seats if confirmed booking
        if (booking.seat_details && booking.seat_details.length > 0) {
          const Schedule = require("../models/scheduleSchema.model");
          const schedule = await Schedule.findById(booking.schedule_id);
          if (schedule) {
            schedule.seat_bookings = schedule.seat_bookings.filter(b => b.pnr !== booking.pnr);
            await schedule.save();
          }
        }
        released++;
      }

      return res.status(200).json({
        success: true,
        message: `Released ${released} expired bookings`,
        data: { released }
      });

    } catch (error) {
      console.error("Release expired bookings error:", error);
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Process waiting list (Internal)
  async processWaitingList(req, res) {
    try {
      const serviceAuth = req.headers['x-service-auth'];
      const expectedToken = process.env.SERVICE_AUTH_TOKEN || 'internal-secret-key-12345';
      
      if (!serviceAuth || serviceAuth !== expectedToken) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized service request'
        });
      }

      const waitingListProcessor = require("../cron/waitingListProcessor");
      await waitingListProcessor.processAllWaitingLists();

      return res.status(200).json({
        success: true,
        message: "Waiting list processing completed"
      });

    } catch (error) {
      console.error("Process waiting list error:", error);
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

async getBookingForPayment(req, res) {
  console.log("\n=== GET BOOKING FOR PAYMENT ===");
  console.log("PNR params:", req.params.pnr);
  
  try {
    const { pnr } = req.params;
    
    const serviceAuth = req.headers['x-service-auth'];
    const expectedToken = process.env.SERVICE_AUTH_TOKEN || 'internal-secret-key-12345';
    
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader && authHeader.split(' ')[1];
    
    const isAuthorized = serviceAuth === expectedToken || bearerToken;
    
    console.log("Is authorized:", isAuthorized);
    
    if (!isAuthorized) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized service request'
      });
    }

    // FIX: Populate scheduleId to get train details
    const booking = await Booking.findOne({ pnr }).populate('scheduleId');
    console.log("Found booking:", booking);
    console.log("Populated schedule:", booking?.scheduleId);
    
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found"
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        pnr: booking.pnr,
        booking_id: booking._id,
        user_id: booking.user_id,
        total_fare: booking.total_fare,
        booking_status: booking.booking_status,
        payment_status: booking.payment_status,
        from_station: booking.from_station,
        to_station: booking.to_station,
        train_number: booking.train_number,
        train_name: booking.train_name,
        class_type: booking.class_type,
        journey_date: booking.journey_date,
        passenger_count: booking.passengers?.length || 0,
        payment_expires_at: booking.payment_expires_at,
        fare_per_passenger: booking.fare_per_passenger,
        stop_gaps: booking.stop_gaps,
        waiting_number: booking.waiting_number
      }
    });

  } catch (error) {
    console.error("Get booking for payment error:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

async confirmPayment(req, res) {
  console.log("\n=== CONFIRM PAYMENT CONTROLLER ===");
  console.log("Request params:", req.params);
  console.log("Request body:", JSON.stringify(req.body, null, 2));
  
  try {
    // FIX: Get pnr from body OR params (support both)
    const { pnr, payment_id, transaction_id, payment_status, payment_date, payment_method, stripe_payment_intent_id } = req.body;
    const pnrFromParams = req.params.pnr;
    
    const finalPnr = pnr || pnrFromParams;
    
    console.log("Final PNR:", finalPnr);
    
    if (!finalPnr) {
      return res.status(400).json({
        success: false,
        message: "PNR is required in either body or params"
      });
    }
    
    const serviceAuth = req.headers['x-service-auth'];
    const expectedToken = process.env.SERVICE_AUTH_TOKEN || 'internal-secret-key-12345';
    
    console.log("Service auth header:", serviceAuth);
    console.log("Expected token:", expectedToken);
    
    if (!serviceAuth || serviceAuth !== expectedToken) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized service request'
      });
    }

    // Find booking and populate scheduleId
    const booking = await Booking.findOne({ pnr: finalPnr }).populate('scheduleId');
    
    console.log("Found booking:", booking ? booking.pnr : "NOT FOUND");
    console.log("Schedule data:", booking?.scheduleId);
    
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found"
      });
    }

    if (booking.payment_status === "PAID") {
      return res.status(400).json({
        success: false,
        message: "Payment already completed for this booking"
      });
    }

    if (booking.payment_expires_at && new Date() > new Date(booking.payment_expires_at)) {
      booking.booking_status = "CANCELLED";
      booking.payment_status = "FAILED";
      booking.cancellation_reason = "Payment not completed within time limit";
      await booking.save();
      
      return res.status(410).json({
        success: false,
        message: "Payment time expired. Booking has been cancelled.",
        code: "PAYMENT_EXPIRED"
      });
    }

    if (payment_status === "PAID") {
      booking.payment_status = "PAID";
      
      if (booking.booking_status === "CONFIRMED") {
        booking.confirmed_at = new Date();
      }
      
      booking.payment_details = {
        ...booking.payment_details,
        payment_id,
        transaction_id,
        status: "PAID",
        payment_method,
        payment_date: payment_date || new Date(),
        stripe_payment_intent_id
      };
      booking.payment_expires_at = null;
      
      console.log(`✅ Payment confirmed for PNR: ${finalPnr}`);
    } else if (payment_status === "FAILED") {
      booking.payment_status = "FAILED";
      booking.payment_details = {
        ...booking.payment_details,
        payment_id,
        transaction_id,
        status: "FAILED",
        failure_reason: req.body.failure_reason || "Payment failed",
        payment_method
      };
      
      console.log(`❌ Payment failed for PNR: ${finalPnr}`);
    }

    await booking.save();

    // Return FULL booking details with populated schedule
    const responseData = {
      success: payment_status === "PAID",
      message: payment_status === "PAID" 
        ? (booking.booking_status === "WAITING" 
            ? "Payment confirmed. You are on waiting list. Will be confirmed if seats become available."
            : "Payment confirmed successfully. Ticket is confirmed.")
        : "Payment failed",
      data: {
        pnr: booking.pnr,
        booking_status: booking.booking_status,
        waiting_number: booking.waiting_number,
        payment_status: booking.payment_status,
        confirmed_at: booking.confirmed_at,
        total_fare: booking.total_fare,
        // ADD THESE FIELDS FOR THE RESPONSE
        train_number: booking.train_number,
        train_name: booking.train_name,
        from_station: booking.from_station,
        to_station: booking.to_station,
        class_type: booking.class_type,
        journey_date: booking.journey_date,
        passenger_count: booking.passengers?.length || 0
      }
    };
    
    console.log("Response data being sent:", JSON.stringify(responseData, null, 2));

    return res.status(200).json(responseData);

  } catch (error) {
    console.error("Confirm payment error:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}
  async getPaymentStatus(req, res) {
    try {
      const { pnr } = req.params;
      const { id: user_id } = req.user;

      if (!pnr) {
        return res.status(400).json({
          success: false,
          message: "PNR is required"
        });
      }

      const booking = await Booking.findOne({ pnr, user_id });
      
      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found"
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          pnr: booking.pnr,
          booking_status: booking.booking_status,
          waiting_number: booking.waiting_number,
          payment_status: booking.payment_status,
          is_paid: booking.payment_status === "PAID",
          requires_payment: booking.payment_status === "PENDING",
          payment_expires_at: booking.payment_expires_at,
          confirmed_at: booking.confirmed_at,
          total_fare: booking.total_fare,
          refund_eligible: booking.booking_status === "WAITING" && 
                           booking.payment_status === "PAID" &&
                           new Date() > new Date(booking.journey_date)
        }
      });

    } catch (error) {
      console.error("Get payment status error:", error);
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async getBookingWithPayment(req, res) {
    try {
      const { pnr } = req.params;
      const { id: user_id } = req.user;

      if (!pnr) {
        return res.status(400).json({
          success: false,
          message: "PNR is required"
        });
      }

      const booking = await Booking.findOne({ pnr, user_id });
      
      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found"
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          booking: {
            pnr: booking.pnr,
            train_number: booking.train_number,
            train_name: booking.train_name,
            from_station: booking.from_station,
            to_station: booking.to_station,
            class_type: booking.class_type,
            journey_date: booking.journey_date,
            passengers: booking.passengers,
            seat_details: booking.seat_details,
            booking_status: booking.booking_status,
            waiting_number: booking.waiting_number,
            total_fare: booking.total_fare,
            confirmed_at: booking.confirmed_at
          },
          payment: booking.payment_details
        }
      });

    } catch (error) {
      console.error("Get booking with payment error:", error);
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async cancelUnpaidBooking(req, res) {
    try {
      const { pnr } = req.params;
      const { id: user_id } = req.user;

      if (!pnr) {
        return res.status(400).json({
          success: false,
          message: "PNR is required"
        });
      }

      const booking = await Booking.findOne({ pnr, user_id });
      
      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found"
        });
      }

      if (booking.payment_status === "PAID") {
        return res.status(400).json({
          success: false,
          message: "Cannot cancel paid booking. Please use cancel ticket endpoint."
        });
      }

      booking.booking_status = "CANCELLED";
      booking.payment_status = "NOT_REQUIRED";
      booking.cancellation_reason = "Cancelled by user before payment";
      booking.cancelled_at = new Date();
      booking.payment_expires_at = null;
      
      await booking.save();

      // Release seats if confirmed booking
      if (booking.booking_status === "CONFIRMED" && booking.seat_details.length > 0) {
        const schedule = await Schedule.findById(booking.schedule_id);
        if (schedule) {
          schedule.seat_bookings = schedule.seat_bookings.filter(b => b.pnr !== pnr);
          await schedule.save();
        }
      }

      return res.status(200).json({
        success: true,
        message: "Booking cancelled successfully",
        data: {
          pnr: booking.pnr,
          booking_status: booking.booking_status,
          payment_status: booking.payment_status
        }
      });

    } catch (error) {
      console.error("Cancel unpaid booking error:", error);
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async cancelTicket(req, res) {
    try {
      const { pnr } = req.params;
      const { id: user_id } = req.user;

      if (!pnr) {
        return res.status(400).json({ 
          success: false, 
          message: "PNR is required" 
        });
      }

      const result = await bookingService.cancelTicket(pnr, user_id);

      let refundMessage = "";
      if (result.booking_status === "WAITING" && result.payment_status === "PAID") {
        refundMessage = " Refund will be processed within 7 working days.";
      }

      return res.status(200).json({
        success: true,
        message: `Ticket ${pnr} cancelled successfully.${refundMessage}`,
        data: result
      });
    } catch (error) {
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
  }

  async downloadTicket(req, res) {
    try {
      const { pnr } = req.params;
      const { id: user_id } = req.user;

      if (!pnr) {
        return res.status(400).json({ 
          success: false, 
          message: "PNR is required" 
        });
      }

      const booking = await Booking.findOne({ pnr, user_id });
      if (!booking) {
        return res.status(404).json({ 
          success: false, 
          message: "Booking not found" 
        });
      }

      // TODO: Implement PDF generation
      // For now, return booking data
      return res.status(200).json({
        success: true,
        message: "Ticket download feature coming soon",
        data: {
          pnr: booking.pnr,
          train: `${booking.train_number} - ${booking.train_name}`,
          from: booking.from_station,
          to: booking.to_station,
          date: booking.journey_date,
          class: booking.class_type,
          passengers: booking.passengers,
          seats: booking.seat_details,
          status: booking.booking_status
        }
      });

    } catch (error) {
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
  }

  async getRefundStatus(req, res) {
    try {
      const { pnr } = req.params;
      const { id: user_id } = req.user;

      const booking = await Booking.findOne({ pnr, user_id });
      
      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found"
        });
      }

      const refundInfo = {
        is_refunded: booking.payment_details?.status === "REFUNDED",
        refund_amount: booking.payment_details?.refund_amount,
        refund_date: booking.payment_details?.refund_date,
        refund_reason: booking.payment_details?.refund_reason,
        refund_id: booking.payment_details?.refund_id
      };

      return res.status(200).json({
        success: true,
        data: refundInfo
      });

    } catch (error) {
      console.error("Get refund status error:", error);
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async healthCheck(req, res) {
    try {
      return res.status(200).json({
        success: true,
        message: "Booking service is healthy",
        timestamp: new Date().toISOString(),
        service: "booking-microservice",
        version: "1.0.0"
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async getUserBookings(req, res) {
    try {
      const { userId } = req.params;
      const { id: currentUserId, role } = req.user;

      // Only allow admin or the user themselves
      if (currentUserId !== userId && role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: "Access denied"
        });
      }

      const bookings = await Booking.find({ user_id: userId })
        .sort({ createdAt: -1 })
        .limit(50);

      return res.status(200).json({
        success: true,
        count: bookings.length,
        data: bookings.map(b => ({
          pnr: b.pnr,
          train_number: b.train_number,
          train_name: b.train_name,
          from_station: b.from_station,
          to_station: b.to_station,
          journey_date: b.journey_date,
          class_type: b.class_type,
          booking_status: b.booking_status,
          waiting_number: b.waiting_number,
          payment_status: b.payment_status,
          total_fare: b.total_fare,
          created_at: b.createdAt
        }))
      });

    } catch (error) {
      console.error("Get user bookings error:", error);
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async getWaitingListStatus(req, res) {
    try {
      const { scheduleId, classType } = req.params;
      const { role } = req.user;

      if (role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: "Admin access required"
        });
      }

      const status = await scheduleService.getWaitingListStatus(scheduleId, classType);

      return res.status(200).json({
        success: true,
        data: status
      });

    } catch (error) {
      console.error("Get waiting list status error:", error);
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async manualProcessWaitingList(req, res) {
    try {
      const { role } = req.user;

      if (role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: "Admin access required"
        });
      }

      await waitingListProcessor.processAllWaitingLists();

      return res.status(200).json({
        success: true,
        message: "Waiting list processing completed"
      });

    } catch (error) {
      console.error("Manual process waiting list error:", error);
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async getSeatAvailability(req, res) {
    try {
      const { scheduleId, classType } = req.params;
      const { role } = req.user;

      if (role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: "Admin access required"
        });
      }

      const schedule = await Schedule.findById(scheduleId);
      if (!schedule) {
        return res.status(404).json({
          success: false,
          message: "Schedule not found"
        });
      }

      const classData = schedule.seats.get(classType);
      const bookings = schedule.seat_bookings.filter(b => b.class_type === classType);

      const seatAvailability = {};
      for (let i = 1; i <= classData.total; i++) {
        const seatBookings = bookings.filter(b => b.seat_number === i);
        seatAvailability[i] = {
          seat_number: i,
          status: seatBookings.length === 0 ? "AVAILABLE" : "BOOKED",
          bookings: seatBookings.map(b => ({
            from: b.from,
            to: b.to,
            pnr: b.pnr
          }))
        };
      }

      return res.status(200).json({
        success: true,
        data: {
          total_seats: classData.total,
          available_seats: classData.available,
          waiting_count: classData.waiting_count || 0,
          max_waiting: classData.max_waiting,
          seat_availability: seatAvailability
        }
      });

    } catch (error) {
      console.error("Get seat availability error:", error);
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async releaseExpiredBookings(req, res) {
    try {
      const serviceAuth = req.headers['x-service-auth'];
      const expectedToken = process.env.SERVICE_AUTH_TOKEN || 'internal-secret-key-12345';
      
      if (!serviceAuth || serviceAuth !== expectedToken) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized service request'
        });
      }

      const expiredBookings = await Booking.find({
        payment_status: "PENDING",
        payment_expires_at: { $lt: new Date() },
        booking_status: { $in: ["CONFIRMED", "WAITING"] }
      });

      let released = 0;
      for (const booking of expiredBookings) {
        booking.booking_status = "CANCELLED";
        booking.payment_status = "FAILED";
        booking.cancellation_reason = "Payment timeout";
        booking.cancelled_at = new Date();
        await booking.save();
        
        // Release seats if confirmed booking
        if (booking.booking_status === "CONFIRMED" && booking.seat_details.length > 0) {
          const schedule = await Schedule.findById(booking.schedule_id);
          if (schedule) {
            schedule.seat_bookings = schedule.seat_bookings.filter(b => b.pnr !== booking.pnr);
            await schedule.save();
          }
        }
        released++;
      }

      return res.status(200).json({
        success: true,
        message: `Released ${released} expired bookings`,
        data: { released }
      });

    } catch (error) {
      console.error("Release expired bookings error:", error);
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async processWaitingList(req, res) {
    try {
      const serviceAuth = req.headers['x-service-auth'];
      const expectedToken = process.env.SERVICE_AUTH_TOKEN || 'internal-secret-key-12345';
      
      if (!serviceAuth || serviceAuth !== expectedToken) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized service request'
        });
      }

      await waitingListProcessor.processAllWaitingLists();

      return res.status(200).json({
        success: true,
        message: "Waiting list processing completed"
      });

    } catch (error) {
      console.error("Process waiting list error:", error);
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
}

module.exports = new BookingController();