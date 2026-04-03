const Schedule = require("../models/scheduleSchema.model");
const axios = require("axios");
const mongoose = require("mongoose");

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

  async searchSchedules(from, to, date) {
    try {
      let fromCode = from;
      let toCode = to;
      
      if (isNaN(new Date(date))) {
        throw new Error("Invalid date format. Use YYYY-MM-DD");
      }
      
      console.log(`Searching trains from ${fromCode} to ${toCode} on ${date}`);
      
      const trainRes = await axios.get(
        "http://localhost:3003/train/search",
        { params: { from: fromCode, to: toCode } }
      );
      
      console.log("Train microservice response received");
      const trains = trainRes.data?.data || [];
      console.log(`Found ${trains.length} trains`);
      
      if (!trains.length) return [];

      const searchDate = new Date(date);
      const start = new Date(Date.UTC(searchDate.getFullYear(), searchDate.getMonth(), searchDate.getDate(), 0, 0, 0));
      const end = new Date(Date.UTC(searchDate.getFullYear(), searchDate.getMonth(), searchDate.getDate(), 23, 59, 59, 999));
      
      console.log("Search date (UTC):", start.toISOString());

      const trainIds = trains.map(t => {
        const trainId = t.train_id || t._id;
        if (!mongoose.Types.ObjectId.isValid(trainId)) {
          console.log(`Invalid ObjectId: ${trainId}`);
          return null;
        }
        return new mongoose.Types.ObjectId(trainId);
      }).filter(id => id !== null);
      
      if (trainIds.length === 0) {
        console.log("No valid train IDs found");
        return [];
      }
      
      const schedules = await Schedule.find({
        train_id: { $in: trainIds },
        journey_date: { $gte: start, $lte: end },
        status: "ACTIVE"
      });
      
      console.log(`Found ${schedules.length} schedules in database`);
      
      if (schedules.length === 0) return [];

      const scheduleMap = new Map();
      schedules.forEach(s => {
        scheduleMap.set(s.train_id.toString(), s);
      });

      const result = [];
      
      for (const train of trains) {
        const trainId = train.train_id || train._id;
        const schedule = scheduleMap.get(trainId.toString());
        
        if (!schedule) continue;

        try {
          const completeTrainRes = await axios.get(
            `http://localhost:3003/train/get-train-by-number/${train.train_number}`
          );
          const completeTrain = completeTrainRes.data?.data;
          
          if (!completeTrain) continue;
          
          const stationMap = completeTrain.station_map;
          
          let fromIndex = stationMap[fromCode];
          let toIndex = stationMap[toCode];
          
          if (fromIndex === undefined) {
            const routeData = completeTrain.route;
            const fromStation = routeData.find(r => 
              r.station_name.toLowerCase() === fromCode.toLowerCase() ||
              r.station_code.toLowerCase() === fromCode.toLowerCase()
            );
            if (fromStation) {
              fromIndex = stationMap[fromStation.station_code];
              fromCode = fromStation.station_code;
            }
          }
          
          if (toIndex === undefined) {
            const routeData = completeTrain.route;
            const toStation = routeData.find(r => 
              r.station_name.toLowerCase() === toCode.toLowerCase() ||
              r.station_code.toLowerCase() === toCode.toLowerCase()
            );
            if (toStation) {
              toIndex = stationMap[toStation.station_code];
              toCode = toStation.station_code;
            }
          }
          
          if (fromIndex === undefined || toIndex === undefined || fromIndex >= toIndex) continue;

          const routeData = completeTrain.route;
          let fromData, toData;
          
          if (routeData) {
            fromData = routeData.find(r => r.station_code === fromCode);
            toData = routeData.find(r => r.station_code === toCode);
          }

          let duration = null;
          if (fromData?.departure_time && toData?.arrival_time) {
            const depMinutes = this.getMinutes(fromData.departure_time);
            const arrMinutes = this.getMinutes(toData.arrival_time);
            if (depMinutes !== null && arrMinutes !== null) {
              duration = arrMinutes >= depMinutes ? 
                arrMinutes - depMinutes : 
                (1440 - depMinutes + arrMinutes);
            }
          }

          // Get seat availability with updated waiting list info
          const seats = {};
          if (schedule.seats) {
            const seatEntries = schedule.seats.entries ? 
              Array.from(schedule.seats.entries()) : 
              Object.entries(schedule.seats);
              
            for (const [classType, classData] of seatEntries) {
              const availableSeats = this.getAvailableSeatsForSegment(
                schedule, classType, fromIndex, toIndex, stationMap
              );
              seats[classType] = {
                total: classData.total,
                available: availableSeats,
                waiting_list_count: classData.waiting_count || 0,  // NEW: Show waiting count
                max_waiting: classData.max_waiting  // NEW: Show max waiting (total seats)
              };
            }
          }

          result.push({
            train_id: trainId,
            train_number: completeTrain.train_number,
            train_name: completeTrain.train_name,
            from_code: fromCode,
            to_code: toCode,
            from_name: fromData?.station_name,
            to_name: toData?.station_name,
            departure_time: fromData?.departure_time,
            arrival_time: toData?.arrival_time,
            duration: duration,
            duration_hours: duration ? Math.floor(duration / 60) : null,
            duration_minutes: duration ? duration % 60 : null,
            journey_date: schedule.journey_date,
            seats: seats
          });
          
        } catch (error) {
          console.error(`Error fetching complete train details for ${train.train_number}:`, error.message);
          continue;
        }
      }

      console.log("Final result count:", result.length);
      return result;
      
    } catch (error) {
      console.error("Error in searchSchedules:", error);
      throw error;
    }
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