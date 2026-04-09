const Schedule = require("../models/scheduleSchema.model");
const axios = require("axios");
const mongoose = require("mongoose");

const BASE_FARE_PER_STOP = {
  "SL": 100, "2S": 80, "3AC": 250, "2AC": 350, "1AC": 500, "CC": 200
};

class ScheduleService {

  async getTrain(train_number) {
    try {
      const res = await axios.get(
        `http://localhost:3003/train/get-train-by-number/${train_number}`
      );
      const train = res.data?.data;
      console.log(train)
      if (!train) throw new Error("Train not found");
      return train;
    } catch (error) {
      throw new Error(`Train service error: ${error.message}`);
    }
  }

  buildSeatsFromCoaches(coaches = []) {
    const seatMap = {};
    for (const coach of coaches) {
      if (!seatMap[coach.coach_type]) seatMap[coach.coach_type] = 0;
      seatMap[coach.coach_type] += coach.total_seats;
    }
    
    const seats = new Map();
    for (const type in seatMap) {
      const totalSeats = seatMap[type];
      // NEW: max_waiting = total seats (100% of total seats)
      // This implements "waiting list = total ticket" logic
      seats.set(type, { 
        total: totalSeats, 
        available: totalSeats,
        max_waiting: totalSeats,  // Changed from fixed numbers to total seats
        waiting_count: 0
      });
    }
    return seats;
  }

  async generateSchedule(data) {
    const { train_number, days, running_days } = data;
    
    if (!train_number || !days || !running_days) {
      throw new Error("Missing required fields: train_number, days, running_days");
    }

    const normalizedDays = running_days.map(d => d.toUpperCase());
    const train = await this.getTrain(train_number);

    const existingSchedules = await Schedule.find({ train_id: train._id });
    const existingDates = new Set(
      existingSchedules.map(s => new Date(s.journey_date).toISOString().split("T")[0])
    );

    const schedules = [];
    const daysOfWeek = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      const dayName = daysOfWeek[date.getDay()];
      
      if (!normalizedDays.includes(dayName)) continue;

      const journey_date = new Date(date);
      journey_date.setHours(0, 0, 0, 0);
      const dateStr = journey_date.toISOString().split("T")[0];
      
      if (existingDates.has(dateStr)) continue;
      console.log("going to push into schedule schema")
      schedules.push({
        train_id: train._id,
        train_number: train.train_number,
        train_name: train.train_name,
        journey_date,
        seats: this.buildSeatsFromCoaches(train.coaches),
        status: "ACTIVE",
        running_day: dayName
      });
    }

    if (schedules.length > 0) {
      await Schedule.insertMany(schedules);
    }
    
    return schedules;
  }

