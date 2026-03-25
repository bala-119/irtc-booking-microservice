const bookingService = require("../services/bookingService");
const generateTicketPDF = require("../utils/generateTicket");
const Booking = require("../models/bookingSchema.model")
const jwt = require("jsonwebtoken")

class BookingController {
async bookTicket(req, res) {
    try {
      // 🔐 1. Extract token from header
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
          success: false,
          message: "Token missing or invalid"
        });
      }

      const token = authHeader.split(" ")[1];
      console.log(token)

      // 🔐 2. Verify token
      let decoded;
      try {
  console.log("TOKEN:", token);
  console.log("SECRET:", process.env.JWT_SECRET);

  decoded = jwt.verify(token, process.env.JWT_SECRET);

  console.log("DECODED:", decoded);

} catch (err) {
  console.error("JWT ERROR:", err.message);

  return res.status(401).json({
    success: false,
    message: err.message   // 👈 show real error
  });
}
      console.log(".......")
      console.log(decoded);
      // 🔥 3. Extract user details
      const user_id = decoded.user_id || decoded.id;
      console.log("#############################")
      console.log(user_id)
      const email = decoded.email;
      console.log(email)

      if ( !email) {
        return res.status(400).json({
          success: false,
          message: "Invalid token payload"
        });
      }

      // 🔥 4. Call service (NO decoding inside service anymore)
      const booking = await bookingService.bookTicket(
        req.body,
        user_id,
        email // ✅ pass email directly
      );

      return res.status(200).json({
        success: true,
        message: "Ticket booked successfully",
        data: booking
      });

    } catch (err) {
      console.error("BOOKING ERROR:", err);

      return res.status(500).json({
        success: false,
        message: err.message || "Something went wrong"
      });
    }}

  async getBooking(req, res) {
    try {
      const booking = await bookingService.getBooking(req.params.pnr);
      return res.status(200).json({ success: true, data: booking });
    } catch (err) {
      return res.status(404).json({ success: false, message: err.message });
    }
  }
  async  downloadTicket(req, res) {
  try {
    const { pnr } = req.params;

    const booking = await Booking.findOne({ pnr });
    console.log(booking)
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // 📄 Generate PDF
    const filePath = await generateTicketPDF(booking);

    // 📤 Send file
    return res.download(filePath);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async cancelTicket(req,res){
  try{
      const {pnr} = req.params;
      if (!pnr) {
      return res.status(404).json({ message: "pnr not found" });
    }


      
      const result = bookingService.cancelTicket(pnr);
      return res.status(200).json({success : true,message:`Ticket canceled sucessfully for ${pnr}`})
  }catch(error)
  {
    return res.status(500).json({success:false,data:error.message})
  }
  
  
}
}

module.exports = new BookingController();