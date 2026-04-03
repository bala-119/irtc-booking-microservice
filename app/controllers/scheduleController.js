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
      const { from, to, date } = req.query;

      if (!from || !to || !date) {
        return res.status(400).json({
          success: false,
          message: "from, to and date are required query parameters"
        });
      }

      const data = await scheduleService.searchSchedules(from, to, date);

      return res.status(200).json({
        success: true,
        count: data.length,
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