async searchSchedules(fromStationName, toStationName, date, sortBy = null, classFilter = null) {
  try {
    if (isNaN(new Date(date))) {
      throw new Error("Invalid date format. Use YYYY-MM-DD");
    }
    
    console.log(`Searching trains from "${fromStationName}" to "${toStationName}" on ${date}`);
    console.log(`Sort: ${sortBy || 'none'}, Class filter: ${classFilter || 'none'}`);
    
    // Make POST request to train search endpoint
    const trainRes = await axios.post(
      "http://localhost:3003/train/search",
      { from: fromStationName, to: toStationName }
    );
    
    const trains = trainRes.data?.data || [];
    console.log(`Found ${trains.length} trains from train service`);
    
    if (!trains.length) return [];

    // Extract train IDs for schedule lookup
    const trainIds = [];
    const trainMap = new Map();
    
    for (const train of trains) {
      let trainId = train.train_id;
      
      if (!trainId) {
        console.log(`No train_id found for train:`, train.train_number);
        continue;
      }
      
      if (!mongoose.Types.ObjectId.isValid(trainId)) {
        console.log(`Invalid ObjectId: ${trainId}`);
        continue;
      }
      
      trainIds.push(new mongoose.Types.ObjectId(trainId));
      trainMap.set(trainId, train);
      console.log(`Added train ID: ${trainId} for train ${train.train_number}`);
    }
    
    if (trainIds.length === 0) {
      console.log("No valid train IDs found");
      return [];
    }
    
    // Set up date range for search
    const searchDate = new Date(date);
    const start = new Date(Date.UTC(searchDate.getFullYear(), searchDate.getMonth(), searchDate.getDate(), 0, 0, 0));
    const end = new Date(Date.UTC(searchDate.getFullYear(), searchDate.getMonth(), searchDate.getDate(), 23, 59, 59, 999));
    
    console.log("Search date (UTC):", start.toISOString());
    
    // Find schedules for these trains - use lean() to get plain JavaScript objects
    const schedules = await Schedule.find({
      train_id: { $in: trainIds },
      journey_date: { $gte: start, $lte: end },
      status: "ACTIVE"
    }).lean(); // Add .lean() to get plain objects instead of Mongoose documents
    
    console.log(`Found ${schedules.length} schedules in database`);
    
    if (schedules.length === 0) return [];

    const result = [];
    
    // Process each schedule
    for (const schedule of schedules) {
      const scheduleTrainId = schedule.train_id.toString();
      console.log(`Processing schedule for train ID: ${scheduleTrainId}`);
      
      const train = trainMap.get(scheduleTrainId);
      
      if (!train) {
        console.log(`Train not found in map for ID: ${scheduleTrainId}`);
        continue;
      }
      
      console.log(`Processing train: ${train.train_number} - ${train.train_name}`);
      
      const fromCode = train.from_code;
      const toCode = train.to_code;
      const fromName = train.from_name;
      const toName = train.to_name;
      const departureTime = train.departure_time;
      const arrivalTime = train.arrival_time;
      const duration = train.duration;
      
      console.log(`Stations - From: ${fromName} (${fromCode}), To: ${toName} (${toCode})`);
      
      // Get seat availability - convert to plain object
      const seats = {};
      
      if (schedule.seats) {
        // Convert schedule.seats to plain object if it's a Map or Mongoose object
        let seatsData = schedule.seats;
        
        // If it's a Map, convert to object
        if (seatsData instanceof Map) {
          seatsData = Object.fromEntries(seatsData);
        }
        
        // Iterate over seat types
        for (const [classType, classData] of Object.entries(seatsData)) {
          // Apply class filter if specified
          if (classFilter && classFilter !== classType && 
              !(classFilter === "AC" && ["1AC", "2AC", "3AC"].includes(classType))) {
            continue;
          }
          
          // Source of truth is the schedule's classData
          let availableSeats = classData.available || 0;
          
          // Only use train-level availability if schedule data is missing (not typical)
          if (classData.available === undefined && train.availability && train.availability[classType]) {
            availableSeats = train.availability[classType].available_seats;
          }
          
          // Distance-based pricing
          const stopGaps = train.stop_gaps || 0;
          const totalStops = train.total_stops || 1;
          
          let calculatedPrice = (BASE_FARE_PER_STOP[classType] || 100) * stopGaps;
          if (train.class_pricing?.[classType]) {
            const fareRatio = stopGaps / totalStops;
            calculatedPrice = Math.round(train.class_pricing[classType] * fareRatio);
          }

          seats[classType] = {
            total: classData.total || 0,
            available: availableSeats,
            waiting_list_count: classData.waiting_count || 0,
            max_waiting: classData.max_waiting || classData.total || 0,
            price: calculatedPrice || null
          };
        }
      } else if (train.availability) {
        // If schedule has no seats but train has availability
        for (const [classType, availabilityData] of Object.entries(train.availability)) {
          if (classFilter && classFilter !== classType && 
              !(classFilter === "AC" && ["1AC", "2AC", "3AC"].includes(classType))) {
            continue;
          }
          
          // Distance-based pricing
          const stopGaps = train.stop_gaps || 0;
          const totalStops = train.total_stops || 1;
          
          let calculatedPrice = (BASE_FARE_PER_STOP[classType] || 100) * stopGaps;
          if (train.class_pricing?.[classType]) {
            const fareRatio = stopGaps / totalStops;
            calculatedPrice = Math.round(train.class_pricing[classType] * fareRatio);
          }

          seats[classType] = {
            total: 0,
            available: availabilityData.available_seats || 0,
            waiting_list_count: 0,
            max_waiting: 0,
            price: calculatedPrice || null
          };
        }
      }
      
      // Skip trains that don't have the requested class
      if (classFilter && Object.keys(seats).length === 0) {
        console.log(`Train ${train.train_number} doesn't have class ${classFilter}`);
        continue;
      }
      
      const trainResult = {
        train_id: scheduleTrainId,
        train_number: train.train_number,
        train_name: train.train_name,
        from_station: {
          code: fromCode,
          name: fromName
        },
        to_station: {
          code: toCode,
          name: toName
        },
        departure_time: departureTime,
        arrival_time: arrivalTime,
        duration: duration,
        duration_hours: duration ? Math.floor(duration / 60) : null,
        duration_minutes: duration ? duration % 60 : null,
        journey_date: schedule.journey_date,
        seats: seats // Now seats is a plain object
      };
      
      console.log(`Added train ${train.train_number} to results with seat types: ${Object.keys(seats).join(', ')}`);
      result.push(trainResult);
    }
    
    // Apply sorting
    if (sortBy && result.length > 0) {
      this.sortResults(result, sortBy);
      console.log(`Sorted results by ${sortBy}`);
    }
    
    console.log(`Final result count: ${result.length}`);
    return result;
    
  } catch (error) {
    console.error("Error in searchSchedules:", error);
    throw error;
  }
}

