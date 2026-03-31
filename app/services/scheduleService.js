const Schedule = require("../models/scheduleSchema.model");
const axios = require("axios");

class ScheduleService {

  async getTrain(train_number) {
    const res = await axios.get(
      `http://localhost:3003/train/get-train-by-number/${train_number}`
    );
    const train = res.data?.data;
    if (!train) throw new Error("Train not found");
    return train;
  }

  buildSeatsFromCoaches(coaches = []) {
    const seatMap = {};
    for (const coach of coaches) {
      if (!seatMap[coach.coach_type]) seatMap[coach.coach_type] = 0;
      seatMap[coach.coach_type] += coach.total_seats;
    }
    const seats = new Map();
    for (const type in seatMap) {
      seats.set(type, { total: seatMap[type], available: seatMap[type] });
    }
    return seats;
  }

  async generateSchedule(data) {
    const { train_number, days, running_days } = data;
    if (!train_number || !days || !running_days) throw new Error("Missing required fields");

    const normalizedDays = running_days.map(d => d.toUpperCase());
    const train = await this.getTrain(train_number);

    const existingSchedules = await Schedule.find({ train_id: train._id }).select("journey_date");
    const existingDates = new Set(existingSchedules.map(s => new Date(s.journey_date).toISOString().split("T")[0]));

    const schedules = [];
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      const dayName = date.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
      if (!normalizedDays.includes(dayName)) continue;

      const journey_date = new Date(date);
      journey_date.setHours(0, 0, 0, 0);
      const dateStr = journey_date.toISOString().split("T")[0];
      if (existingDates.has(dateStr)) continue;

      schedules.push({
        train_id: String(train._id),
        train_number: train.train_number,
        train_name: train.train_name,
        journey_date,
        seats: this.buildSeatsFromCoaches(train.coaches),
        status: "ACTIVE"
      });
    }

    if (schedules.length > 0) await Schedule.insertMany(schedules);
    return schedules;
  }

  async searchSchedules(from, to, date) {
    from = from.toUpperCase();
    to = to.toUpperCase();

    if (isNaN(new Date(date))) throw new Error("Invalid date format. Use YYYY-MM-DD");

    // Step 1: Get trains from Train Service
    const trainRes = await axios.get(
      "http://localhost:3003/train/searchTrainsByFROMandTO",
      { params: { from, to } }
    );
    const trains = trainRes.data?.data || [];
    if (!trains.length) return [];

    // Step 2: Prepare date range
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end = new Date(date); end.setHours(23, 59, 59, 999);

    // Step 3: Get schedules for that date
    const trainIds = trains.map(t => String(t._id));
    const schedules = await Schedule.find({
      train_id: { $in: trainIds },
      journey_date: { $gte: start, $lte: end }
    });
    if (!schedules.length) return [];

    // Step 4: Map schedules by train_id
    const scheduleMap = new Map();
    schedules.forEach(s => {
      scheduleMap.set(String(s.train_id), s);
    });

    // Step 5: Helpers
    const getRouteData = (train, station) => {
      return train.route.find(r => r.station_code === station);
    };

    const getMinutes = (time) => {
      if (!time) return null;
      const [h, m] = time.split(":").map(Number);
      return h * 60 + m;
    };

    const getDuration = (train) => {
      const fromData = getRouteData(train, from);
      const toData = getRouteData(train, to);
      if (!fromData || !toData) return null;

      const dep = getMinutes(fromData.departure_time);
      const arr = getMinutes(toData.arrival_time);
      if (dep === null || arr === null) return null;

      // Handle midnight crossing
      return arr >= dep ? arr - dep : (1440 - dep + arr);
    };

    const getAvailableSeats = (schedule, class_type, fromIdx, toIdx, stationMap) => {
      const classData = schedule.seats.get(class_type);
      if (!classData) return 0;
      const existingBookings = schedule.seat_bookings.filter(b => b.class_type === class_type);
      let available = 0;
      for (let seatNum = 1; seatNum <= classData.total; seatNum++) {
        let isConflict = false;
        for (let booking of existingBookings) {
          if (booking.seat_number !== seatNum) continue;
          const bookedFrom = stationMap[booking.from];
          const bookedTo = stationMap[booking.to];
          if (!(toIdx <= bookedFrom || fromIdx >= bookedTo)) {
            isConflict = true;
            break;
          }
        }
        if (!isConflict) available++;
      }
      return available;
    };

    // Step 6: Final response
    const result = trains
      .map(train => {
        const schedule = scheduleMap.get(String(train._id));
        if (!schedule) return null;

        const fromIdx = train.station_map[from];
        const toIdx = train.station_map[to];

        const dynamicSeats = {};
        for (const [classType, classData] of schedule.seats.entries()) {
           dynamicSeats[classType] = {
              total: classData.total,
              available: getAvailableSeats(schedule, classType, fromIdx, toIdx, train.station_map)
           };
        }

        return {
          train_id: train._id,
          train_number: train.train_number,
          train_name: train.train_name,
          from,
          to,
          departure_time: getRouteData(train, from)?.departure_time,
          arrival_time: getRouteData(train, to)?.arrival_time,
          duration: getDuration(train),
          journey_date: schedule.journey_date,
          seats: dynamicSeats
        };
      })
      .filter(Boolean);

    return result;
  }
}

module.exports = new ScheduleService();
