const scheduleService = require("../services/scheduleService");

class ScheduleController {
async generateSchedule(req, res) {
  try {

    const token = req.headers.authorization;
    console.log("schreduleinf")
    const schedules = await scheduleService.generateSchedule(req.body, token);
    console.log(".....")
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

async searchSchedules(req, res) {
  console.log("EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE")
    try {
      const { from, to, date } = req.body;
      console.log("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
      console.log("from:",from,"to",to);

      // ✅ Validation
      if (!from || !to || !date) {
        return res.status(400).json({
          success: false,
          message: "from, to and date are required"
        });
      }
      console.log("from:",from,"to:",to,"date",date)

      const data = await scheduleService.searchSchedules(from, to, date);
      console.log("got true response from  schduleeeeeeeeeeeeeeeeeeeeeeee service")
      return res.status(200).json({
        success: true,
        count: data.length,
        data
      });

    } catch (err) {
      return res.status(500).json({
        success: false,
        message: err.message
      });
    }
  }
}

module.exports = new ScheduleController();