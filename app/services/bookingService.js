const Booking = require("../models/bookingSchema.model");
const Schedule = require("../models/scheduleSchema.model");
const axios = require("axios");
const jwt = require("jsonwebtoken");
class BookingService {

  generatePNR() { return "PNR" + Date.now(); }

  async getTrain(train_number) {
    const res = await axios.get(`http://localhost:3002/train/get-train-by-number/${train_number}`);
    const train = res.data?.data;
    if (!train) throw new Error("Train not found");
    return train;
  }

  validateStations(train, from, to) {
    const map = train.station_map;
    if (!(from in map) || !(to in map)) throw new Error("Invalid station");
    if (map[from] >= map[to]) throw new Error("Invalid journey direction");
  }

  async getSchedulesForTrain(train_number) {
    const schedules = await Schedule.find({ train_number }).sort({ journey_date: 1 });
    if (!schedules || schedules.length === 0) throw new Error("No schedules found for this train");
    return schedules;
  }

// async allocateSeats(class_type, count, coaches, scheduleId) {
//   // Atomically increment seat counter and decrement available seats
//   const schedule = await Schedule.findOneAndUpdate(
//     {
//       _id: scheduleId,
//       [`seats.${class_type}.available`]: { $gte: count } // ensure enough seats
//     },
//     {
//       $inc: {
//         [`seat_counters.${class_type}`]: count,
//         [`seats.${class_type}.available`]: -count
//       }
//     },
//     { new: true } // return updated document
//   );

//   if (!schedule) {
//     throw new Error("Not enough seats available or invalid class type");
//   }

//   // Generate allocated seats based on previous seat counter
//   const lastSeat = (schedule.seat_counters.get(class_type) || 0) - count;
//   const allocated = [];
//   const classCoaches = coaches.filter(c => c.coach_type === class_type);

//   for (let i = 1; i <= count; i++) {
//     let remaining = lastSeat + i;
//     let coachAssigned = null;
//     let seatNumInCoach = 0;

//     for (const coach of classCoaches) {
//       if (remaining <= coach.total_seats) {
//         coachAssigned = coach.coach_id;
//         seatNumInCoach = remaining;
//         break;
//       }
//       remaining -= coach.total_seats;
//     }

//     allocated.push({ coach: coachAssigned, seat_number: seatNumInCoach });
//   }

//   return allocated;
// }
async allocateSeats(class_type, count, coaches, scheduleId) {

  const schedule = await Schedule.findById(scheduleId);

  if (!schedule) throw new Error("Schedule not found");

  let allocated = [];

  // 🔥 STEP 1: USE REUSABLE SEATS FIRST
  let reusable = schedule.reusable_seats.get(class_type) || [];

  while (reusable.length > 0 && allocated.length < count) {
    allocated.push(reusable.shift());
  }

  schedule.reusable_seats.set(class_type, reusable);

  // 🔥 STEP 2: ALLOCATE NEW SEATS IF NEEDED
  const remaining = count - allocated.length;

  if (remaining > 0) {

    const updated = await Schedule.findOneAndUpdate(
      {
        _id: scheduleId,
        [`seats.${class_type}.available`]: { $gte: remaining }
      },
      {
        $inc: {
          [`seat_counters.${class_type}`]: remaining,
          [`seats.${class_type}.available`]: -remaining
        }
      },
      { new: true }
    );

    if (!updated) {
      throw new Error("Not enough seats");
    }

    const lastSeat =
      (updated.seat_counters.get(class_type) || 0) - remaining;

    const classCoaches = coaches.filter(
      c => c.coach_type === class_type
    );

    for (let i = 1; i <= remaining; i++) {
      let seatNum = lastSeat + i;
      let coachAssigned = null;

      for (const coach of classCoaches) {
        if (seatNum <= coach.total_seats) {
          coachAssigned = coach.coach_id;
          break;
        }
        seatNum -= coach.total_seats;
      }

      allocated.push({
        coach: coachAssigned,
        seat_number: seatNum
      });
    }
  }

  await schedule.save();

  return allocated;
}

//   async bookTicket(data, user_id) {
//     const { train_number, journey_date, class_type, from_station, to_station,booking_type, passengers } = data;

//     const start = new Date(journey_date); start.setHours(0, 0, 0, 0);
//     const end = new Date(journey_date); end.setHours(23, 59, 59, 999);

//     const schedule = await Schedule.findOne({ train_number, journey_date: { $gte: start, $lte: end } });
//     if (!schedule) throw new Error("Schedule not found");

//     const train = await this.getTrain(train_number);
//     this.validateStations(train, from_station, to_station);
//     // 💰 Get base price
// const basePrice = train.class_pricing[class_type];
// if (!basePrice) throw new Error("Pricing not defined for this class");

// // 📍 Calculate stops
// const fromIndex = train.station_map[from_station];
// const toIndex = train.station_map[to_station];

// const stops = toIndex - fromIndex;

// // 💰 Fare calculation
// const farePerPassenger = basePrice + (stops * 50);
// const totalFare = farePerPassenger * passengers.length;

//     const seatInfo = schedule.seats.get(class_type);
//     if (!seatInfo) throw new Error("Invalid class type");

//     let seatDetails = [];
//     let status = "CONFIRMED";

//     if (seatInfo.available < passengers.length) {
//       status = "WAITING";
//     } else {
//       seatInfo.available -= passengers.length;
//       seatDetails = await this.allocateSeats(class_type, passengers.length, train.coaches, schedule._id);
//       schedule.seats.set(class_type, seatInfo);
//       await schedule.save();
//     }

//     const booking = await Booking.create({
//   pnr: this.generatePNR(),
//   user_id,
//   train_id: schedule.train_id,
//   train_number,
//   train_name: schedule.train_name,
//   from_station,
//   to_station,
//   journey_date: new Date(journey_date),
//   class_type,
//   passengers,
//   seat_details: seatDetails,
//   status,
//   fare_per_passenger: farePerPassenger,
//   total_fare: totalFare
// });

//     return booking;
//   }
async bookTicket(data, user_id, email) {

  

  // 🔥 Extract email from token
 

  const {
    train_number,
    journey_date,
    class_type,
    from_station,
    to_station,
    booking_type,
    passengers
  } = data;

  const start = new Date(journey_date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(journey_date);
  end.setHours(23, 59, 59, 999);

  const schedule = await Schedule.findOne({
    train_number,
    journey_date: { $gte: start, $lte: end }
  });

  if (!schedule) throw new Error("Schedule not found");

  const train = await this.getTrain(train_number);
  this.validateStations(train, from_station, to_station);

  const basePrice = train.class_pricing[class_type];
  if (!basePrice) throw new Error("Pricing not defined");

  const stops =
    train.station_map[to_station] - train.station_map[from_station];

  const farePerPassenger = basePrice + (stops * 50);
  const totalFare = farePerPassenger * passengers.length;

  const seatInfo = schedule.seats.get(class_type);
  if (!seatInfo) throw new Error("Invalid class");

  let seatDetails = [];
  let status = "CONFIRMED";

  if (seatInfo.available < passengers.length) {
    status = "WAITING";
  } else {
    seatDetails = await this.allocateSeats(
      class_type,
      passengers.length,
      train.coaches,
      schedule._id
    );
  }

  const booking = await Booking.create({
    pnr: this.generatePNR(),
    user_id,
    schedule_id: schedule._id,
    train_id: schedule.train_id,
    train_number,
    train_name: schedule.train_name,
    from_station,
    to_station,
    journey_date: new Date(journey_date),
    class_type,
    booking_type,
    passengers,
    seat_details: seatDetails,
    status,
    fare_per_passenger: farePerPassenger,
    total_fare: totalFare
  });

  // 🔥 SEND EMAIL ALSO
  try {
    await axios.post(
      "http://localhost:3001/v1/notification/send-ticket",
      {
        email, // ✅ extracted from token
        pnr: booking.pnr,
        train_number: booking.train_number,
        train_name: booking.train_name,
        from: booking.from_station,
        to: booking.to_station,
        journey_date: booking.journey_date,
        class_type: booking.class_type,
        passengers: booking.passengers,
        seat_details: booking.seat_details,
        total_fare: booking.total_fare,
        status: booking.status
      }
    );

    console.log("✅ Ticket sent to notification service");

  } catch (err) {
    console.error("❌ Notification failed:", err.message);
  }

  return booking;
}
  async getBooking(pnr) {
    const booking = await Booking.findOne({ pnr });
    if (!booking) throw new Error("Booking not found");
    return booking;
  }
  //  async cancelTicket(pnr) {

  //   if (!pnr) throw new Error("PNR is required");

  //   // 🔍 1. Find booking
  //   const booking = await Booking.findOne({ pnr });
  //   if (!booking) {
  //     return { success: false, message: "Booking not found" };
  //   }

  //   // 🔍 2. Find schedule
  //   const start = new Date(booking.journey_date);
  //   start.setHours(0, 0, 0, 0);

  //   const end = new Date(booking.journey_date);
  //   end.setHours(23, 59, 59, 999);

  //   const schedule = await Schedule.findOne({
  //     train_number: booking.train_number,
  //     journey_date: { $gte: start, $lte: end }
  //   });

  //   if (!schedule) {
  //     throw new Error("Schedule not found while cancelling");
  //   }

  //   // 🔥 3. Restore availability ONLY if CONFIRMED
  //   if (booking.status === "CONFIRMED") {
  //     const classType = booking.class_type;
  //     const seatInfo = schedule.seats.get(classType);

  //     if (seatInfo) {
  //       seatInfo.available += booking.passengers.length;
  //       schedule.seats.set(classType, seatInfo);
  //     }

  //     // 🔥 4. Release seats (if you implemented seat collection)
  //     await this.releaseSeats(booking.seat_details, schedule._id);
  //   }

  //   // 💾 Save schedule
  //   await schedule.save();

  //   // ❌ 5. Delete booking (or use status = CANCELLED)
  //   await Booking.deleteOne({ pnr });

  //   return {
  //     success: true,
  //     message: "Ticket cancelled & seats released",
  //     data: {
  //       pnr: booking.pnr
  //     }
  //   };
  // }

  // ✅ SAFE releaseSeats
  async promoteWaitingList(schedule, class_type) {

  // 🔍 Get waiting bookings (FIFO)
  const waitingBookings = await Booking.find({
    schedule_id: schedule._id,
    class_type,
    status: "WAITING"
  }).sort({ createdAt: 1 });

  if (!waitingBookings.length) return;

  const train = await this.getTrain(schedule.train_number);

  for (const booking of waitingBookings) {

    const requiredSeats = booking.passengers.length;

    const seatInfo = schedule.seats.get(class_type);

    // ❌ Stop if not enough seats
    if (!seatInfo || seatInfo.available < requiredSeats) break;

    // ✅ Allocate seats (this will auto use reusable seats also)
    const seatDetails = await this.allocateSeats(
      class_type,
      requiredSeats,
      train.coaches,
      schedule._id
    );

    // ✅ Update booking
    booking.status = "CONFIRMED";
    booking.seat_details = seatDetails;

    await booking.save();

    console.log(`✅ WAITING → CONFIRMED: ${booking.pnr}`);
  }
}
// async cancelTicket(pnr) {

//   const booking = await Booking.findOne({ pnr });
//   console.log("booking", booking);

//   if (!booking) {
//     return { success: false, message: "Booking not found" };
//   }

//   // 🔥 DIRECT FETCH (NO DATE BUG EVER AGAIN)
//   const schedule = await Schedule.findById(booking.schedule_id);

//   console.log("schedule", schedule);

//   if (!schedule) {
//     throw new Error("Schedule not found");
//   }

//   // 🔥 ONLY FOR CONFIRMED
//   if (booking.status === "CONFIRMED") {

//     const seatInfo = schedule.seats.get(booking.class_type);

//     if (seatInfo) {
//       seatInfo.available += booking.passengers.length;
//       schedule.seats.set(booking.class_type, seatInfo);
//     }

//     // 🔥 ADD TO REUSABLE POOL
//     let reusable =
//       schedule.reusable_seats.get(booking.class_type) || [];

//     reusable.push(...booking.seat_details);

//     schedule.reusable_seats.set(booking.class_type, reusable);
//   }

//   await schedule.save();

//   await Booking.deleteOne({ pnr });

//   return {
//     success: true,
//     message: "Ticket cancelled & seats reusable now",
//     data: { pnr }
//   };
// }
async cancelTicket(pnr) {

  const booking = await Booking.findOne({ pnr });
  console.log("booking", booking);

  if (!booking) {
    return { success: false, message: "Booking not found" };
  }

  const schedule = await Schedule.findById(booking.schedule_id);

  console.log("schedule", schedule);

  if (!schedule) {
    throw new Error("Schedule not found");
  }

  // 🔥 ONLY FOR CONFIRMED
  if (booking.status === "CONFIRMED") {

    const seatInfo = schedule.seats.get(booking.class_type);

    if (seatInfo) {
      seatInfo.available += booking.passengers.length;
      schedule.seats.set(booking.class_type, seatInfo);
    }

    // 🔥 ADD TO REUSABLE POOL
    let reusable =
      schedule.reusable_seats.get(booking.class_type) || [];

    reusable.push(...booking.seat_details);

    schedule.reusable_seats.set(booking.class_type, reusable);
  }

  await schedule.save();


  await this.promoteWaitingList(schedule, booking.class_type);

  await Booking.deleteOne({ pnr });

  return {
    success: true,
    message: "Ticket cancelled & waiting list updated",
    data: { pnr }
  };
}
  async releaseSeats(seatDetails, scheduleId) {
    if (!seatDetails || seatDetails.length === 0) return;

    for (const seat of seatDetails) {
      console.log("Releasing seat:", seat);

      // 👉 If you have seat collection:
      // await Seat.updateOne(
      //   {
      //     coach: seat.coach,
      //     seat_number: seat.seat_number,
      //     schedule_id: scheduleId
      //   },
      //   { $set: { is_booked: false } }
      // );

    }
  }
}

module.exports = new BookingService();