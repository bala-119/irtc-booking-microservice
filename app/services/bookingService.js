const Schedule = require("../models/scheduleSchema.model");
const Booking = require("../models/bookingSchema.model");
const axios = require("axios");

// Configuration
const WAITING_LIST_PERCENTAGE = 1.0; // 100% of total seats

// Base fare per stop gap
const BASE_FARE_PER_STOP = {
  "SL": 100, "2S": 80, "3AC": 250, "2AC": 350, "1AC": 500, "CC": 200
};

function generatePNR(train_number) {
  const timestamp = Date.now();
  const randomSuffix = Math.floor(Math.random() * 10000);
  return `${train_number}-${timestamp}-${randomSuffix}`;
}

function getSeatPosition(class_type, seatNumber) {
  if (class_type === "SL") {
    const positionInBlock = ((seatNumber - 1) % 8) + 1;
    if (positionInBlock <= 3) return "LOWER";
    else if (positionInBlock <= 6) return "UPPER";
    else if (positionInBlock === 7) return "SIDE_LOWER";
    else return "SIDE_UPPER";
  } else if (class_type === "2S") {
    const positionInRow = ((seatNumber - 1) % 3) + 1;
    if (positionInRow === 1) return "WINDOW";
    if (positionInRow === 2) return "MIDDLE";
    return "AISLE";
  }
  return "STANDARD";
}

class BookingService {

