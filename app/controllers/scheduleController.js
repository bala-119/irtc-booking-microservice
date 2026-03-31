const scheduleService = require("../services/scheduleService");

class ScheduleController {

  // GENERATE SCHEDULE
  async generateSchedule(req, res) {
    try {
      const token = req.headers.authorization;
      const schedules = await scheduleService.generateSchedule(req.body, token);

      return res.status(200).json({
        success: true,
        message: "Schedules created successfully",
        count: schedules.length,
        data: schedules
      });
    } catch (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
  }

  // SEARCH SCHEDULES
async searchSchedules(req, res) {
  try {
    // ✅ FIX: use query instead of body
    const { from, to, date } = req.query;

    if (!from || !to || !date) {
      return res.status(400).json({
        success: false,
        message: "from, to and date are required"
      });
    }

    const data = await scheduleService.searchSchedules(from, to, date);

    return res.status(200).json({
      success: true,
      count: data.length,
      data
    });

  } catch (err) {
    console.error("❌ Schedule Controller ERROR:", err.message);

    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
}
}

module.exports = new ScheduleController();
