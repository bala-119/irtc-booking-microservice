const Schedule = require("../models/scheduleSchema.model");
const Booking = require("../models/bookingSchema.model");
const axios = require("axios");
const mongoose = require("mongoose");

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
  } else if (class_type === "3AC" || class_type === "2AC" || class_type === "1AC") {
    const positionInBlock = ((seatNumber - 1) % 8) + 1;
    if (positionInBlock === 1 || positionInBlock === 4) return "LOWER";
    else if (positionInBlock === 2 || positionInBlock === 5) return "MIDDLE";
    else if (positionInBlock === 3 || positionInBlock === 6) return "UPPER";
    else if (positionInBlock === 7) return "SIDE_LOWER";
    else return "SIDE_UPPER";
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
  berth_preference = "NO_PREFERENCE",
  booking_type = "GENERAL"  // Added with default "GENERAL"
}) {
  try {
    console.log("FULL BOOKING PAYLOAD RECEIVED:", arguments[0]);
    
    // Convert to uppercase and trim
    from_station = (from_station || "").toUpperCase().trim();
    to_station = (to_station || "").toUpperCase().trim();
    class_type = (class_type || "").toUpperCase().trim();
    booking_type = (booking_type || "GENERAL").toUpperCase().trim(); // Normalize booking type
    
    // Validate booking type
    const validBookingTypes = ["GENERAL", "TAKTL", "TATKAL"];
    if (!validBookingTypes.includes(booking_type)) {
      throw new Error(`Invalid booking type. Valid options: ${validBookingTypes.join(", ")}`);
    }
    
    console.log(`Booking request - Train: ${train_number}, From: ${from_station}, To: ${to_station}, Class: ${class_type}, Type: ${booking_type}, Passengers: ${passengers?.length}`);
    
    // Validate inputs
    if (!train_number) throw new Error("Train number is required");
    if (!journey_date) throw new Error("Journey date is required");
    if (!class_type) throw new Error("Class type is required");
    if (!from_station) throw new Error("From station is required");
    if (!to_station) throw new Error("To station is required");
    if (!passengers || passengers.length === 0) throw new Error("At least one passenger is required");
    if (!user_id) throw new Error("User ID is required");
    
    // Get train details
    let train;
    try {
      console.log(`Fetching train details for ${train_number}...`);
      const trainRes = await axios.get(
        `http://localhost:3003/train/get-train-by-number/${train_number}`
      );
      train = trainRes.data?.data;
      if (!train) throw new Error("Train not found");
      console.log(`Train found: ${train.train_name}`);
    } catch (error) {
      throw new Error(`Train service error: ${error.message}`);
    }

    // Convert station names to codes if needed
    let fromCode = from_station;
    let toCode = to_station;
    
    // Check if from_station is a name (not a 2-3 letter code)
    if (from_station.length > 3 || !train.station_map[from_station]) {
      const fromStationObj = train.route.find(station => 
        station.station_name.toUpperCase() === from_station ||
        station.station_name.toUpperCase().includes(from_station)
      );
      if (fromStationObj) {
        fromCode = fromStationObj.station_code;
        console.log(`Converted from station name "${from_station}" to code "${fromCode}"`);
      } else {
        throw new Error(`From station "${from_station}" not found in train route. Available stations: ${train.route.map(s => s.station_name).join(', ')}`);
      }
    }
    
    // Check if to_station is a name (not a 2-3 letter code)
    if (to_station.length > 3 || !train.station_map[to_station]) {
      const toStationObj = train.route.find(station => 
        station.station_name.toUpperCase() === to_station ||
        station.station_name.toUpperCase().includes(to_station)
      );
      if (toStationObj) {
        toCode = toStationObj.station_code;
        console.log(`Converted to station name "${to_station}" to code "${toCode}"`);
      } else {
        throw new Error(`To station "${to_station}" not found in train route. Available stations: ${train.route.map(s => s.station_name).join(', ')}`);
      }
    }

    // Get coaches for this class
    const classCoaches = train.coaches.filter(c => c.coach_type === class_type);
    if (classCoaches.length === 0) {
      throw new Error(`No coaches found for class ${class_type}`);
    }

    // Calculate total seats for this class
    const totalSeats = classCoaches.reduce((sum, coach) => sum + coach.total_seats, 0);
    
    // Adjust waiting list limit based on booking type
    let waitingListPercentage = WAITING_LIST_PERCENTAGE;
    if (booking_type === "TAKTL" || booking_type === "TATKAL") {
      // Tatkal bookings have lower waiting list limit (e.g., 50% instead of 100%)
      waitingListPercentage = 0.5;
      console.log(`Tatkal booking: Waiting list limit reduced to ${waitingListPercentage * 100}%`);
    }
    
    const maxWaitingLimit = Math.floor(totalSeats * waitingListPercentage);

    // Validate stations using codes
    const stationMap = train.station_map;
    const fromIndex = stationMap[fromCode];
    const toIndex = stationMap[toCode];

    if (fromIndex === undefined) {
      throw new Error(`From station "${from_station}" (code: ${fromCode}) not in train route. Available station codes: ${Object.keys(stationMap).join(', ')}`);
    }
    if (toIndex === undefined) {
      throw new Error(`To station "${to_station}" (code: ${toCode}) not in train route. Available station codes: ${Object.keys(stationMap).join(', ')}`);
    }
    if (fromIndex >= toIndex) {
      throw new Error(`Invalid journey direction: ${from_station} (${fromIndex}) must come before ${to_station} (${toIndex})`);
    }

    // Calculate stop gaps and fare
    const stopGaps = toIndex - fromIndex;
    let fare_per_passenger = this.calculateFareByStops(class_type, stopGaps, train);
    
    // Apply Tatkal surcharge if applicable (usually 10-30% higher)
    if (booking_type === "TAKTL" || booking_type === "TATKAL") {
      const tatkalSurcharge = 1.3; // 30% higher for Tatkal
      fare_per_passenger = Math.round(fare_per_passenger * tatkalSurcharge);
      console.log(`Tatkal fare applied: ${fare_per_passenger} per passenger (30% surcharge)`);
    }
    
    const total_fare = fare_per_passenger * passengers.length;

    console.log(`Fare calculated: ${fare_per_passenger} per passenger, Total: ${total_fare}`);

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

    // Check class availability - handle both Map and plain object
    let classData;
    if (schedule.seats instanceof Map) {
      classData = schedule.seats.get(class_type);
    } else {
      classData = schedule.seats[class_type];
    }
    
    if (!classData) {
      classData = { 
        total: totalSeats, 
        available: totalSeats, 
        max_waiting: maxWaitingLimit,
        waiting_count: 0
      };
      if (schedule.seats instanceof Map) {
        schedule.seats.set(class_type, classData);
      } else {
        schedule.seats[class_type] = classData;
      }
    }

    // Calculate available seats
    const availableSeats = this.getAvailableSeatsForSegment(
      schedule, class_type, fromIndex, toIndex, stationMap, classCoaches
    );
    
    // Get current waiting count
    let currentWaitingCount = 0;
    if (schedule.waiting_list) {
      currentWaitingCount = schedule.waiting_list.filter(w => w.class_type === class_type).length;
    }
    
    const pnr = generatePNR(train_number);
    let allocatedSeats = [];
    let bookingStatus = "CONFIRMED";
    let waitingNumber = 0;

    console.log(`Available seats: ${availableSeats}, Requested: ${passengers.length}, Waiting count: ${currentWaitingCount}`);

    if (availableSeats >= passengers.length) {
      // CONFIRMED BOOKING
      for (let i = 0; i < passengers.length; i++) {
        const passenger = passengers[i];
        const seat = this.allocateSeatWithPreference(
          schedule, class_type, fromCode, toCode, fromIndex, toIndex, 
          stationMap, classCoaches, allocatedSeats, berth_preference, passenger
        );
        
        const seatPosition = getSeatPosition(class_type, seat.seat_number);
        
        allocatedSeats.push({
          coach: seat.coach,
          seat_number: seat.seat_number,
          position: seatPosition
        });

        schedule.seat_bookings.push({
          class_type,
          coach: seat.coach,
          seat_number: seat.seat_number,
          seat_position: seatPosition,
          from: fromCode,
          to: toCode,
          passenger: {
            name: passenger.name,
            age: passenger.age,
            gender: passenger.gender,
            berth_preference: berth_preference
          },
          pnr
        });
      }
      
      // Update available seats
      const newAvailable = this.getAvailableSeatsForSegment(
        schedule, class_type, fromIndex, toIndex, stationMap, classCoaches
      );
      
      const updatedClassData = {
        total: classData.total,
        available: newAvailable,
        max_waiting: maxWaitingLimit,
        waiting_count: currentWaitingCount
      };
      
      if (schedule.seats instanceof Map) {
        schedule.seats.set(class_type, updatedClassData);
      } else {
        schedule.seats[class_type] = updatedClassData;
      }
      
    } else if (availableSeats > 0 && availableSeats < passengers.length) {
      throw new Error(`Only ${availableSeats} seats available. Please reduce number of passengers to ${availableSeats} or less.`);
    } else {
      // WAITING LIST BOOKING
      // Tatkal bookings typically don't allow waiting list
      if (booking_type === "TAKTL" || booking_type === "TATKAL") {
        throw new Error("Tatkal bookings do not support waiting list. Please try a different class or date.");
      }
      
      if (currentWaitingCount + passengers.length > maxWaitingLimit) {
        const availableSlots = maxWaitingLimit - currentWaitingCount;
        throw new Error(`Waiting list FULL. Only ${availableSlots} slots available. Please try a different class or date.`);
      }
      
      bookingStatus = "WAITING";
      waitingNumber = currentWaitingCount + 1;
      
      if (!schedule.waiting_list) {
        schedule.waiting_list = [];
      }
      
      schedule.waiting_list.push({
        pnr,
        passengers: passengers.map(p => ({ 
          name: p.name,
          age: p.age,
          gender: p.gender,
          berth_preference 
        })),
        from: fromCode,
        to: toCode,
        class_type,
        waiting_number: waitingNumber,
        created_at: new Date()
      });
      
      // Update waiting count
      classData.waiting_count = currentWaitingCount + passengers.length;
      if (schedule.seats instanceof Map) {
        schedule.seats.set(class_type, classData);
      } else {
        schedule.seats[class_type] = classData;
      }
    }

    await schedule.save();
    console.log(`Schedule saved with status: ${bookingStatus}`);

    // Get station names for response
    const fromStationName = train.route.find(s => s.station_code === fromCode)?.station_name || from_station;
    const toStationName = train.route.find(s => s.station_code === toCode)?.station_name || to_station;

    // Create booking record
    const booking = await Booking.create({
      pnr,
      user_id: new mongoose.Types.ObjectId(user_id),
      schedule_id: schedule._id,
      train_id: train._id,
      train_number,
      train_name: train.train_name,
      from_station: fromCode,
      to_station: toCode,
      from_station_name: fromStationName,
      to_station_name: toStationName,
      class_type,
      booking_type: booking_type, // Added booking type
      journey_date: startOfDay,
      passengers: passengers.map(p => ({ 
        name: p.name,
        age: p.age,
        gender: p.gender,
        berth_preference 
      })),
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
        metadata: {
          train_number,
          train_name: train.train_name,
          class_type,
          booking_type, // Added booking type to metadata
          from_station: fromCode,
          to_station: toCode,
          from_station_name: fromStationName,
          to_station_name: toStationName,
          passenger_count: passengers.length.toString(),
          journey_date,
          berth_preference,
          booking_status: bookingStatus
        }
      },
      payment_expires_at: new Date(Date.now() + 15 * 60 * 1000),
      confirmed_at: bookingStatus === "CONFIRMED" ? new Date() : null,
      cancellation_reason: null,
      cancelled_at: null
    });

    console.log(`Booking created with PNR: ${pnr}`);
    return booking;
    
  } catch (error) {
    console.error("BookSeat Error:", error);
    throw error;
  }
}
  allocateSeatWithPreference(schedule, class_type, from, to, fromIndex, toIndex, 
                             stationMap, classCoaches, newlyAllocated = [], 
                             berthPreference, passenger) {
    const existingBookings = schedule.seat_bookings || [];
    const bookingsForClass = existingBookings.filter(b => b.class_type === class_type);
    
    const allocatedSeatsSet = new Set();
    for (const seat of newlyAllocated) {
      allocatedSeatsSet.add(`${seat.coach}-${seat.seat_number}`);
    }
    
    // Try to allocate any available seat
    for (const coach of classCoaches) {
      for (let seatNum = 1; seatNum <= coach.total_seats; seatNum++) {
        if (allocatedSeatsSet.has(`${coach.coach_id}-${seatNum}`)) continue;
        
        const isAvailable = this.isSeatAvailableForSegment(
          seatNum, coach.coach_id, fromIndex, toIndex, bookingsForClass, stationMap
        );
        
        if (isAvailable) {
          return { coach: coach.coach_id, seat_number: seatNum };
        }
      }
    }
    
    throw new Error(`No seats available for segment ${from}→${to} in ${class_type} class`);
  }

  isSeatAvailableForSegment(seatNumber, coachId, fromIndex, toIndex, existingBookings, stationMap) {
    for (const booking of existingBookings) {
      if (booking.coach === coachId && booking.seat_number === seatNumber) {
        const bookedFromIndex = stationMap[booking.from];
        const bookedToIndex = stationMap[booking.to];
        
        // Check if booking overlaps with requested segment
        if (fromIndex < bookedToIndex && toIndex > bookedFromIndex) {
          return false;
        }
      }
    }
    return true;
  }

  getAvailableSeatsForSegment(schedule, class_type, fromIndex, toIndex, stationMap, classCoaches) {
    const existingBookings = schedule.seat_bookings || [];
    const bookingsForClass = existingBookings.filter(b => b.class_type === class_type);
    let available = 0;
    
    for (const coach of classCoaches) {
      for (let seatNum = 1; seatNum <= coach.total_seats; seatNum++) {
        const isAvailable = this.isSeatAvailableForSegment(
          seatNum, coach.coach_id, fromIndex, toIndex, bookingsForClass, stationMap
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
    try {
      const booking = await Booking.findOne({ pnr });
      if (!booking) throw new Error("Booking not found");
      return booking;
    } catch (error) {
      console.error("GetBooking Error:", error);
      throw error;
    }
  }

  async getUserBookings(user_id) {
    try {
      const bookings = await Booking.find({ user_id: new mongoose.Types.ObjectId(user_id) })
        .sort({ createdAt: -1 });
      return bookings;
    } catch (error) {
      console.error("GetUserBookings Error:", error);
      throw error;
    }
  }

  async cancelTicket(pnr, user_id) {
    try {
      const booking = await Booking.findOne({ pnr, user_id: new mongoose.Types.ObjectId(user_id) });
      if (!booking) throw new Error("Booking not found");
      if (booking.booking_status === "CANCELLED") throw new Error("Ticket already cancelled");
      
      // Check if cancellation is allowed (at least 2 hours before departure)
      const journeyDateTime = new Date(booking.journey_date);
      const currentTime = new Date();
      const hoursDifference = (journeyDateTime - currentTime) / (1000 * 60 * 60);
      
      if (hoursDifference < 2) {
        throw new Error("Cancellation not allowed less than 2 hours before departure");
      }
      
      const schedule = await Schedule.findById(booking.schedule_id);
      
      if (schedule && booking.booking_status === "CONFIRMED" && booking.seat_details && booking.seat_details.length > 0) {
        // Remove cancelled seats from seat_bookings
        schedule.seat_bookings = schedule.seat_bookings.filter(b => b.pnr !== pnr);
        
        // Update available seats count
        const stationMap = schedule.station_map || {};
        const fromIndex = stationMap[booking.from_station];
        const toIndex = stationMap[booking.to_station];
        
        if (fromIndex !== undefined && toIndex !== undefined) {
          // Get class coaches
          let classCoaches = [];
          try {
            const trainRes = await axios.get(
              `http://localhost:3003/train/get-train-by-number/${booking.train_number}`
            );
            const train = trainRes.data?.data;
            if (train && train.coaches) {
              classCoaches = train.coaches.filter(c => c.coach_type === booking.class_type);
            }
          } catch (error) {
            console.log("Could not fetch train details for seat update");
          }
          
          if (classCoaches.length > 0) {
            const newAvailable = this.getAvailableSeatsForSegment(
              schedule, booking.class_type, fromIndex, toIndex, stationMap, classCoaches
            );
            
            let classData;
            if (schedule.seats instanceof Map) {
              classData = schedule.seats.get(booking.class_type);
              if (classData) {
                classData.available = newAvailable;
                schedule.seats.set(booking.class_type, classData);
              }
            } else if (schedule.seats[booking.class_type]) {
              schedule.seats[booking.class_type].available = newAvailable;
            }
          }
        }
        
        await schedule.save();
      }
      
      // Handle waiting list promotion if needed
      if (schedule && schedule.waiting_list && schedule.waiting_list.length > 0) {
        // This would promote waiting list tickets to confirmed
        // You can implement this logic here
        console.log("Waiting list promotion logic can be implemented here");
      }
      
      booking.booking_status = "CANCELLED";
      booking.cancelled_at = new Date();
      booking.cancellation_reason = "Cancelled by user";
      await booking.save();
      
      return booking;
    } catch (error) {
      console.error("CancelTicket Error:", error);
      throw error;
    }
  }
  
  async getBookingByPNR(pnr) {
    return await this.getBooking(pnr);
  }
}

// Export an instance of the class
const bookingService = new BookingService();
module.exports = bookingService;