// Helper method to convert time string to minutes
getMinutes(timeStr) {
  if (!timeStr) return null;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

// Method to calculate available seats for a segment
getAvailableSeatsForSegment(schedule, classType, fromIndex, toIndex, stationMap) {
  if (!schedule.seat_bookings) return schedule.seats[classType]?.available || 0;
  
  const bookings = schedule.seat_bookings.filter(
    booking => booking.class_type === classType
  );
  
  const occupiedSeats = new Set();
  
  for (const booking of bookings) {
    const bookingFromIndex = stationMap[booking.from];
    const bookingToIndex = stationMap[booking.to];
    
    // Check if the booking overlaps with the requested segment
    if (bookingFromIndex < toIndex && bookingToIndex > fromIndex) {
      occupiedSeats.add(booking.seat_number);
    }
  }
  
  const totalSeats = schedule.seats[classType]?.total || 0;
  return totalSeats - occupiedSeats.size;
}

// Helper method for sorting
sortResults(results, sortBy) {
  switch(sortBy) {
    case 'duration':
      results.sort((a, b) => (a.duration || Infinity) - (b.duration || Infinity));
      break;
    case 'duration_desc':
      results.sort((a, b) => (b.duration || 0) - (a.duration || 0));
      break;
    case 'departure':
      results.sort((a, b) => {
        const timeA = this.getMinutes(a.departure_time) || 0;
        const timeB = this.getMinutes(b.departure_time) || 0;
        return timeA - timeB;
      });
      break;
    case 'departure_desc':
      results.sort((a, b) => {
        const timeA = this.getMinutes(a.departure_time) || 0;
        const timeB = this.getMinutes(b.departure_time) || 0;
        return timeB - timeA;
      });
      break;
    case 'arrival':
      results.sort((a, b) => {
        const timeA = this.getMinutes(a.arrival_time) || 0;
        const timeB = this.getMinutes(b.arrival_time) || 0;
        return timeA - timeB;
      });
      break;
    case 'arrival_desc':
      results.sort((a, b) => {
        const timeA = this.getMinutes(a.arrival_time) || 0;
        const timeB = this.getMinutes(b.arrival_time) || 0;
        return timeB - timeA;
      });
      break;
    case 'price_low':
      results.sort((a, b) => {
        const getMinPrice = (train) => {
          const prices = Object.values(train.seats).map(s => s.price).filter(p => p !== null);
          return prices.length ? Math.min(...prices) : Infinity;
        };
        return getMinPrice(a) - getMinPrice(b);
      });
      break;
    case 'price_high':
      results.sort((a, b) => {
        const getMaxPrice = (train) => {
          const prices = Object.values(train.seats).map(s => s.price).filter(p => p !== null);
          return prices.length ? Math.max(...prices) : 0;
        };
        return getMaxPrice(b) - getMaxPrice(a);
      });
      break;
    case 'availability':
      results.sort((a, b) => {
        const getTotalAvailability = (train) => {
          return Object.values(train.seats).reduce((sum, seat) => sum + (seat.available || 0), 0);
        };
        return getTotalAvailability(b) - getTotalAvailability(a);
      });
      break;
    default:
      if (sortBy === 'train_number') {
        results.sort((a, b) => a.train_number.localeCompare(b.train_number));
      }
      break;
  }
  
  return results;
}

// Helper method for sorting
sortResults(results, sortBy) {
  switch(sortBy) {
    case 'duration':
      results.sort((a, b) => (a.duration || Infinity) - (b.duration || Infinity));
      break;
    case 'duration_desc':
      results.sort((a, b) => (b.duration || 0) - (a.duration || 0));
      break;
    case 'departure':
      results.sort((a, b) => {
        const timeA = this.getMinutes(a.departure_time) || 0;
        const timeB = this.getMinutes(b.departure_time) || 0;
        return timeA - timeB;
      });
      break;
    case 'departure_desc':
      results.sort((a, b) => {
        const timeA = this.getMinutes(a.departure_time) || 0;
        const timeB = this.getMinutes(b.departure_time) || 0;
        return timeB - timeA;
      });
      break;
    case 'arrival':
      results.sort((a, b) => {
        const timeA = this.getMinutes(a.arrival_time) || 0;
        const timeB = this.getMinutes(b.arrival_time) || 0;
        return timeA - timeB;
      });
      break;
    case 'arrival_desc':
      results.sort((a, b) => {
        const timeA = this.getMinutes(a.arrival_time) || 0;
        const timeB = this.getMinutes(b.arrival_time) || 0;
        return timeB - timeA;
      });
      break;
    case 'price_low':
      results.sort((a, b) => {
        const getMinPrice = (train) => {
          const prices = Object.values(train.seats).map(s => s.price).filter(p => p !== null);
          return prices.length ? Math.min(...prices) : Infinity;
        };
        return getMinPrice(a) - getMinPrice(b);
      });
      break;
    case 'price_high':
      results.sort((a, b) => {
        const getMaxPrice = (train) => {
          const prices = Object.values(train.seats).map(s => s.price).filter(p => p !== null);
          return prices.length ? Math.max(...prices) : 0;
        };
        return getMaxPrice(b) - getMaxPrice(a);
      });
      break;
    case 'availability':
      results.sort((a, b) => {
        const getTotalAvailability = (train) => {
          return Object.values(train.seats).reduce((sum, seat) => sum + (seat.available || 0), 0);
        };
        return getTotalAvailability(b) - getTotalAvailability(a);
      });
      break;
    default:
      // No sorting or default sorting by train number
      if (sortBy === 'train_number') {
        results.sort((a, b) => a.train_number.localeCompare(b.train_number));
      }
      break;
  }
  
  return results;
}

// Helper method to convert time string to minutes
getMinutes(timeStr) {
  if (!timeStr) return null;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

// Method to calculate available seats for a segment
getAvailableSeatsForSegment(schedule, classType, fromIndex, toIndex, stationMap) {
  if (!schedule.seat_bookings) return schedule.seats[classType]?.available || 0;
  
  const bookings = schedule.seat_bookings.filter(
    booking => booking.class_type === classType
  );
  
  const occupiedSeats = new Set();
  
  for (const booking of bookings) {
    const bookingFromIndex = stationMap[booking.from];
    const bookingToIndex = stationMap[booking.to];
    
    // Check if the booking overlaps with the requested segment
    if (bookingFromIndex < toIndex && bookingToIndex > fromIndex) {
      occupiedSeats.add(booking.seat_number);
    }
  }
  
  const totalSeats = schedule.seats[classType]?.total || 0;
  return totalSeats - occupiedSeats.size;
}

  getMinutes(time) {
    if (!time) return null;
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
  }

  getAvailableSeatsForSegment(schedule, classType, fromIndex, toIndex, stationMap) {
    const classData = schedule.seats.get ? 
      schedule.seats.get(classType) : 
      schedule.seats[classType];
      
    if (!classData) return 0;

    const existingBookings = schedule.seat_bookings || [];
    let available = 0;

    for (let seatNum = 1; seatNum <= classData.total; seatNum++) {
      let isConflict = false;
      for (let booking of existingBookings) {
        if (booking.seat_number !== seatNum) continue;
        const bookedFrom = stationMap.get ? 
          stationMap.get(booking.from) : 
          stationMap[booking.from];
        const bookedTo = stationMap.get ? 
          stationMap.get(booking.to) : 
          stationMap[booking.to];
        
        if (!(toIndex <= bookedFrom || fromIndex >= bookedTo)) {
          isConflict = true;
          break;
        }
      }
      if (!isConflict) available++;
    }
    return available;
  }

  async getCoachWiseAvailability(scheduleId, class_type) {
    const schedule = await Schedule.findById(scheduleId);
    if (!schedule) throw new Error("Schedule not found");
    
    const bookings = schedule.seat_bookings.filter(b => b.class_type === class_type);
    const coachWiseBookings = new Map();
    
    for (const booking of bookings) {
      if (!coachWiseBookings.has(booking.coach)) {
        coachWiseBookings.set(booking.coach, []);
      }
      coachWiseBookings.get(booking.coach).push({
        seat_number: booking.seat_number,
        seat_position: booking.seat_position,
        from: booking.from,
        to: booking.to
      });
    }
    
    return coachWiseBookings;
  }

  // NEW: Update waiting count for a class
  async updateWaitingCount(scheduleId, class_type, increment = 1) {
    const schedule = await Schedule.findById(scheduleId);
    if (!schedule) throw new Error("Schedule not found");
    
    const classData = schedule.seats.get(class_type);
    if (classData) {
      classData.waiting_count = (classData.waiting_count || 0) + increment;
      schedule.seats.set(class_type, classData);
      await schedule.save();
    }
  }

  // NEW: Get waiting list status
  async getWaitingListStatus(scheduleId, class_type) {
    const schedule = await Schedule.findById(scheduleId);
    if (!schedule) throw new Error("Schedule not found");
    
    const classData = schedule.seats.get(class_type);
    const waitingEntries = schedule.waiting_list.filter(w => w.class_type === class_type);
    
    return {
      total_seats: classData?.total || 0,
      available_seats: classData?.available || 0,
      waiting_count: classData?.waiting_count || 0,
      max_waiting: classData?.max_waiting || 0,
      waiting_list: waitingEntries.map(entry => ({
        pnr: entry.pnr,
        position: waitingEntries.findIndex(e => e.pnr === entry.pnr) + 1,
        passengers_count: entry.passengers.length,
        created_at: entry.created_at
      }))
    };
  }
}

module.exports = new ScheduleService();