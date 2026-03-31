const Schedule = require("../models/scheduleSchema.model");
const Booking = require("../models/bookingSchema.model");
const axios = require("axios");

// Helper: Generate PNR using Date.now + train number + random suffix
function generatePNR(train_number) {
  const timestamp = Date.now();
  const randomSuffix = Math.floor(Math.random() * 1000);
  return `${train_number}-${timestamp}-${randomSuffix}`;
}

class BookingService {

  async bookSeat({
    train_number,
    train_name,
    journey_date,
    class_type,
    from_station,
    to_station,
    passengers,
    user_id,
    email
  }) {
    from_station = from_station.toUpperCase();
    to_station = to_station.toUpperCase();
    class_type = class_type.toUpperCase();

    // If only train_name provided
    if (!train_number && train_name) {
      const res = await axios.get(`http://localhost:3003/train/search-by-name/${train_name}`);
      if (!res.data?.data) throw new Error("Train not found with given name");
      train_number = res.data.data.train_number;
    }

    if (!train_number) throw new Error("Train number or train name is required");

    // Get train details
    const trainRes = await axios.get(
      `http://localhost:3003/train/get-train-by-number/${train_number}`
    );
    const train = trainRes.data?.data;
    if (!train) throw new Error("Train not found from Train Service");

    const stationMap = train.station_map;
    if (!(from_station in stationMap)) throw new Error(`From station "${from_station}" not in train route`);
    if (!(to_station in stationMap)) throw new Error(`To station "${to_station}" not in train route`);
    if (stationMap[from_station] >= stationMap[to_station]) throw new Error("Invalid journey direction");

    // Match journey_date ignoring time
    const inputDate = new Date(journey_date);
    const startOfDay = new Date(inputDate); startOfDay.setHours(0,0,0,0);
    const endOfDay = new Date(inputDate); endOfDay.setHours(23,59,59,999);

    const schedule = await Schedule.findOne({
      train_number,
      journey_date: { $gte: startOfDay, $lte: endOfDay }
    });
    if (!schedule) throw new Error("Schedule not found for this train and date");

    // ✅ Generate PNR first
    const pnr = generatePNR(train_number);

    // Check seat availability
    const classData = schedule.seats.get(class_type);
    if (!classData) throw new Error("Class not available");

    let allocatedSeats = [];
    let bookingStatus = "CONFIRMED";

    // Check seat availability dynamically for the specific segment
    const fromIndex = stationMap[from_station];
    const toIndex = stationMap[to_station];
    const existingBookings = schedule.seat_bookings.filter(b => b.class_type === class_type);
    
    let availableCount = 0;
    for (let seatNum = 1; seatNum <= classData.total; seatNum++) {
      let isConflict = false;
      for (let booking of existingBookings) {
        if (booking.seat_number !== seatNum) continue;
        const bookedFrom = stationMap[booking.from];
        const bookedTo = stationMap[booking.to];
        if (!(toIndex <= bookedFrom || fromIndex >= bookedTo)) {
          isConflict = true;
          break;
        }
      }
      if (!isConflict) availableCount++;
    }

    if (availableCount >= passengers.length) {
      // Allocate seats
      for (let p of passengers) {
         const seat = this.allocateSeat(schedule, class_type, from_station, to_station, stationMap, allocatedSeats);
         allocatedSeats.push(seat);
      }

      // Save seat bookings with real PNR
      passengers.forEach((p, idx) => {
        schedule.seat_bookings.push({
          class_type,
          coach: allocatedSeats[idx].coach,
          seat_number: allocatedSeats[idx].seat_number,
          from: from_station,
          to: to_station,
          passenger: p,
          pnr
        });
      });
    } else {
      // 🚫 Not enough seats → waiting list
      bookingStatus = "WAITING";
      allocatedSeats = []; // no seats assigned
    }

    // Save schedule once
    await schedule.save();

    // Create booking
    const fare = 200; // TODO: calculate dynamically
    const booking = await Booking.create({
      pnr,
      user_id,
      schedule_id: schedule._id,
      train_id: train._id,
      train_number,
      train_name: train.train_name,
      from_station,
      to_station,
      class_type,
      journey_date,
      passengers,
      seat_details: allocatedSeats,
      fare_per_passenger: fare,
      total_fare: fare * passengers.length,
      status: bookingStatus
    });

    return booking;
  }

  // CORE ALLOCATION LOGIC
  allocateSeat(schedule, class_type, from, to, stationMap, newlyAllocated = []) {
    const classData = schedule.seats.get(class_type);
    if (!classData) throw new Error("Class not available");

    const fromIndex = stationMap[from];
    const toIndex = stationMap[to];

    const existingBookings = schedule.seat_bookings.filter(b => b.class_type === class_type);

    for (let seatNum = 1; seatNum <= classData.total; seatNum++) {
      let isConflict = false;
      
      // Check existing bookings
      for (let booking of existingBookings) {
        if (booking.seat_number !== seatNum) continue;
        const bookedFrom = stationMap[booking.from];
        const bookedTo = stationMap[booking.to];
        // 🚫 Overlap check
        if (!(toIndex <= bookedFrom || fromIndex >= bookedTo)) {
          isConflict = true;
          break;
        }
      }

      // Check newly allocated seats in the current transaction array
      if (!isConflict) {
        for (let newSeat of newlyAllocated) {
          if (newSeat.seat_number === seatNum) {
            isConflict = true;
            break;
          }
        }
      }

      if (!isConflict) {
        return { coach: `${class_type}-1`, seat_number: seatNum };
      }
    }
    throw new Error("No seats available for this segment");
  }

  // GET BOOKING
  async getBooking(pnr) {
    const booking = await Booking.findOne({ pnr }).populate("schedule_id");
    if (!booking) throw new Error("Booking not found with given PNR");
    return booking;
  }

  // CANCEL TICKET
  async cancelTicket(pnr, user_id) {
    const booking = await Booking.findOne({ pnr, user_id });
    if (!booking) throw new Error("Booking not found or already cancelled");
    if (booking.status === "CANCELLED") throw new Error("Ticket is already cancelled");

    booking.status = "CANCELLED";
    await booking.save();

    // Free up seats in schedule
    const schedule = await Schedule.findById(booking.schedule_id);
    if (schedule) {
      // Remove cancelled seats from seat_bookings
      schedule.seat_bookings = schedule.seat_bookings.filter(b => b.pnr !== pnr);
      await schedule.save();
    }

    return booking;
  }
}

module.exports = new BookingService();
