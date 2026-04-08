const scheduleService = require("../services/scheduleService");

class ScheduleController {

  async generateSchedule(req, res) {
    try {
      const { train_number, days, running_days } = req.body;
      
      if (!train_number || !days || !running_days) {
        return res.status(400).json({
          success: false,
          message: "Missing required fields: train_number, days, running_days"
        });
      }
      console.log("entering into schedule service...")
      const schedules = await scheduleService.generateSchedule(req.body);

      return res.status(200).json({
        success: true,
        message: `${schedules.length} schedules created successfully`,
        count: schedules.length,
        data: schedules
      });
    } catch (err) {
      console.error("Schedule generation error:", err);
      return res.status(400).json({ 
        success: false, 
        message: err.message 
      });
    }
  }

async searchSchedules(req, res) {
  try {
    const { from, to, date, sortBy, class: classFilter } = req.query;

    if (!from || !to || !date) {
      return res.status(400).json({
        success: false,
        message: "from (station name), to (station name) and date are required query parameters"
      });
    }

    // Validate sortBy parameter
    const validSortOptions = [
      'duration', 'duration_desc', 
      'departure', 'departure_desc',
      'arrival', 'arrival_desc',
      'price_low', 'price_high',
      'availability', 'train_number'
    ];
    
    if (sortBy && !validSortOptions.includes(sortBy)) {
      return res.status(400).json({
        success: false,
        message: `Invalid sortBy option. Valid options: ${validSortOptions.join(', ')}`
      });
    }

    // Validate class filter
    const validClasses = ['SL', '3AC', '2AC', '1AC', 'AC','2S'];
    if (classFilter && !validClasses.includes(classFilter)) {
      return res.status(400).json({
        success: false,
        message: `Invalid class filter. Valid options: ${validClasses.join(', ')}`
      });
    }

    const data = await scheduleService.searchSchedules(from, to, date, sortBy, classFilter);

    return res.status(200).json({
      success: true,
      count: data.length,
      searchParams: {
        fromStation: from,
        toStation: to,
        date: date,
        sortBy: sortBy || 'default',
        classFilter: classFilter || 'all'
      },
      data
    });

  } catch (err) {
    console.error("Schedule search error:", err);
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
}
}

module.exports = new ScheduleController();