  async bookSeat({
    train_number,
    journey_date,
    class_type,
    from_station,
    to_station,
    passengers,
    user_id,
    berth_preference = "NO_PREFERENCE"
  }) {
    try {
      from_station = from_station.toUpperCase();
      to_station = to_station.toUpperCase();
      class_type = class_type.toUpperCase();
      
      // Get train details
      let train;
      try {
        const trainRes = await axios.get(
          `http://localhost:3003/train/get-train-by-number/${train_number}`
        );
        train = trainRes.data?.data;
        if (!train) throw new Error("Train not found");
      } catch (error) {
        throw new Error(`Train service error: ${error.message}`);
      }

      // Get coaches for this class
      const classCoaches = train.coaches.filter(c => c.coach_type === class_type);
      if (classCoaches.length === 0) {
        throw new Error(`No coaches found for class ${class_type}`);
      }

      // Calculate total seats for this class
      const totalSeats = classCoaches.reduce((sum, coach) => sum + coach.total_seats, 0);
      const maxWaitingLimit = Math.floor(totalSeats * WAITING_LIST_PERCENTAGE);

      // Validate stations
      const stationMap = train.station_map;
      const fromIndex = stationMap[from_station];
      const toIndex = stationMap[to_station];

      if (fromIndex === undefined) throw new Error(`From station "${from_station}" not in train route`);
      if (toIndex === undefined) throw new Error(`To station "${to_station}" not in train route`);
      if (fromIndex >= toIndex) throw new Error("Invalid journey direction");

      // Calculate stop gaps and fare
      const stopGaps = toIndex - fromIndex;
      const fare_per_passenger = this.calculateFareByStops(class_type, stopGaps, train);
      const total_fare = fare_per_passenger * passengers.length;

      // Find schedule
      const inputDate = new Date(journey_date);
      const startOfDay = new Date(Date.UTC(
        inputDate.getUTCFullYear(),
        inputDate.getUTCMonth(),
        inputDate.getUTCDate(),
        0, 0, 0, 0
      ));
      
      let schedule = await Schedule.findOne({
        train_number: train_number,
        journey_date: {
          $gte: startOfDay,
          $lte: new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1)
        }
      });
      
      if (!schedule) {
        throw new Error(`Schedule not found for train ${train_number} on date ${journey_date}`);
      }

      // Check class availability
      let classData = schedule.seats.get(class_type);
      if (!classData) {
        classData = { 
          total: totalSeats, 
          available: totalSeats, 
          max_waiting: maxWaitingLimit,
          waiting_count: 0
        };
        schedule.seats.set(class_type, classData);
      }

      // Calculate available seats
      const availableSeats = this.getAvailableSeatsForSegment(
        schedule, class_type, fromIndex, toIndex, stationMap, classCoaches
      );
      
      const currentWaitingCount = schedule.waiting_list.filter(w => w.class_type === class_type).length;
      
      const pnr = generatePNR(train_number);
      let allocatedSeats = [];
      let bookingStatus = "CONFIRMED";
      let waitingNumber = 0;

      if (availableSeats >= passengers.length) {
        // CONFIRMED BOOKING
        for (let i = 0; i < passengers.length; i++) {
          const passenger = passengers[i];
          const seat = this.allocateSeatWithPreference(
            schedule, class_type, from_station, to_station, fromIndex, toIndex, 
            stationMap, classCoaches, allocatedSeats, berth_preference, passenger
          );
          
          const seatPosition = getSeatPosition(class_type, seat.seat_number);
          seat.position = seatPosition;
          
          allocatedSeats.push(seat);

          schedule.seat_bookings.push({
            class_type,
            coach: seat.coach,
            seat_number: seat.seat_number,
            seat_position: seatPosition,
            from: from_station,
            to: to_station,
            passenger: {
              ...passenger,
              berth_preference
            },
            pnr
          });
        }
        
        // Update available seats
        const newAvailable = this.getAvailableSeatsForSegment(
          schedule, class_type, fromIndex, toIndex, stationMap, classCoaches
        );
        schedule.seats.set(class_type, { 
          total: classData.total, 
          available: newAvailable,
          max_waiting: maxWaitingLimit,
          waiting_count: currentWaitingCount
        });
        
      } else if (availableSeats > 0 && availableSeats < passengers.length) {
        throw new Error(`Only ${availableSeats} seats available. Please reduce number of passengers.`);
      } else {
        // WAITING LIST BOOKING
        if (currentWaitingCount + passengers.length > maxWaitingLimit) {
          const availableSlots = maxWaitingLimit - currentWaitingCount;
          throw new Error(`Waiting list FULL. Only ${availableSlots} slots available.`);
        }
        
        bookingStatus = "WAITING";
        waitingNumber = currentWaitingCount + 1;
        
        schedule.waiting_list.push({
          pnr,
          passengers: passengers.map(p => ({ ...p, berth_preference })),
          from: from_station,
          to: to_station,
          class_type,
          created_at: new Date()
        });
        
        // Update waiting count
        classData.waiting_count = currentWaitingCount + passengers.length;
        schedule.seats.set(class_type, classData);
      }

      await schedule.save();

      // Create booking record
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
        journey_date: startOfDay,
        passengers: passengers.map(p => ({ ...p, berth_preference })),
        seat_details: allocatedSeats,
        fare_per_passenger,
        total_fare: total_fare,
        booking_status: bookingStatus,
        waiting_number: waitingNumber,
        stop_gaps: stopGaps,
        payment_status: "PENDING",
        payment_details: {
          amount: total_fare,
          currency: "INR",
          status: "PENDING",
          metadata: new Map([
            ["train_number", train_number],
            ["train_name", train.train_name],
            ["class_type", class_type],
            ["from_station", from_station],
            ["to_station", to_station],
            ["passenger_count", passengers.length.toString()],
            ["journey_date", journey_date],
            ["berth_preference", berth_preference],
            ["booking_status", bookingStatus]
          ])
        },
        payment_expires_at: new Date(Date.now() + 15 * 60 * 1000),
        confirmed_at: null,
        cancellation_reason: null,
        cancelled_at: null
      });

      return booking;
      
    } catch (error) {
      console.error("BookSeat Error:", error);
      throw error;
    }
  }

  allocateSeatWithPreference(schedule, class_type, from, to, fromIndex, toIndex, 
                             stationMap, classCoaches, newlyAllocated = [], 
                             berthPreference, passenger) {
    const existingBookings = schedule.seat_bookings.filter(b => b.class_type === class_type);
    
    const allocatedSeatsSet = new Set();
    for (const seat of newlyAllocated) {
      allocatedSeatsSet.add(`${seat.coach}-${seat.seat_number}`);
    }
    
    // Try to allocate any available seat
    for (const coach of classCoaches) {
      for (let seatNum = 1; seatNum <= coach.total_seats; seatNum++) {
        if (allocatedSeatsSet.has(`${coach.coach_id}-${seatNum}`)) continue;
        
        const isAvailable = this.isSeatAvailableForSegment(
          seatNum, coach.coach_id, fromIndex, toIndex, existingBookings, stationMap
        );
        
        if (isAvailable) {
          return { coach: coach.coach_id, seat_number: seatNum };
        }
      }
    }
    
    throw new Error(`No seats available for segment ${from}→${to}`);
  }

  isSeatAvailableForSegment(seatNumber, coachId, fromIndex, toIndex, existingBookings, stationMap) {
    for (const booking of existingBookings) {
      if (booking.coach === coachId && booking.seat_number === seatNumber) {
        const bookedFromIndex = stationMap[booking.from];
        const bookedToIndex = stationMap[booking.to];
        
        if (fromIndex < bookedToIndex && toIndex > bookedFromIndex) {
          return false;
        }
      }
    }
    return true;
  }

  getAvailableSeatsForSegment(schedule, class_type, fromIndex, toIndex, stationMap, classCoaches) {
    const existingBookings = schedule.seat_bookings.filter(b => b.class_type === class_type);
    let available = 0;
    
    for (const coach of classCoaches) {
      for (let seatNum = 1; seatNum <= coach.total_seats; seatNum++) {
        const isAvailable = this.isSeatAvailableForSegment(
          seatNum, coach.coach_id, fromIndex, toIndex, existingBookings, stationMap
        );
        if (isAvailable) {
          available++;
        }
      }
    }
    
    return available;
  }

  calculateFareByStops(class_type, stopGaps, train) {
    const baseFarePerStop = BASE_FARE_PER_STOP[class_type] || 100;
    let fare = baseFarePerStop * stopGaps;
    
    if (train.class_pricing && train.class_pricing[class_type]) {
      const totalStops = train.route.length - 1;
      const fareRatio = stopGaps / totalStops;
      fare = train.class_pricing[class_type] * fareRatio;
    }
    
    return Math.round(fare);
  }

  async getBooking(pnr) {
    const booking = await Booking.findOne({ pnr });
    if (!booking) throw new Error("Booking not found");
    return booking;
  }

  async cancelTicket(pnr, user_id) {
    const booking = await Booking.findOne({ pnr, user_id });
    if (!booking) throw new Error("Booking not found");
    if (booking.booking_status === "CANCELLED") throw new Error("Ticket already cancelled");

    const schedule = await Schedule.findById(booking.schedule_id);
    
    if (schedule && booking.booking_status === "CONFIRMED" && booking.seat_details && booking.seat_details.length > 0) {
      // Remove cancelled seats
      schedule.seat_bookings = schedule.seat_bookings.filter(b => b.pnr !== pnr);
      await schedule.save();
    }
    
    booking.booking_status = "CANCELLED";
    booking.cancelled_at = new Date();
    await booking.save();
    
    return booking;
  }
}

// IMPORTANT: Export an instance of the class
const bookingService = new BookingService();
module.exports = bookingService;