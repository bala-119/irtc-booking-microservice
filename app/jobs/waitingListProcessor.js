const cron = require('node-cron');
const Schedule = require("../models/scheduleSchema.model");
const Booking = require("../models/bookingSchema.model");
const axios = require("axios");

class WaitingListProcessor {
  
  startProcessor() {
    console.log('🚀 Starting Waiting List Processor...');
    console.log('   Will run every 5 minutes');
    
    // Run every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      console.log('\n🔄 Running waiting list processor...', new Date().toISOString());
      await this.processAllWaitingLists();
    });
    
    // Run daily at midnight to process refunds for expired waiting list tickets
    cron.schedule('0 0 * * *', async () => {
      console.log('\n💰 Running daily refund processor for expired waiting list tickets...');
      await this.processExpiredWaitingListRefunds();
    });
    
    // Also run immediately on startup
    console.log('📋 Running initial waiting list check...');
    setTimeout(() => this.processAllWaitingLists(), 10000);
  }
  
  async processAllWaitingLists() {
    try {
      // Find all active schedules with waiting lists
      const schedules = await Schedule.find({
        status: "ACTIVE",
        'waiting_list.0': { $exists: true }
      });
      
      console.log(`📊 Processing ${schedules.length} schedules with waiting lists`);
      
      let totalConfirmed = 0;
      
      for (const schedule of schedules) {
        const confirmed = await this.processScheduleWaitingList(schedule);
        totalConfirmed += confirmed;
      }
      
      if (totalConfirmed > 0) {
        console.log(`✅ Total confirmed from waiting lists: ${totalConfirmed}`);
      }
    } catch (error) {
      console.error("❌ Error processing waiting lists:", error);
    }
  }
  
  async processScheduleWaitingList(schedule) {
    let totalConfirmed = 0;
    
    // Check if journey date has passed - process refunds
    const journeyDate = new Date(schedule.journey_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (journeyDate < today) {
      console.log(`Journey date ${schedule.journey_date} has passed. Processing refunds for waiting list...`);
      await this.processRefundsForPastJourney(schedule);
      return 0;
    }
    
    // Group waiting list by class
    const waitingByClass = new Map();
    
    for (const entry of schedule.waiting_list) {
      if (!waitingByClass.has(entry.class_type)) {
        waitingByClass.set(entry.class_type, []);
      }
      waitingByClass.get(entry.class_type).push(entry);
    }
    
    // Process each class
    for (const [class_type, waitingEntries] of waitingByClass) {
      // Sort by creation time (FIFO)
      waitingEntries.sort((a, b) => a.created_at - b.created_at);
      
      // Get train details
      const trainRes = await axios.get(
        `http://localhost:3003/train/get-train-by-number/${schedule.train_number}`
      ).catch(err => {
        console.error(`Failed to get train details: ${err.message}`);
        return null;
      });
      
      if (!trainRes || !trainRes.data?.data) {
        console.error(`Train ${schedule.train_number} not found`);
        continue;
      }
      
      const train = trainRes.data.data;
      const stationMap = train.station_map;
      const classCoaches = train.coaches.filter(c => c.coach_type === class_type);
      
      let confirmedCount = 0;
      
      for (const waitingEntry of waitingEntries) {
        // Calculate available seats for this segment
        const fromIndex = stationMap[waitingEntry.from];
        const toIndex = stationMap[waitingEntry.to];
        
        const availableSeats = this.getAvailableSeatsForSegment(
          schedule, class_type, fromIndex, toIndex, stationMap, classCoaches
        );
        
        if (availableSeats >= waitingEntry.passengers.length) {
          // Confirm this waiting entry
          const success = await this.confirmWaitingEntry(schedule, waitingEntry, class_type, stationMap, classCoaches);
          if (success) {
            confirmedCount++;
            totalConfirmed++;
          } else {
            break;
          }
        } else {
          console.log(`Not enough seats for waiting entry ${waitingEntry.pnr}. Need ${waitingEntry.passengers.length}, have ${availableSeats}`);
          break;
        }
      }
      
      if (confirmedCount > 0) {
        await schedule.save();
        console.log(`✅ Confirmed ${confirmedCount} waiting entries for ${class_type} on train ${schedule.train_number}`);
      }
    }
    
    return totalConfirmed;
  }
  
  async confirmWaitingEntry(schedule, waitingEntry, class_type, stationMap, classCoaches) {
    try {
      let allocatedSeats = [];
      const fromIndex = stationMap[waitingEntry.from];
      const toIndex = stationMap[waitingEntry.to];
      
      for (let i = 0; i < waitingEntry.passengers.length; i++) {
        const passenger = waitingEntry.passengers[i];
        const berthPreference = passenger.berth_preference || "NO_PREFERENCE";
        
        const seat = this.allocateSeatWithPreference(
          schedule, class_type, waitingEntry.from, waitingEntry.to,
          fromIndex, toIndex, stationMap, classCoaches, allocatedSeats,
          berthPreference, passenger
        );
        
        const seatPosition = this.getSeatPosition(class_type, seat.seat_number);
        seat.position = seatPosition;
        allocatedSeats.push(seat);
        
        schedule.seat_bookings.push({
          class_type: class_type,
          coach: seat.coach,
          seat_number: seat.seat_number,
          from: waitingEntry.from,
          to: waitingEntry.to,
          passenger: passenger,
          pnr: waitingEntry.pnr
        });
      }
      
      // Remove from waiting list
      schedule.waiting_list = schedule.waiting_list.filter(w => w.pnr !== waitingEntry.pnr);
      
      // Update booking - CONFIRMED but payment already done
      const updatedBooking = await Booking.findOneAndUpdate(
        { pnr: waitingEntry.pnr },
        { 
          booking_status: "CONFIRMED", 
          waiting_number: 0,
          seat_details: allocatedSeats,
          confirmed_at: new Date()
        },
        { new: true }
      );
      
      console.log(`✅ Waiting list booking ${waitingEntry.pnr} confirmed with seats: ${allocatedSeats.map(s => `${s.coach}-${s.seat_number}(${s.position})`).join(', ')}`);
      console.log(`   Payment already received: ₹${updatedBooking.total_fare}`);
      
      return true;
    } catch (error) {
      console.error(`❌ Failed to confirm waiting entry ${waitingEntry.pnr}:`, error.message);
      return false;
    }
  }
  
  async processRefundsForPastJourney(schedule) {
    try {
      // Find all waiting list bookings for this schedule
      const waitingBookings = await Booking.find({
        schedule_id: schedule._id,
        booking_status: "WAITING",
        payment_status: "PAID" // Only process paid ones
      });
      
      console.log(`Found ${waitingBookings.length} waiting list bookings to refund for journey ${schedule.journey_date}`);
      
      for (const booking of waitingBookings) {
        // Process refund
        const refundAmount = booking.total_fare;
        
        // Update booking as CANCELLED with refund
        booking.booking_status = "CANCELLED";
        booking.cancellation_reason = "Waiting list not confirmed before journey date";
        booking.cancelled_at = new Date();
        
        booking.payment_details = {
          ...booking.payment_details,
          status: "REFUNDED",
          refund_amount: refundAmount,
          refund_date: new Date(),
          refund_reason: "Waiting list not confirmed"
        };
        
        await booking.save();
        
        console.log(`💰 Refund processed for PNR: ${booking.pnr}`);
        console.log(`   Amount: ₹${refundAmount}`);
        console.log(`   Reason: Waiting list not confirmed before journey`);
      }
      
      // Clear waiting list from schedule
      if (waitingBookings.length > 0) {
        schedule.waiting_list = schedule.waiting_list.filter(w => 
          !waitingBookings.some(b => b.pnr === w.pnr)
        );
        await schedule.save();
      }
      
    } catch (error) {
      console.error(`Error processing refunds for schedule ${schedule._id}:`, error);
    }
  }
  
  async processExpiredWaitingListRefunds() {
    try {
      // Find schedules with journey date in the past that still have waiting list
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const expiredSchedules = await Schedule.find({
        status: "ACTIVE",
        journey_date: { $lt: today },
        'waiting_list.0': { $exists: true }
      });
      
      console.log(`Found ${expiredSchedules.length} expired schedules with waiting lists`);
      
      for (const schedule of expiredSchedules) {
        await this.processRefundsForPastJourney(schedule);
      }
      
    } catch (error) {
      console.error("Error processing expired waiting list refunds:", error);
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
    
    if (class_type === "SL") {
      const isSpecialPassenger = passenger.age >= 60 || passenger.gender === "FEMALE";
      
      let preferredPositions = [];
      
      if (berthPreference !== "NO_PREFERENCE") {
        preferredPositions = [berthPreference];
      } else if (isSpecialPassenger && passenger.gender === "FEMALE") {
        preferredPositions = ["LOWER", "SIDE_LOWER"];
      } else if (isSpecialPassenger) {
        preferredPositions = ["LOWER"];
      } else {
        preferredPositions = ["LOWER", "MIDDLE", "UPPER", "SIDE_LOWER", "SIDE_UPPER"];
      }
      
      for (const preferredPos of preferredPositions) {
        for (const coach of classCoaches) {
          for (let seatNum = 1; seatNum <= coach.total_seats; seatNum++) {
            const seatPos = this.getSeatPosition(class_type, seatNum);
            
            if (seatPos !== preferredPos) continue;
            if (allocatedSeatsSet.has(`${coach.coach_id}-${seatNum}`)) continue;
            
            const isAvailable = this.isSeatAvailableForSegment(
              seatNum, coach.coach_id, fromIndex, toIndex, existingBookings, stationMap
            );
            
            if (isAvailable) {
              return { coach: coach.coach_id, seat_number: seatNum };
            }
          }
        }
      }
    }
    
    // Fallback: Any available seat
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
  
  getAvailableSeatsForSegment(schedule, class_type, fromIndex, toIndex, stationMap, classCoaches) {
    const existingBookings = schedule.seat_bookings.filter(b => b.class_type === class_type);
    let available = 0;
    
    let totalSeats = 0;
    for (const coach of classCoaches) {
      totalSeats += coach.total_seats;
    }
    
    for (let seatNum = 1; seatNum <= totalSeats; seatNum++) {
      let isConflict = false;
      for (const booking of existingBookings) {
        if (booking.seat_number !== seatNum) continue;
        const bookedFrom = stationMap[booking.from];
        const bookedTo = stationMap[booking.to];
        
        if (!(toIndex <= bookedFrom || fromIndex >= bookedTo)) {
          isConflict = true;
          break;
        }
      }
      if (!isConflict) available++;
    }
    return available;
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
  
  getSeatPosition(class_type, seatNumber) {
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
}

module.exports = new WaitingListProcessor();